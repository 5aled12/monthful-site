// monthful.app/join#CODE: an invite to someone's shared home (supabase/README.md, "Shared home"). It asks the server
// whether the code works and whose home it is (peek_invite: that and the inviter's first name, nothing else), shows the
// code to copy, opens the app on it (monthful://join/CODE), and walks someone without the app through getting it.
import { announce, el, focusHeading, page, rpc, storeBadges, t } from './site.js?v=0a3adf5db8';

/** 8 characters that can't be mistaken for each other (no 0/O, 1/I/L); typed in any case, with spaces or dashes. */
const CODE = /^[2-9A-HJKMNP-Z]{8}$/;
const readCode = () => {
  try {
    return decodeURIComponent(location.hash.slice(1)).toUpperCase().replace(/[^0-9A-Z]/g, '');
  } catch {
    return '';
  }
};

/** loading | missing (no code in the link) | invalid (unknown, used, expired or mistyped) | error (offline) | valid */
let state = { kind: 'loading', code: '' };
/** Tapped «افتح منثفُل» and still here a moment later: the app probably isn't on this phone. */
let stillHere = false;
let asked = 0;

async function load() {
  const code = readCode();
  const ask = ++asked;
  stillHere = false;
  copied = null;
  if (!code) state = { kind: 'missing', code };
  else if (!CODE.test(code)) state = { kind: 'invalid', code };
  else {
    state = { kind: 'loading', code };
    draw();
    try {
      const peek = await rpc('peek_invite', { p_code: code });
      if (ask !== asked) return;
      const name = peek && typeof peek.inviter_name === 'string' && peek.inviter_name.trim() ? peek.inviter_name.trim() : null;
      state = peek && peek.valid === true ? { kind: 'valid', code, name } : { kind: 'invalid', code };
    } catch {
      if (ask !== asked) return;
      state = { kind: 'error', code };
    }
  }
  draw();
}

/** null | 'done' (for a moment) | 'failed' */
let copied = null;
let copiedTimer = 0;

async function copy() {
  clearTimeout(copiedTimer);
  try {
    await navigator.clipboard.writeText(state.code);
    copied = 'done';
    draw();
    announce(t('انتسخ الكود', 'Code copied'));
    copiedTimer = setTimeout(() => {
      copied = null;
      draw();
    }, 2500);
  } catch {
    // Some browsers refuse: the code is selected instead, ready to copy.
    copied = 'failed';
    draw();
    const value = document.querySelector('.code-value');
    if (value) getSelection().selectAllChildren(value);
    announce(t('ما انتسخ، انسخه بنفسك أو اكتبه', "Couldn't copy it: copy or type it yourself"));
  }
}

function opening() {
  stillHere = false;
  let left = false;
  const away = () => {
    if (document.visibilityState === 'hidden') left = true;
  };
  document.addEventListener('visibilitychange', away);
  setTimeout(() => {
    document.removeEventListener('visibilitychange', away);
    if (!left && state.kind === 'valid') {
      stillHere = true;
      draw();
      announce(t('ما انفتح؟ نزّل منثفُل أول، وبعدين ارجع هنا.', "Didn't open? Get Monthful first, then come back here."));
    }
  }, 1800);
}

const over = () => el('p', { class: 'over' }, t('البيت المشترك', 'Shared home'));

/**
 * Whose home it is, when the owner gave a first name. The server knows only the name, not whether the owner is a man or a
 * woman, so the words never guess it (as the app never guesses Mr. or Ms. from a name): «جاتك دعوة من سارة».
 */
function invite() {
  const { code, name } = state;
  const title = name ? t(['جاتك دعوة من ', el('bdi', {}, name)], ['An invite from ', el('bdi', {}, name)]) : t('جاتك دعوة لبيت في منثفُل', "You're invited to a home on Monthful");
  const line = name
    ? t('تنضم لبيتهم في منثفُل وتشاركون خطة الشهر والمقاضي من جوالين، باشتراك واحد.', "Join their home on Monthful and share one month's plan and grocery list from two phones, on one subscription.")
    : t('تشاركون خطة الشهر والمقاضي من جوالين، باشتراك واحد.', "Share one month's plan and grocery list from two phones, on one subscription.");
  return el(
    'section',
    { class: 'card' },
    over(),
    el('h1', {}, title),
    el('p', { class: 'muted' }, line),
    el(
      'div',
      { class: 'code' },
      el('p', { class: 'code-label', id: 'code-label' }, t('كود الدعوة', 'Invite code')),
      // Shown in two halves with a gap that isn't a space, so a selected code copies as one word; a screen reader spells it.
      el('p', { class: 'code-value big', dir: 'ltr', lang: 'en', 'aria-hidden': 'true' }, el('span', {}, code.slice(0, 4)), el('span', {}, code.slice(4))),
      el('p', { class: 'sr-only', lang: 'en' }, code.split('').join(' ')),
      el('button', { class: 'btn small', type: 'button', 'data-key': 'copy', 'aria-describedby': 'code-label', onclick: copy }, copied === 'done' ? t('انتسخ', 'Copied') : t('انسخ', 'Copy')),
      copied === 'failed' ? el('p', { class: 'note warn' }, t('ما انتسخ: حدّدناه لك، انسخه أو اكتبه.', "Couldn't copy it: it's selected, so copy or type it.")) : null,
    ),
    el('a', { class: 'btn main', href: `monthful://join/${code}`, 'data-key': 'open', onclick: opening }, t('افتح منثفُل', 'Open Monthful')),
    el('p', { class: 'small muted center' }, t('الكود يشتغل مرة وحدة، خلال 7 أيام من إرساله.', 'The code works once, within 7 days of being sent.')),
    stillHere ? el('p', { class: 'note' }, t('ما انفتح؟ نزّل منثفُل أول من تحت، وبعدين ارجع هنا.', "Didn't open? Get Monthful first (below), then come back here.")) : null,
  );
}

/** For someone who hasn't got the app yet. */
function steps() {
  return el(
    'section',
    { class: 'section card' },
    el('h2', {}, t('ما عندك منثفُل؟', "Don't have Monthful yet?")),
    el(
      'ol',
      { class: 'steps' },
      el('li', {}, t('نزّله من المتجر:', 'Download it:'), storeBadges()),
      el('li', {}, t('افتحه وادخل بحسابك، أو سوّ حساب جديد.', 'Open it and sign in, or make an account.')),
      el('li', {}, t('ارجع لهالصفحة واضغط «افتح منثفُل»، أو اكتب الكود في التطبيق.', 'Come back to this page and tap Open Monthful, or type the code in the app.')),
    ),
  );
}

function view() {
  switch (state.kind) {
    case 'loading':
      return el('p', { class: 'loading', role: 'status' }, t('نتأكد من الدعوة…', 'Checking the invite…'));
    case 'valid':
      return [invite(), steps()];
    case 'missing':
      return el(
        'section',
        { class: 'card' },
        over(),
        el('h1', {}, t('الرابط ناقص', 'This link is missing its code')),
        el('p', { class: 'muted' }, t('افتح الرابط كامل مثل ما وصلك، أو اطلب من اللي أرسله يرسله مرة ثانية.', 'Open the whole link as you got it, or ask whoever sent it to send it again.')),
      );
    case 'invalid':
      return el(
        'section',
        { class: 'card' },
        over(),
        el('h1', {}, t('هالدعوة ما عادت تشتغل', "This invite doesn't work anymore")),
        el(
          'p',
          { class: 'muted' },
          t(
            'الدعوة تشتغل مرة وحدة خلال 7 أيام: يمكن انستعملت أو خلص وقتها، أو الكود فيه غلط. اطلب من اللي أرسلها لك دعوة جديدة.',
            'An invite works once, within 7 days: this one may have been used or run out, or the code has a typo. Ask whoever sent it for a new one.',
          ),
        ),
      );
    default:
      return [
        el(
          'section',
          { class: 'card' },
          over(),
          el('h1', {}, t('ما قدرنا نفتح الدعوة', "We couldn't open the invite")),
          el('p', { class: 'muted' }, t('تأكد من الإنترنت وجرّب مرة ثانية.', 'Check your connection and try again.')),
          el('button', { class: 'btn main', type: 'button', 'data-key': 'retry', onclick: () => (focusHeading(), load()) }, t('جرّب مرة ثانية', 'Try again')),
        ),
      ];
  }
}

const draw = page({ title: () => t('دعوة لبيت', 'An invite to a home'), view });
addEventListener('hashchange', load);
load();
