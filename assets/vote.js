// monthful.app/vote#TOKEN: the family vote (supabase/README.md, "Family vote"). Whoever has the link picks one of 2 or
// 3 dishes with one tap, no account: one vote per browser (a random id kept here, a new one for each poll so polls can't
// be linked), changed with another tap until the poll closes. The counts show once they've voted, and when it's closed.
// A poll holds recipe ids only: names and photos come from the site's own dish file (/dishes.json), and an id it doesn't
// know is left out. No names anywhere.
import { announce, counted, dayName, el, focusHeading, num, page, rpc, store, storeBadges, t, whenName } from './site.js?v=0a3adf5db8';

const TOKEN = /^[0-9a-f]{32}$/;
const VOTERS = 'monthful.votes';
/** A poll takes 50 voters (cast_vote: 'full'); those in can still change their vote. */
const MAX_VOTERS = 50;
const VOTES = { ar: ['ولا صوت', 'صوت واحد', 'صوتين', '{n} أصوات', '{n} صوت'], en: ['No votes', '1 vote', '{n} votes'] };

/** loading | gone (unknown, deleted a week after closing, or a broken link) | error (offline) | ready */
let state = 'loading';
let token = '';
let poll = null;
let dishes = null;
/** The choice being sent, or null. */
let sending = null;
/** Why the last tap didn't count: 'closed' | 'full' | 'network' | 'failed' | null. */
let refused = null;
let asked = 0;

// This browser's voter id for a poll. Kept in memory too, so voting works with storage blocked (until the page closes).
const memory = {};
function voter(poll) {
  if (memory[poll]) return memory[poll];
  const kept = store.get(VOTERS);
  const all = kept && typeof kept === 'object' ? kept : {};
  if (typeof all[poll] === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(all[poll])) return (memory[poll] = all[poll]);
  const id = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // The last 50 polls' ids are enough: a poll is gone a week after it closes.
  const recent = Object.entries(all).filter(([k, v]) => TOKEN.test(k) && typeof v === 'string').slice(-49);
  store.set(VOTERS, Object.fromEntries([...recent, [poll, id]]));
  return (memory[poll] = id);
}

let dishFile = null;
function loadDishes() {
  if (!dishFile) {
    dishFile = fetch('/dishes.json', { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .catch((e) => {
        dishFile = null;
        throw e;
      });
  }
  return dishFile;
}

async function load() {
  const ask = ++asked;
  token = location.hash.slice(1).trim().toLowerCase();
  refused = null;
  sending = null;
  if (!TOKEN.test(token)) {
    state = 'gone';
    return draw();
  }
  state = 'loading';
  draw();
  try {
    const [found, file] = await Promise.all([rpc('get_poll', { p_token: token, p_voter: voter(token) }), loadDishes()]);
    if (ask !== asked) return;
    poll = found;
    dishes = file;
    state = poll ? 'ready' : 'gone';
  } catch {
    if (ask !== asked) return;
    state = 'error';
  }
  draw();
}

/** The poll again (after a refused vote, or coming back to the page); keeps what's shown when it can't. */
async function reload() {
  try {
    const found = await rpc('get_poll', { p_token: token, p_voter: voter(token) });
    if (!found) state = 'gone';
    else poll = found;
  } catch {
    // Offline: what's shown stays.
  }
}

async function vote(choice) {
  if (sending !== null || !poll || poll.closed || poll.mine === choice) return;
  const changing = poll.mine != null;
  sending = choice;
  refused = null;
  draw();
  try {
    const counts = await rpc('cast_vote', { p_token: token, p_voter: voter(token), p_choice: choice });
    poll = { ...poll, counts: Array.isArray(counts) ? counts : poll.counts, mine: choice };
    announce(changing ? t('غيّرنا صوتك', 'Your vote is changed') : t('وصل صوتك', 'Your vote is in'));
  } catch (e) {
    refused = e.code === 'closed' || e.code === 'full' || e.code === 'network' ? e.code : 'failed';
    if (refused !== 'network') await reload();
    announce(refusedText());
  }
  sending = null;
  draw();
}

function refusedText(why = refused) {
  return {
    closed: t('قفل التصويت قبل ما يوصل صوتك.', 'Voting closed before your vote got in.'),
    full: t(`وصل التصويت لحدّه: ${MAX_VOTERS} شخص صوّتوا، فما نقدر نضيف صوتك.`, `This vote is full: ${MAX_VOTERS} people have voted, so yours can't be added.`),
    network: t('ما وصل صوتك. تأكد من الإنترنت وجرّب مرة ثانية.', "Your vote didn't go through. Check your connection and try again."),
    failed: t('ما وصل صوتك، جرّب مرة ثانية.', "Your vote didn't go through. Please try again."),
  }[why];
}

/** «وش نطبخ غداء الخميس؟» from the poll's day and meal, in the visitor's language. */
function question() {
  const day = dayName(poll.day);
  const on = day.rel ? day.name : `on ${day.name}`;
  switch (poll.slot) {
    case 'breakfast':
      return t(`وش نفطر ${day.name}؟`, `What should we have for breakfast ${on}?`);
    case 'lunchbox':
      return t(`وش نحط في علبة المدرسة ${day.name}؟`, `What goes in the school lunchbox ${on}?`);
    case 'dinner':
      return t(`وش نطبخ عشاء ${day.name}؟`, `What should we cook for dinner ${on}?`);
    default:
      return t(`وش نطبخ غداء ${day.name}؟`, `What should we cook for lunch ${on}?`);
  }
}

const dishName = (dish) => t(dish.ar || dish.en, dish.en || dish.ar);
/** «كبسة ومندي»، «كبسة، مندي ومرقوق» / "kabsa, mandi and margoog". */
const both = (names, and) => (names.length > 1 ? `${names.slice(0, -1).join(t('، ', ', '))}${and}${names[names.length - 1]}` : names.join(''));

/**
 * The counts, what's shown and who leads. The lead and the bars count every dish in the poll, the ones this site can't
 * show too (a recipe newer than its dish file), so a shown dish is never named the winner over one with more votes:
 * `unseen` is how many of the leaders aren't shown, `hidden` the votes for dishes that aren't (the total says so).
 */
function results() {
  const counts = poll.options.map((_, i) => Number(poll.counts && poll.counts[i]) || 0);
  const shown = poll.options.map((id, i) => ({ i, dish: dishes[id] })).filter((o) => o.dish && typeof o.dish === 'object');
  const isShown = (i) => shown.some((o) => o.i === i);
  const total = counts.reduce((a, b) => a + b, 0);
  const most = Math.max(0, ...counts);
  const leaders = poll.closed && most > 0 ? counts.flatMap((c, i) => (c === most ? [i] : [])) : [];
  const top = shown.filter((o) => leaders.includes(o.i));
  const unseen = leaders.length - top.length;
  const hidden = counts.reduce((sum, c, i) => (isShown(i) ? sum : sum + c), 0);
  const hiddenDishes = counts.filter((c, i) => c > 0 && !isShown(i)).length;
  // Full for someone who hasn't voted: each voter counts once, so the counts say so before a tap is refused.
  const full = !poll.closed && poll.mine == null && (refused === 'full' || total >= MAX_VOTERS);
  return { counts, shown, total, top, tied: leaders.length > 1, unseen, hidden, hiddenDishes, full };
}

function header({ shown, total, top, tied, unseen, full }) {
  const mine = poll.mine != null;
  let line;
  if (poll.closed) {
    const names = [
      ...top.map((o) => dishName(o.dish)),
      ...(unseen ? [unseen > 1 ? t('طبخات ما نقدر نعرضها هنا', "dishes we can't show here") : t('طبخة ما نقدر نعرضها هنا', "a dish we can't show here")] : []),
    ];
    if (!total) line = t('انتهى التصويت وما صوّت أحد.', 'Voting has ended, and nobody voted.');
    else if (unseen && !top.length) {
      line =
        unseen > 1
          ? t('الطبخات اللي أخذت أكثر الأصوات ما نقدر نعرضها هنا، بس تلقاها في منثفُل.', "The dishes with the most votes can't be shown here, but you'll find them in Monthful.")
          : t('الطبخة اللي أخذت أكثر الأصوات ما نقدر نعرضها هنا، بس تلقاها في منثفُل.', "The dish with the most votes can't be shown here, but you'll find it in Monthful.");
    } else if (tied) line = t(`تعادل بين ${both(names, ' و')}.`, `A tie between ${both(names, ' and ')}.`);
    else if (top.length === 1) line = t(`الأكثر أصوات: ${dishName(top[0].dish)}.`, `Most votes: ${dishName(top[0].dish)}.`);
    else line = t('انتهى التصويت.', 'Voting has ended.');
  } else if (full) line = t(`يقفل التصويت ${whenName(poll.closes_at)}.`, `Voting closes ${whenName(poll.closes_at)}.`);
  else if (mine) line = t(`وصل صوتك. تقدر تغيّره لين يقفل التصويت ${whenName(poll.closes_at)}.`, `Your vote is in. You can change it until voting closes ${whenName(poll.closes_at)}.`);
  else line = t(`اختر طبخة وحدة. يقفل التصويت ${whenName(poll.closes_at)}.`, `Pick one dish. Voting closes ${whenName(poll.closes_at)}.`);
  return [
    el('p', { class: 'over' }, poll.closed ? t('انتهى التصويت', 'Voting has ended') : t('تصويت العيلة', 'Family vote')),
    el('h1', {}, question()),
    shown.length ? el('p', { class: 'muted' }, line) : null,
  ];
}

function card({ i, dish }, { counts, total, top, tied, full }) {
  const mine = poll.mine === i;
  const showCounts = poll.closed || poll.mine != null || full;
  const share = total ? Math.round((counts[i] / total) * 100) : 0;
  const bar = el('span', {});
  bar.style.width = `${share}%`;
  const winner = top.some((o) => o.i === i);
  const body = el(
    'span',
    {},
    el('span', { class: 'name' }, dishName(dish)),
    showCounts ? el('span', { class: 'bar', 'aria-hidden': 'true' }, bar) : null,
    showCounts ? el('span', { class: 'count' }, counted(counts[i], VOTES)) : null,
    sending === i ? el('span', { class: 'count' }, t('نرسل صوتك…', 'Sending your vote…')) : null,
    mine || winner
      ? el('span', {}, mine ? el('span', { class: 'tag' }, t('صوتك', 'Your vote')) : null, winner ? el('span', { class: 'tag' }, tied ? t('تعادل', 'Tied') : t('الأكثر أصوات', 'Most votes')) : null)
      : null,
  );
  const photo = typeof dish.image === 'string' && dish.image ? el('img', { src: `/dishes/${encodeURIComponent(dish.image)}.webp`, alt: '', width: 360, height: 450, decoding: 'async' }) : null;
  const look = `pick${photo ? '' : ' nophoto'}${winner ? ' top' : ''}`;
  // Closed (or full for someone who hasn't voted): results to read, not buttons.
  if (poll.closed || full) return el('li', {}, el('div', { class: look }, photo, body));
  return el(
    'li',
    {},
    el('button', { class: look, type: 'button', 'aria-pressed': String(mine), 'data-key': `pick-${i}`, disabled: sending !== null && sending !== i ? true : null, onclick: () => vote(i) }, photo, body),
  );
}

/** «المجموع: 6 أصوات»، and when some went to dishes not shown here «، منها 4 أصوات لطبخة ما نقدر نعرضها هنا». */
function totalLine({ total, hidden, hiddenDishes }) {
  const all = counted(total, VOTES);
  if (!hidden) return t(`المجموع: ${all}`, `In all: ${all}`);
  return hiddenDishes > 1
    ? t(`المجموع: ${all}، منها ${counted(hidden, VOTES)} لطبخات ما نقدر نعرضها هنا`, `In all: ${all}, ${num(hidden)} of them for dishes we can't show here`)
    : t(`المجموع: ${all}، منها ${counted(hidden, VOTES)} لطبخة ما نقدر نعرضها هنا`, `In all: ${all}, ${num(hidden)} of them for a dish we can't show here`);
}

/** One line on what Monthful is, for family members who don't have it. */
const about = () =>
  el('section', { class: 'about' }, el('p', { class: 'muted small' }, t('منثفُل يخطّط وجبات الشهر ومقاضيه على قد ميزانيتك.', "Monthful plans your month's meals and groceries within your budget.")), storeBadges());

function view() {
  if (state === 'loading') return el('p', { class: 'loading', role: 'status' }, t('نجيب التصويت…', 'Getting the vote…'));
  if (state === 'gone') {
    return [
      el(
        'section',
        { class: 'card' },
        el('p', { class: 'over' }, t('تصويت العيلة', 'Family vote')),
        el('h1', {}, t('ما لقينا هالتصويت', "We couldn't find this vote")),
        el('p', { class: 'muted' }, t('يمكن خلص من أكثر من أسبوع، أو الرابط ناقص. اطلب الرابط مرة ثانية.', 'It may have ended more than a week ago, or the link may be incomplete. Ask for the link again.')),
      ),
      about(),
    ];
  }
  if (state === 'error') {
    return el(
      'section',
      { class: 'card' },
      el('p', { class: 'over' }, t('تصويت العيلة', 'Family vote')),
      el('h1', {}, t('ما قدرنا نفتح التصويت', "We couldn't open the vote")),
      el('p', { class: 'muted' }, t('تأكد من الإنترنت وجرّب مرة ثانية.', 'Check your connection and try again.')),
      el('button', { class: 'btn main', type: 'button', 'data-key': 'retry', onclick: () => (focusHeading(), load()) }, t('جرّب مرة ثانية', 'Try again')),
    );
  }
  const r = results();
  const showTotal = r.shown.length && r.total > 0 && (poll.closed || poll.mine != null || r.full);
  // A full poll says why there's nothing to tap, whether a tap was refused or the counts already said so.
  const why = r.full ? 'full' : refused;
  return [
    el(
      'section',
      { class: 'card' },
      header(r),
      r.shown.length
        ? el('ul', { class: 'picks', 'aria-busy': sending !== null ? 'true' : null }, r.shown.map((o) => card(o, r)))
        : el('p', { class: 'note warn' }, t('ما قدرنا نعرض أطباق هالتصويت. اطلب الرابط مرة ثانية بعد شوي.', "We can't show this vote's dishes. Ask for the link again in a little while.")),
      showTotal ? el('p', { class: 'total' }, totalLine(r)) : null,
      why ? el('p', { class: why === 'full' ? 'note' : 'note warn' }, refusedText(why)) : null,
    ),
    about(),
  ];
}

const draw = page({ title: () => t('تصويت العيلة', 'Family vote'), view });
addEventListener('hashchange', load);
// Back on the page (the family group chat, then back): the latest counts.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || state !== 'ready' || sending !== null) return;
  await reload();
  draw();
});
load();
