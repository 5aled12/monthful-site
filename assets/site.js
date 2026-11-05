// The shared code of monthful.app's pages that talk to the server (/join, /vote, /partners, /admin). Plain browser
// JavaScript (an ES module), no build and no third-party code. apps/mobile/scripts/legal-pages.ts writes it into
// docs/site/assets and fills in CONFIG: the project's address and publishable key (public values, the same the app
// ships; never any other key) and the store links. Every text goes in as text (el(), textContent), never as HTML, and
// every storage access is wrapped: a private window or blocked site data throws.

const CONFIG = {"url":"https://peufilgxdfubivrkruta.supabase.co","key":"sb_publishable_7M7FaACP_z__Zxvsk1fFMw_D1V7aqFp","appStore":"https://apps.apple.com/app/id6825291719","googlePlay":""};

export const STORES = { appStore: CONFIG.appStore, googlePlay: CONFIG.googlePlay };

/** The API: the real project, or on this computer only a local stand-in (?api=http://localhost:54321, supabase/test/fake-server.ts). */
const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const ASKED = LOCAL ? new URLSearchParams(location.search).get('api') : null;
export const API = ASKED && /^http:\/\/(localhost|127\.0\.0\.1):54321$/.test(ASKED) ? ASKED : CONFIG.url;

// Storage --------------------------------------------------------------------------------------------------------------

export const store = {
  get(key) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? null : JSON.parse(value);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Blocked: nothing was kept.
    }
  },
};

// Language -------------------------------------------------------------------------------------------------------------
// Like the app: what they picked here, else the browser's language (Arabic stays Arabic, any other language is English,
// Arabic when the browser doesn't say).

const LANG_KEY = 'monthful.lang';
function firstLang() {
  const saved = store.get(LANG_KEY);
  if (saved === 'ar' || saved === 'en') return saved;
  const first = (navigator.languages && navigator.languages[0]) || navigator.language || '';
  return !first || /^ar\b/i.test(first) ? 'ar' : 'en';
}

export let lang = firstLang();
/** The text in the page's language. */
export const t = (ar, en) => (lang === 'ar' ? ar : en);
const locale = () => (lang === 'ar' ? 'ar-u-nu-latn-ca-gregory' : 'en-GB');

// Building the page ----------------------------------------------------------------------------------------------------

/**
 * An element: el('p', { class: 'muted', text: '…' }, child, …). Strings become text nodes; `on…` props add listeners;
 * `text` sets textContent; other props are attributes (true for an empty one; null, undefined and false are left out).
 */
export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

/** A number in Western digits, in both languages. */
export const num = (n, options) => new Intl.NumberFormat(locale(), options).format(n);

/**
 * A counted noun: Arabic changes it with the number (صوت واحد، صوتين، 3 أصوات، 11 صوت). forms: { ar: [zero, one, two,
 * three to ten, eleven and up], en: [zero, one, more] }, '{n}' where the number goes.
 */
export function counted(n, forms) {
  const fill = (s) => s.replace('{n}', num(n));
  if (lang === 'en') return fill(n === 0 ? forms.en[0] : n === 1 ? forms.en[1] : forms.en[2]);
  if (n === 0) return fill(forms.ar[0]);
  if (n === 1) return fill(forms.ar[1]);
  if (n === 2) return fill(forms.ar[2]);
  return fill(n % 100 >= 3 && n % 100 <= 10 ? forms.ar[3] : forms.ar[4]);
}

/** A date at midnight, local time, from 'YYYY-MM-DD'. */
const localDay = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
};
const dayDiff = (date) => {
  const today = new Date();
  return Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000);
};

/**
 * A day as people say it: { rel: 'today' | 'tomorrow' | null, name } with name 'اليوم' / 'بكرة' / 'الخميس' (a weekday
 * within the week ahead) / 'الخميس 12 نوفمبر' (further, or past).
 */
export function dayName(iso) {
  const date = localDay(iso);
  const diff = dayDiff(date);
  if (diff === 0) return { rel: 'today', name: t('اليوم', 'today') };
  if (diff === 1) return { rel: 'tomorrow', name: t('بكرة', 'tomorrow') };
  const weekday = new Intl.DateTimeFormat(locale(), { weekday: 'long' }).format(date);
  if (diff > 1 && diff < 7) return { rel: null, name: weekday };
  return { rel: null, name: new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(date) };
}

/** A moment as people say it: «الليلة 9:00 م»، «بكرة 10:00 ص»، «الخميس 9:00 م» / "tonight at 9:00 pm". */
export function whenName(isoTime) {
  const date = new Date(isoTime);
  // 12-hour in both languages («9:00 م», "9:00 pm"): British English would say 21:00.
  const time = new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
  const diff = dayDiff(date);
  if (diff === 0) return date.getHours() >= 18 ? t(`الليلة ${time}`, `tonight at ${time}`) : t(`اليوم ${time}`, `today at ${time}`);
  if (diff === 1) return t(`بكرة ${time}`, `tomorrow at ${time}`);
  const day = new Intl.DateTimeFormat(locale(), diff > 1 && diff < 7 ? { weekday: 'long' } : { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  return t(`${day} ${time}`, `${day} at ${time}`);
}

// The page frame -------------------------------------------------------------------------------------------------------

const LINKS = [
  ['/terms/', 'شروط الاستخدام', 'Terms of Use'],
  ['/privacy/', 'سياسة الخصوصية', 'Privacy Policy'],
  ['/support/', 'الدعم', 'Support'],
];

/** Asked for by focusHeading(): the next view drawn with a heading takes the focus there. */
let headingNext = false;

/**
 * After a change of view they asked for (signed in, signed out, «جرّب مرة ثانية»): once the new view is drawn (after any
 * loading line in between), focus goes to its heading, so a keyboard or screen reader starts on the new view instead of
 * the top of the page. A control they moved to meanwhile (the language switch) keeps it.
 */
export function focusHeading() {
  headingNext = true;
}

/**
 * A code (.code-value) is set big but always fits its box: on a narrow phone, or for a long or wide code (a partner's
 * runs to 12 characters, and W is twice as wide as I), its size steps down until it does. Run after each drawing, when
 * a font arrives (Fraunces, from Google Fonts) and when the window changes size.
 */
function fitCodes(root) {
  const least = 16;
  for (const node of root.querySelectorAll('.code-value')) {
    node.style.fontSize = '';
    const room = node.clientWidth;
    if (!room || node.scrollWidth <= room) continue;
    let size = Math.max(least, Math.floor((parseFloat(getComputedStyle(node).fontSize) * room) / node.scrollWidth));
    node.style.fontSize = `${size}px`;
    while (size > least && node.scrollWidth > node.clientWidth) node.style.fontSize = `${--size}px`;
  }
}

/**
 * Sets up a page: the header (the name and the language switch), the footer's links and the title, all in the page's
 * language, and draws `view()` into <main>. Returns draw(): call it whenever the page's state changes. The focused
 * control (the language switch too) is found again after drawing by its data-key, so a keyboard or screen reader stays
 * where it was; when it's gone and focusHeading() asked, the new view's heading takes the focus.
 */
export function page({ title, view }) {
  const main = document.getElementById('app');
  const top = document.getElementById('top');
  const links = document.getElementById('links');
  const draw = () => {
    // Read before anything is drawn again: the switch in the header is drawn again too.
    const focused = document.activeElement && document.activeElement.getAttribute('data-key');
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = `${title()} | ${t('منثفُل', 'Monthful')}`;
    const other = lang === 'ar' ? 'en' : 'ar';
    top.replaceChildren(
      el('span', { class: 'brand' }, el('img', { src: '/favicon.svg', alt: '', width: 30, height: 30 }), t('منثفُل', 'Monthful')),
      el('button', {
        class: 'switch', type: 'button', lang: other, 'data-key': 'lang', 'aria-label': other === 'en' ? 'Show this page in English' : 'اعرض الصفحة بالعربي',
        onclick: () => {
          lang = other;
          store.set(LANG_KEY, other);
          draw();
          announce(t('صارت الصفحة بالعربي', 'This page is in English now'));
        },
      }, other === 'en' ? 'English' : 'العربية'),
    );
    links.replaceChildren(...LINKS.flatMap(([href, ar, en], i) => [...(i ? [el('span', { 'aria-hidden': 'true', text: ' · ' })] : []), el('a', { href }, t(ar, en))]));
    main.replaceChildren(...[view()].flat().filter(Boolean));
    fitCodes(main);
    const again = focused ? document.querySelector(`[data-key="${CSS.escape(focused)}"]`) : null;
    if (again) again.focus();
    if (again && document.activeElement === again) headingNext = false;
    else if (headingNext) {
      const heading = main.querySelector('h1');
      if (heading) {
        headingNext = false;
        heading.tabIndex = -1;
        heading.focus();
      }
    }
  };
  const refit = () => fitCodes(main);
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', refit);
  addEventListener('resize', refit);
  return draw;
}

/** The store badges, as Apple and Google draw them (brand/store-badges); Google Play's once its link is set, until then "coming soon". */
export function storeBadges() {
  return el(
    'div',
    { class: 'stores' },
    STORES.appStore ? el('a', { href: STORES.appStore, lang: 'en' }, el('img', { src: '/assets/app-store.svg', alt: 'Download on the App Store', width: 138, height: 46 })) : null,
    STORES.googlePlay
      ? el(
          'a',
          { href: STORES.googlePlay, lang: 'en' },
          el('img', { class: 'play', src: 'https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png', alt: 'Get it on Google Play', width: 175, height: 68 }),
        )
      : el('p', { class: 'soon' }, t('قريباً على Google Play', 'Coming soon to Google Play')),
  );
}

/** Says something to a screen reader (the page's one live region sits outside <main>, which is drawn again). */
export function announce(text) {
  const live = document.getElementById('live');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => {
    live.textContent = text;
  }, 60);
}

// The server -----------------------------------------------------------------------------------------------------------

/** A refused call: `code` is our function's error code ('invalid', 'full', …), Auth's error_code, 'network' or 'http_<status>'. */
export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/** One call to the API. Signed-out calls carry the publishable key alone; signed-in ones the session's token too. */
export async function call(path, { method = 'POST', body, token, headers = {}, raw } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { apikey: CONFIG.key, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const text = await res.text().catch(() => '');
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    // PostgREST: { message } (our functions raise the code as the whole message); Auth: { error_code, msg }; Storage: { error, message }.
    const code = data && typeof data === 'object' ? data.error_code || data.message || data.msg || data.error : null;
    throw new ApiError(typeof code === 'string' && code ? code : `http_${res.status}`, res.status);
  }
  return data;
}

/** A database function, signed out (the vote, the invite). */
export const rpc = (fn, args = {}) => call(`/rest/v1/rpc/${fn}`, { body: args });

// Signing in with an email code (/partners, /admin) ------------------------------------------------------------------------
// The session stays in this browser (localStorage) and is refreshed shortly before it ends; a refused refresh signs out,
// being offline doesn't.

const SESSION_KEY = 'monthful.session';
let session = store.get(SESSION_KEY);
let refreshing = null;

function keep(s) {
  session = s
    ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), user: { id: s.user && s.user.id, email: s.user && s.user.email } }
    : null;
  if (session) store.set(SESSION_KEY, session);
  else store.remove(SESSION_KEY);
}

function refresh() {
  if (!refreshing) {
    const old = session;
    refreshing = call('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: old.refresh_token } })
      .then((s) => {
        keep(s);
        return session.access_token;
      })
      .catch((e) => {
        if (e.code !== 'network' && session === old) keep(null);
        throw e;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export const auth = {
  /** The signed-in person ({ id, email }) or null. */
  user: () => (session ? session.user : null),
  /** Emails a 6-digit code. `create`: false to send it only to an existing account. */
  sendCode: (email, { create = true } = {}) => call('/auth/v1/otp', { body: { email: email.trim(), create_user: create } }),
  /** Signs in with the code; throws ApiError ('otp_expired' for a wrong or old code). */
  async verify(email, code) {
    keep(await call('/auth/v1/verify', { body: { type: 'email', email: email.trim(), token: String(code).trim() } }));
    return session.user;
  },
  /** A fresh access token, or null when signed out. */
  async token() {
    if (!session) return null;
    if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
    return refresh();
  },
  async signOut() {
    const old = session;
    keep(null);
    if (old) await call('/auth/v1/logout?scope=local', { body: {}, token: old.access_token }).catch(() => {});
  },
};

/** A call as the signed-in person; an expired token is refreshed and the call made once more. Throws 'signed_out' without a session. */
export async function asMe(path, options = {}) {
  const token = await auth.token();
  if (!token) throw new ApiError('signed_out', 401);
  try {
    return await call(path, { ...options, token });
  } catch (e) {
    if (e.status !== 401 || !session) throw e;
    return call(path, { ...options, token: await refresh() });
  }
}

/** A database function as the signed-in person. */
export const myRpc = (fn, args = {}) => asMe(`/rest/v1/rpc/${fn}`, { body: args });

/**
 * A table through PostgREST, as the signed-in person: table('partner_dishes', { method: 'PATCH', filter: { id: 'eq.…' },
 * body: { … } }). Returns the rows changed (or read).
 */
export function table(name, { method = 'GET', filter = {}, select = '*', body } = {}) {
  const query = new URLSearchParams({ select, ...filter });
  return asMe(`/rest/v1/${name}?${query}`, { method, body, headers: method === 'GET' ? {} : { prefer: 'return=representation' } });
}

/** Private storage, as the signed-in person: upload a file to bucket/path, and a signed link to show one for a while. */
export const files = {
  upload: (bucket, path, file, { upsert = false } = {}) =>
    asMe(`/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
      raw: file,
      headers: { 'content-type': file.type || 'application/octet-stream', 'x-upsert': String(upsert) },
    }),
  async signedUrl(bucket, path, seconds = 600) {
    const data = await asMe(`/storage/v1/object/sign/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, { body: { expiresIn: seconds } });
    return `${API}/storage/v1${data.signedURL}`;
  },
  remove: (bucket, paths) => asMe(`/storage/v1/object/${bucket}`, { method: 'DELETE', body: { prefixes: paths } }),
};
