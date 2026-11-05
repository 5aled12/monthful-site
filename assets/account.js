// What monthful.app/partners and /admin share: signing in with an email code (no password; supabase/README.md,
// "Influencer program"), the signed-in line with Sign out, form fields, riyals and dates. Built on site.js, the same way:
// every text through el() / textContent, never HTML.
import { announce, auth, counted, el, focusHeading, lang, num, t } from './site.js?v=0a3adf5db8';

export const SUPPORT = 'support@monthful.app';

/** Arabic-Indic and Persian digits as Western ones (a phone's Arabic keyboard types ٣٠). */
export const western = (s) =>
  String(s)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[٫]/g, '.')
    .replace(/[٬،]/g, '');

const locale = () => (lang === 'ar' ? 'ar-u-nu-latn-ca-gregory' : 'en-GB');

/** Riyals, Western digits: «1,234.50 ريال» / "SAR 1,234.50"; halalas only when there are some. */
export function riyals(n) {
  const value = Number(n) || 0;
  const digits = Math.round(value * 100) % 100 ? 2 : 0;
  const amount = num(value, { minimumFractionDigits: digits, maximumFractionDigits: 2 });
  return t(`${amount} ريال`, `SAR ${amount}`);
}

/** Riyals for a number tile: the amount big and the currency small beside it, so a long amount keeps one line. */
export function money(n) {
  const value = Number(n) || 0;
  const digits = Math.round(value * 100) % 100 ? 2 : 0;
  const amount = el('span', { class: 'figure' }, num(value, { minimumFractionDigits: digits, maximumFractionDigits: 2 }));
  return t([amount, ' ', el('span', { class: 'unit' }, 'ريال')], [el('span', { class: 'unit' }, 'SAR'), ' ', amount]);
}

/** A number tile: its label and its value (dt / dd in a <dl class="stats">); wide spans the row. */
export const stat = (label, value, wide) => el('div', { class: `stat${wide ? ' wide' : ''}` }, el('dt', {}, label), el('dd', { class: 'big' }, value));

/** A date as people read it: «4 نوفمبر 2026» / "4 November 2026". */
export const dateName = (iso) => (iso ? new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)) : '');

/** The text for a refusal every page can meet: offline, signed out, or something we didn't expect. */
export function problem(e) {
  const code = e && e.code;
  if (code === 'network') return t('ما وصلنا للخادم. تأكد من الإنترنت وجرّب مرة ثانية.', "We couldn't reach the server. Check your connection and try again.");
  if (code === 'signed_out') return t('انتهى دخولك. ادخل مرة ثانية.', 'You were signed out. Please sign in again.');
  return t('ما ضبطت. جرّب مرة ثانية بعد شوي.', "That didn't work. Please try again in a moment.");
}

// Form fields ----------------------------------------------------------------------------------------------------------

const LETTER = /[A-Za-zÀ-ɏͰ-ԯ֐-ࣿיִ-﷿ﹰ-﻿]/;
const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
/** Arabic marks that aren't letters: the comma, the harakat and Arabic-Indic digits. */
const NOT_LETTERS = /[،ً-ٟ٠-٩ٰۖ-ۭ۰-۹]/g;

/**
 * Which way free text runs, from its first letter: Arabic right to left, English left to right («1. حمّري البصل» is
 * Arabic), and the page's way before there's a letter. Like dir="auto", except that an empty field on the Arabic page
 * starts on the right, where the first Arabic letter will go (dir="auto" starts an empty field left to right).
 */
function writingDir(text) {
  const first = String(text).replace(NOT_LETTERS, '').match(LETTER);
  if (first) return RTL_LETTER.test(first[0]) ? 'rtl' : 'ltr';
  return lang === 'ar' ? 'rtl' : 'ltr';
}

/**
 * A labelled field: field({ key, label, value, onInput, hint, error, rows }) is an <input> (a <textarea> with rows), its
 * label, a hint under the label and the error under the field, tied to it for screen readers. Other props go on the
 * control (type, maxlength, inputmode, dir…). A textarea is free text in either language whatever the page's (a recipe
 * written in Arabic on the English page), so unless told otherwise it runs the way it's written (writingDir), as they
 * type. The value lives in the page's state: onInput keeps it there as they type, so drawing the page again never loses it.
 */
export function field({ key, label, value = '', onInput, hint, error, rows, ...props }) {
  const id = `f-${key}`;
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ');
  const free = Boolean(rows) && !('dir' in props);
  const control = el(rows ? 'textarea' : 'input', {
    id, name: key, 'data-key': key, rows, dir: free ? writingDir(value == null ? '' : value) : null, 'aria-describedby': described || null, 'aria-invalid': error ? 'true' : null, ...props,
    oninput: (e) => {
      if (free) e.target.dir = writingDir(e.target.value);
      onInput(e.target.value);
    },
  });
  control.value = value == null ? '' : String(value);
  return el(
    'div',
    { class: 'field' },
    el('label', { for: id }, label),
    hint ? el('p', { class: 'hint', id: `${id}-hint` }, hint) : null,
    control,
    error ? el('p', { class: 'error', id: `${id}-error` }, error) : null,
  );
}

/** A labelled <select>: options are [value, text] pairs; an empty value is the "pick one" line. */
export function choice({ key, label, value = '', options, onInput, error }) {
  const id = `f-${key}`;
  const control = el(
    'select',
    { id, name: key, 'data-key': key, 'aria-describedby': error ? `${id}-error` : null, 'aria-invalid': error ? 'true' : null, onchange: (e) => onInput(e.target.value) },
    options.map(([v, text]) => el('option', { value: v, selected: v === value ? true : null }, text)),
  );
  return el('div', { class: 'field' }, el('label', { for: id }, label), control, error ? el('p', { class: 'error', id: `${id}-error` }, error) : null);
}

/** A labelled checkbox. */
export function tick({ key, label, checked, onInput }) {
  const id = `f-${key}`;
  return el(
    'div',
    { class: 'field check' },
    el('input', { id, type: 'checkbox', 'data-key': key, checked: checked ? true : null, onchange: (e) => onInput(e.target.checked) }),
    el('label', { for: id }, label),
  );
}

/** A form that never leaves the page: Enter or its button calls onSubmit. */
export const form = ({ label, onSubmit }, ...children) =>
  el('form', { 'aria-label': label || null, novalidate: true, onsubmit: (e) => (e.preventDefault(), onSubmit()) }, ...children);

// A partner's dish (partner_dishes) --------------------------------------------------------------------------------------

export const MEALS = { breakfast: ['فطور', 'Breakfast'], lunch: ['غداء', 'Lunch'], dinner: ['عشاء', 'Dinner'], dessert: ['حلا', 'Dessert'], snack: ['سناك', 'Snack'] };
export const mealName = (m) => (MEALS[m] ? t(...MEALS[m]) : '');
const PEOPLE = { ar: ['', 'شخص واحد', 'شخصين', '{n} أشخاص', '{n} شخص'], en: ['', 'one person', '{n} people'] };
/** «غداء · تكفي 6 أشخاص» / "Lunch · Serves 6 people". */
export const mealLine = (d) => `${mealName(d.meal)} · ${t('تكفي ', 'Serves ')}${counted(Number(d.servings) || 1, PEOPLE)}`;
/** Its name in the page's language (the other one when it has only that). */
export const dishName = (d) => t(d.name_ar || d.name_en, d.name_en || d.name_ar) || '';

/** The fields as the server wants them, from what's typed. */
export const dishRow = (d) => ({
  name_ar: d.name_ar.trim() || null,
  name_en: d.name_en.trim() || null,
  meal: d.meal,
  servings: Number(western(d.servings).trim()),
  ingredients: d.ingredients.trim(),
  steps: d.steps.trim(),
});

/** What's missing or out of range, by field (the server's checks, said before sending). */
export function checkDish(d) {
  const errors = {};
  if (!d.name_ar.trim() && !d.name_en.trim()) errors.name_ar = t('اكتب اسمها بالعربي أو بالإنجليزي.', 'Give it a name in Arabic or English.');
  if (!MEALS[d.meal]) errors.meal = t('اختر الوجبة.', 'Pick the meal.');
  const n = Number(western(d.servings).trim());
  if (!Number.isInteger(n) || n < 1 || n > 30) errors.servings = t('رقم من 1 لين 30.', 'A number from 1 to 30.');
  if (!d.ingredients.trim()) errors.ingredients = t('اكتب المكونات وكمياتها.', 'Write the ingredients and their amounts.');
  if (!d.steps.trim()) errors.steps = t('اكتب الخطوات.', 'Write the steps.');
  return errors;
}

/** The dish's fields: both names, the meal, servings, ingredients and steps; d holds what's typed and d.errors. */
export function dishFields(d) {
  const set = (key) => (v) => {
    d[key] = v;
  };
  const errors = d.errors || {};
  return [
    field({ key: 'name_ar', label: t('اسمها بالعربي', 'Its name in Arabic'), hint: t('بالعربي أو بالإنجليزي، أو الاثنين.', 'In Arabic, English or both.'), value: d.name_ar, maxlength: 80, dir: 'rtl', lang: 'ar', error: errors.name_ar, onInput: set('name_ar') }),
    field({ key: 'name_en', label: t('اسمها بالإنجليزي', 'Its name in English'), value: d.name_en, maxlength: 80, dir: 'ltr', lang: 'en', onInput: set('name_en') }),
    choice({ key: 'meal', label: t('الوجبة', 'Meal'), value: d.meal, error: errors.meal, options: [['', t('اختر الوجبة', 'Pick the meal')], ...Object.keys(MEALS).map((m) => [m, mealName(m)])], onInput: set('meal') }),
    field({ key: 'servings', label: t('تكفي كم شخص؟', 'How many does it serve?'), value: d.servings, inputmode: 'numeric', maxlength: 2, class: 'short', error: errors.servings, onInput: set('servings') }),
    field({
      key: 'ingredients', label: t('المكونات وكمياتها', 'Ingredients and amounts'), hint: t('كل مكوّن في سطر مع كميته، مثل: 2 كوب رز بسمتي', 'One per line with its amount, like: 2 cups basmati rice'), value: d.ingredients,
      rows: 7, maxlength: 4000, error: errors.ingredients, onInput: set('ingredients'),
    }),
    field({
      key: 'steps', label: t('الخطوات', 'Steps'), hint: t('كل خطوة في سطر: وش تسوي، على أي نار، كم تاخذ، وكيف تعرف إنها جاهزة.', 'One per line: what to do, on what heat, for how long, and how you know it is done.'), value: d.steps,
      rows: 9, maxlength: 8000, error: errors.steps, onInput: set('steps'),
    }),
  ];
}

// Signing in -----------------------------------------------------------------------------------------------------------

/** email → code. Kept here, so drawing the page again keeps what they typed. */
const signIn = { step: 'email', email: '', code: '', busy: false, error: null, note: null };

export function resetSignIn() {
  Object.assign(signIn, { step: 'email', email: '', code: '', busy: false, error: null, note: null });
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function authProblem(e) {
  const code = e && e.code;
  if (code === 'otp_expired') return t('الرمز غلط أو انتهى. تأكد منه، أو اطلب رمز جديد.', "That code is wrong or has expired. Check it, or ask for a new one.");
  if (e && e.status === 429) return t('طلبت رموز كثير ورا بعض. انتظر دقيقة وجرّب مرة ثانية.', 'Too many codes in a row. Wait a minute and try again.');
  if (code === 'validation_failed' || code === 'email_address_invalid') return t('تأكد من الإيميل.', 'Please check the email address.');
  return problem(e);
}

/**
 * The sign-in card: the email, then the 6-digit code we send to it (it signs in by itself on the sixth digit, like the
 * app). `over` and `line` say whose page this is. onSignedIn runs once they're in.
 */
export function signInCard({ draw, onSignedIn, over, line }) {
  const focus = (key) => {
    const node = document.getElementById(`f-${key}`);
    if (node) node.focus();
  };
  const send = async () => {
    const again = signIn.step === 'code';
    const email = signIn.email.trim().toLowerCase();
    if (!EMAIL.test(email)) {
      signIn.error = t('اكتب إيميلك كامل، مثل name@example.com', 'Type your whole email, like name@example.com');
      draw();
      return focus('email');
    }
    signIn.busy = true;
    signIn.error = null;
    signIn.note = null;
    draw();
    try {
      await auth.sendCode(email);
      Object.assign(signIn, { step: 'code', email, code: '', note: again ? t('أرسلنا لك رمز جديد.', 'We sent you a new code.') : null });
    } catch (e) {
      signIn.error = authProblem(e);
    }
    signIn.busy = false;
    draw();
    focus(signIn.step);
  };
  const verify = async () => {
    const code = western(signIn.code).replace(/\D/g, '');
    if (code.length !== 6) {
      signIn.error = t('الرمز 6 أرقام.', 'The code has 6 digits.');
      draw();
      return focus('code');
    }
    signIn.busy = true;
    signIn.error = null;
    signIn.note = null;
    draw();
    try {
      await auth.verify(signIn.email, code);
      resetSignIn();
      // Their page (or the calm note) starts at its heading once it's there, not at the top of the document.
      focusHeading();
      onSignedIn();
      return;
    } catch (e) {
      signIn.error = authProblem(e);
      signIn.code = '';
    }
    signIn.busy = false;
    draw();
  };

  if (signIn.step === 'email') {
    return el(
      'section',
      { class: 'card' },
      el('p', { class: 'over' }, over),
      el('h1', {}, t('ادخل بإيميلك', 'Sign in with your email')),
      el('p', { class: 'muted' }, line),
      form(
        { onSubmit: send },
        field({
          key: 'email', label: t('الإيميل', 'Email'), value: signIn.email, type: 'email', autocomplete: 'email', inputmode: 'email', dir: 'ltr', lang: 'en', maxlength: 254,
          spellcheck: 'false', autocapitalize: 'none', error: signIn.error, onInput: (v) => (signIn.email = v),
        }),
        el('button', { class: 'btn main', type: 'submit', 'data-key': 'send', disabled: signIn.busy || null }, signIn.busy ? t('نرسل الرمز…', 'Sending the code…') : t('أرسل لي الرمز', 'Send me a code')),
      ),
      el('p', { class: 'small muted center' }, t('نرسل لك رمز من 6 أرقام. ما فيه كلمة مرور.', "We'll email you a 6-digit code. There's no password.")),
    );
  }
  return el(
    'section',
    { class: 'card' },
    el('p', { class: 'over' }, over),
    el('h1', {}, t('اكتب الرمز', 'Type the code')),
    el('p', { class: 'muted' }, t('أرسلنا رمز من 6 أرقام إلى ', 'We sent a 6-digit code to '), el('bdi', { dir: 'ltr' }, signIn.email), t('. لو ما وصل خلال دقيقة، شيّك على البريد غير المهم.', ". If it isn't there in a minute, check your junk folder.")),
    signIn.note ? el('p', { class: 'note', role: 'status' }, signIn.note) : null,
    form(
      { onSubmit: verify },
      field({
        key: 'code', label: t('الرمز', 'Code'), value: signIn.code, inputmode: 'numeric', autocomplete: 'one-time-code', dir: 'ltr', lang: 'en', maxlength: 6, class: 'otp',
        error: signIn.error,
        onInput: (v) => {
          signIn.code = v;
          if (!signIn.busy && western(v).replace(/\D/g, '').length === 6) verify();
        },
      }),
      el('button', { class: 'btn main', type: 'submit', 'data-key': 'verify', disabled: signIn.busy || null }, signIn.busy ? t('ندخلك…', 'Signing you in…') : t('ادخل', 'Sign in')),
    ),
    el(
      'div',
      { class: 'row-actions center-row' },
      el('button', { class: 'btn small', type: 'button', 'data-key': 'again', disabled: signIn.busy || null, onclick: send }, t('أرسل رمز جديد', 'Send a new code')),
      el('button', { class: 'btn small', type: 'button', 'data-key': 'change', disabled: signIn.busy || null, onclick: () => (resetSignIn(), draw(), focus('email')) }, t('غيّر الإيميل', 'Change the email')),
    ),
  );
}

/** Who's signed in, with Sign out (which lands on the sign-in card's heading and says so). */
export function signedIn({ onSignOut }) {
  const user = auth.user();
  const out = async () => {
    await auth.signOut();
    resetSignIn();
    focusHeading();
    onSignOut();
    announce(t('سجّلت خروج.', "You're signed out."));
  };
  return el(
    'div',
    { class: 'who' },
    el('p', { class: 'small muted' }, t('داخل بـ ', 'Signed in as '), el('bdi', { dir: 'ltr', class: 'email' }, (user && user.email) || '')),
    el('button', { class: 'btn small', type: 'button', 'data-key': 'signout', onclick: out }, t('سجّل خروج', 'Sign out')),
  );
}

/** A calm card for someone signed in whom this page isn't for: nothing of the page's data, the support address, Sign out. */
export function notForYou({ over, title, line, onSignOut }) {
  return [
    signedIn({ onSignOut }),
    el(
      'section',
      { class: 'card' },
      el('p', { class: 'over' }, over),
      el('h1', {}, title),
      el('p', { class: 'muted' }, line, ' ', el('a', { href: `mailto:${SUPPORT}`, dir: 'ltr' }, SUPPORT), t('.', '.')),
    ),
  ];
}
