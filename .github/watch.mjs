// Checks monthful.app from outside, every hour (.github/workflows/watch.yml): the domain at the registry and at Namecheap,
// the pages the App Store and Google Play listings link to, mail for support@, and the HTTPS certificate.
// It prints what's wrong in plain words and exits 1, so the run fails and the workflow opens an issue.
// Run it by hand with `node .github/watch.mjs` (Node 20 or newer).
import { Resolver } from 'node:dns/promises';
import tls from 'node:tls';

const DOMAIN = 'monthful.app';
const GITHUB_PAGES_IPS = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
const GITHUB_PAGES_IPV6 = ['2606:50c0:8000::153', '2606:50c0:8001::153', '2606:50c0:8002::153', '2606:50c0:8003::153'];
const APP_STORE_ID = 'id6825291719';
// The end of support@'s Namecheap Private Email (a trial until 15 Nov 2026). Move it on whenever it's renewed.
const PRIVATE_EMAIL_ENDS = '2026-11-15';
const DAY = 24 * 60 * 60 * 1000;

// Public resolvers, so a cached answer on the runner can't hide a change.
const resolver = new Resolver({ timeout: 5000, tries: 3 });
resolver.setServers(['1.1.1.1', '8.8.8.8']);

const get = (url, redirect = 'follow') => fetch(url, { redirect, signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'monthful-watch (+https://github.com/5aled12/monthful-site)' } });
const daysUntil = (date) => Math.floor((new Date(date).getTime() - Date.now()) / DAY);

const checks = {
  async registry() {
    // .app's registry (Google) says whether the domain is on hold and when it expires. When it doesn't answer, this hour
    // skips it: a hold takes the domain out of the zone, so the nameserver check below fails anyway.
    const rdap = await get(`https://pubapi.registry.google/rdap/domain/${DOMAIN}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .catch((error) => console.warn(`registry: skipped this hour (${error.message})`));
    if (!rdap) return;
    const held = (rdap.status ?? []).filter((s) => /hold|pending delete|redemption/i.test(s));
    if (held.length) return `the registry has the domain on "${held.join(', ')}": it's switched off. Sign in to Namecheap and look at monthful.app.`;
    const expires = rdap.events?.find((e) => e.eventAction === 'expiration')?.eventDate;
    // Namecheap's auto-renew charges 30 days before the end, so under 25 days it didn't go through.
    if (expires && daysUntil(expires) < 25) return `the domain expires on ${expires.slice(0, 10)} (${daysUntil(expires)} days) and hasn't renewed: auto-renew at Namecheap failed (check the card in Namecheap's Billing).`;
  },
  async mailbox() {
    // Private Email is billed apart from the domain, and nothing outside Namecheap shows when it lapses: its MX records stay.
    if (daysUntil(PRIVATE_EMAIL_ENDS) < 7)
      return `support@monthful.app's Private Email ends on ${PRIVATE_EMAIL_ENDS}: renew it in Namecheap (Private Email), then set PRIVATE_EMAIL_ENDS in .github/watch.mjs to the new end date.`;
  },
  async nameservers() {
    const ns = (await resolver.resolveNs(DOMAIN)).map((s) => s.toLowerCase());
    if (ns.some((s) => /failed-whois-verification|verify-contact-details/.test(s)))
      return `Namecheap suspended the domain until its contact email is verified (nameservers: ${ns.join(', ')}). Open the monthful.app@gmail.com inbox, find Namecheap's "verify your contact information" email and click its link; the site comes back by itself within the hour.`;
    if (!ns.length || !ns.every((s) => s.endsWith('.registrar-servers.com'))) return `the nameservers are ${ns.join(', ') || 'missing'}, not Namecheap BasicDNS (dns1 and dns2.registrar-servers.com), so the site and mail records aren't being served.`;
  },
  async records() {
    const problems = [];
    const a = await resolver.resolve4(DOMAIN).catch(() => []);
    if (!a.length || a.some((ip) => !GITHUB_PAGES_IPS.includes(ip))) problems.push(`monthful.app points to ${a.join(', ') || 'nothing'}, not GitHub Pages (${GITHUB_PAGES_IPS.join(', ')})`);
    // No IPv6 record is fine; a wrong one sends phones on IPv6 networks elsewhere (the runner itself only uses IPv4).
    const aaaa = await resolver.resolve6(DOMAIN).catch(() => []);
    if (aaaa.some((ip) => !GITHUB_PAGES_IPV6.includes(ip))) problems.push(`monthful.app has IPv6 addresses ${aaaa.join(', ')} that aren't GitHub Pages'`);
    const www = await resolver.resolveCname(`www.${DOMAIN}`).catch(() => []);
    if (!www.map((s) => s.toLowerCase()).includes('5aled12.github.io')) problems.push(`www.monthful.app points to ${www.join(', ') || 'nothing'}, not 5aled12.github.io`);
    // support@ is on Namecheap Private Email; when mail moves, change these lines with it.
    const mx = (await resolver.resolveMx(DOMAIN).catch(() => [])).map((r) => r.exchange.toLowerCase()).sort();
    if (mx.join() !== 'mx1.privateemail.com,mx2.privateemail.com') problems.push(`mail for support@monthful.app goes to ${mx.join(', ') || 'nowhere'}, not Private Email (mx1 and mx2.privateemail.com)`);
    // The app's sign-in codes go out through Resend from no-reply@monthful.app: its key and its two sending addresses.
    const dkim = await resolver.resolveTxt(`resend._domainkey.${DOMAIN}`).catch(() => []);
    if (!dkim.some((parts) => parts.join('').startsWith('p=MIGfMA0'))) problems.push('the Resend DKIM record (resend._domainkey) is missing or changed, so the sign-in code emails may not arrive');
    for (const name of ['send', 'rsend']) {
      const target = await resolver.resolveCname(`${name}.${DOMAIN}`).catch(() => []);
      if (!target.some((t) => t.toLowerCase().endsWith('.forge.rmta.net'))) problems.push(`${name}.monthful.app no longer points to Resend (${target.join(', ') || 'nothing'}), so the sign-in code emails may not arrive`);
    }
    return problems.join('; ') || undefined;
  },
  async pages() {
    const problems = [];
    // ?stay: the home page sends a phone to its store; the check wants the page itself.
    const home = await get(`https://${DOMAIN}/?stay`);
    const html = home.ok ? await home.text() : '';
    if (!home.ok || !html.includes(APP_STORE_ID)) problems.push(`https://monthful.app/ answered ${home.status}${home.ok ? ' without the App Store link' : ''}`);
    // The store listings link these: Apple and Google check that they open.
    for (const path of ['privacy', 'terms', 'support']) {
      const res = await get(`https://${DOMAIN}/${path}/`);
      if (!res.ok) problems.push(`https://monthful.app/${path}/ answered ${res.status}`);
    }
    const www = await get(`https://www.${DOMAIN}/`, 'manual');
    if (!(www.status >= 300 && www.status < 400 && (www.headers.get('location') ?? '').startsWith(`https://${DOMAIN}`))) problems.push(`https://www.monthful.app/ answered ${www.status} instead of sending people to https://monthful.app`);
    const http = await get(`http://${DOMAIN}/`, 'manual');
    if (!(http.status >= 300 && http.status < 400 && (http.headers.get('location') ?? '').startsWith('https://'))) problems.push(`http://monthful.app/ answered ${http.status} instead of moving to https`);
    return problems.join('; ') || undefined;
  },
  async certificate() {
    const validTo = await new Promise((resolve, reject) => {
      const socket = tls.connect({ host: DOMAIN, port: 443, servername: DOMAIN, timeout: 15000 }, () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve(cert.valid_to);
      });
      socket.on('timeout', () => socket.destroy(new Error('timed out')));
      socket.on('error', reject);
    });
    // GitHub renews it about a month ahead; under two weeks means it's stuck (usually a DNS change).
    if (daysUntil(validTo) < 14) return `the HTTPS certificate ends on ${validTo} (${daysUntil(validTo)} days): GitHub hasn't renewed it. In github.com/5aled12/monthful-site → Settings → Pages, check the custom domain.`;
  },
};

async function run() {
  const failed = {};
  for (const [name, check] of Object.entries(checks)) {
    const problem = await check().catch((error) => `couldn't reach it (${error.name === 'TimeoutError' ? 'timed out' : (error.cause?.code ?? error.code ?? error.message)})`);
    if (problem) failed[name] = problem;
  }
  return failed;
}

// A blip on the runner's network shouldn't wake anyone: a problem counts only when it's still there a minute later.
let failed = await run();
if (Object.keys(failed).length) {
  await new Promise((r) => setTimeout(r, 60000));
  const again = await run();
  failed = Object.fromEntries(Object.entries(again).filter(([name]) => name in failed));
}

if (!Object.keys(failed).length) {
  console.log(`monthful.app is fine: ${Object.keys(checks).join(', ')}.`);
} else {
  const report = Object.entries(failed).map(([name, problem]) => `- **${name}**: ${problem}`).join('\n');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## monthful.app has a problem\n\n${report}\n`);
  }
  if (process.env.REPORT_FILE) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.REPORT_FILE, report);
  }
  process.exitCode = 1;
}
