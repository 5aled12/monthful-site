// monthful.app/admin: the founders' page (supabase/README.md, "Influencer program"). Signed in with an email code that's
// in `admins`: every partner with the numbers they see, adding or changing one, their 5 Apple offer codes, payouts
// (recorded, or deleted when recorded by mistake), and the dishes waiting for review (approve, reject with a note, or
// edit and approve). Every change goes through an admin_* function. Anyone else signed in sees a calm note.
import { checkDish, dateName, dishFields, dishName, dishRow, field, form, mealLine, money, notForYou, problem, riyals, signInCard, signedIn, stat, tick, western } from './account.js?v=c02ca9fe5f';
import { announce, auth, counted, el, files, focusHeading, myRpc, num, page, t, table } from './site.js?v=0a3adf5db8';

const BUCKET = 'partner-dishes';
const LENGTHS = [
  ['1', 'شهر', '1 month'],
  ['2', 'شهرين', '2 months'],
  ['3', '3 شهور', '3 months'],
  ['6', '6 شهور', '6 months'],
  ['12', 'سنة', '12 months'],
];
const PARTNERS = { ar: ['ولا شريك', 'شريك واحد', 'شريكين', '{n} شركاء', '{n} شريك'], en: ['no partners', 'one partner', '{n} partners'] };
const WAITING = { ar: ['ولا طبخة تنتظر', 'طبخة وحدة تنتظر', 'طبختين تنتظر', '{n} طبخات تنتظر', '{n} طبخة تنتظر'], en: ['no dishes waiting', 'one dish waiting', '{n} dishes waiting'] };

/** loading | out | stranger (signed in, not in admins) | error | ready */
let state = 'loading';
let overview = null;
let ended = false;
/** One line at the top after a change: { text, warn, undo }. */
let notice = null;
/** photo_path → a signed link (or 'failed'). */
const photos = new Map();
/** partner id → their payouts, newest first (or 'failed'). */
const payouts = new Map();
/**
 * The one panel open: { kind: 'partner' (id null for a new one) | 'codes' | 'payout' | 'payouts' | 'reject' | 'dish', id,
 * …what's typed, busy, error, errors }.
 */
let panel = null;
/** A payout waiting for «إيه، احذفها»; what's being sent (a dish approved, a payout deleted). */
let confirming = null;
let working = null;
let asked = 0;

async function load() {
  const ask = ++asked;
  if (!auth.user()) return signedOut();
  if (state !== 'ready') {
    state = 'loading';
    draw();
  }
  try {
    const found = await myRpc('admin_overview');
    if (ask !== asked) return;
    overview = { partners: Array.isArray(found && found.partners) ? found.partners : [], pending_dishes: Array.isArray(found && found.pending_dishes) ? found.pending_dishes : [] };
    state = 'ready';
    signPhotos(overview.pending_dishes.map((d) => d.photo_path));
  } catch (e) {
    if (ask !== asked) return;
    if (!auth.user()) {
      ended = true;
      return signedOut();
    }
    if (e.code === 'not_admin') {
      overview = null;
      state = 'stranger';
    } else if (state !== 'ready') state = 'error';
  }
  draw();
}

async function signPhotos(paths) {
  const todo = paths.filter((p) => p && !photos.has(p));
  if (!todo.length) return;
  for (const p of todo) photos.set(p, null);
  await Promise.all(todo.map((p) => files.signedUrl(BUCKET, p, 3600).then((url) => photos.set(p, url), () => photos.set(p, 'failed'))));
  draw();
}

async function loadPayouts(id) {
  try {
    payouts.set(id, await table('payouts', { select: 'id,amount_sar,paid_at,note', filter: { partner_id: `eq.${id}`, order: 'paid_at.desc' } }));
  } catch {
    payouts.set(id, 'failed');
  }
  draw();
}

function signedOut() {
  overview = null;
  panel = null;
  notice = null;
  photos.clear();
  payouts.clear();
  state = 'out';
  draw();
}

const partnerOf = (id) => (overview ? overview.partners.find((p) => p.id === id) : null);
const focus = (key) => {
  const node = document.querySelector(`[data-key="${CSS.escape(key)}"]`) || document.getElementById(`f-${key}`);
  if (node) node.focus();
};
const say = (text, warn = false, undo = null) => {
  notice = { text, warn, undo };
  announce(text);
};

/** Opens one panel (next.back: the button that opened it), or closes the open one with null. */
function open(next, first) {
  panel = next ? { busy: false, error: null, errors: {}, ...next } : null;
  confirming = null;
  if (next && next.kind === 'payouts' && !payouts.has(next.id)) loadPayouts(next.id);
  draw();
  if (first) focus(first);
}

/** Closes the open panel, back on the button that opened it. */
function close() {
  const back = panel && panel.back;
  open(null);
  if (back) focus(back);
}

/** Sends a panel: run() makes the call; a refusal goes to the field it's about (fieldOf) or under the form. */
async function send(run, fieldOf = {}) {
  const p = panel;
  p.busy = true;
  p.error = null;
  p.errors = {};
  draw();
  try {
    await run(p);
    return true;
  } catch (e) {
    if (!auth.user()) {
      ended = true;
      signedOut();
      return false;
    }
    p.busy = false;
    const [key, text] = fieldOf[e.code] || [null, refusal(e)];
    if (key) p.errors = { [key]: text };
    else p.error = text;
    draw();
    if (key) focus(key);
    announce(text);
    return false;
  }
}

function refusal(e) {
  if (e.code === 'not_found') return t('ما لقيناه: يمكن انحذف أو تغيّر. حدّث الصفحة.', "We couldn't find it: it may have changed. Refresh the page.");
  if (e.code === 'not_admin') return t('هالإيميل مو من فريق منثفُل.', "This email isn't on the Monthful team.");
  if (e.code === 'invalid') return t('في خانة ما ضبطت. تأكد منها وجرّب مرة ثانية.', "Something in the form doesn't fit. Check it and try again.");
  return problem(e);
}

// Partners -------------------------------------------------------------------------------------------------------------

function partnerPanel(p) {
  const fresh = !p.id;
  const save = () =>
    send(
      async (x) => {
        const id = await myRpc('admin_save_partner', { p_id: x.id, p_code: x.code, p_name: x.name, p_email: x.email, p_handle: x.handle.trim() || null, p_active: x.active });
        say(fresh ? t(`أضفنا ${x.name.trim()}. الدخول من monthful.app/partners بنفس الإيميل.`, `${x.name.trim()} is added. They sign in at monthful.app/partners with that email.`) : t(`حفظنا ${x.name.trim()}.`, `${x.name.trim()} is saved.`));
        await load();
        // A new partner's next step: their Apple codes.
        if (fresh) open({ kind: 'codes', id, codes: {}, back: `codes-${id}` }, 'code-1');
        else close();
      },
      {
        invalid_code: ['code', t('من 3 لين 12 حرف إنجليزي أو رقم، مثل SARA.', '3 to 12 English letters or digits, like SARA.')],
        code_taken: ['code', t('هالكود عند شريك ثاني.', 'Another partner has this code.')],
        invalid_name: ['name', t('اكتب الاسم (80 حرف بالكثير).', 'Write the name (80 characters at most).')],
        invalid_email: ['email', t('تأكد من الإيميل.', 'Please check the email.')],
        email_taken: ['email', t('هالإيميل لشريك ثاني.', 'Another partner has this email.')],
        invalid_handle: ['handle', t('حروف إنجليزية وأرقام و . و _ بس، مثل @sara.cooks', 'English letters, digits, . and _ only, like @sara.cooks')],
      },
    );
  const set = (key) => (v) => {
    p[key] = v;
  };
  return el(
    'div',
    { class: 'panel' },
    form(
      { label: fresh ? t('أضف شريك', 'Add a partner') : t('عدّل الشريك', 'Change the partner'), onSubmit: save },
      el('h3', {}, fresh ? t('أضف شريك', 'Add a partner') : t('عدّل الشريك', 'Change the partner')),
      field({ key: 'code', label: t('الكود', 'Code'), hint: t('اللي يكتبه العملاء في التطبيق: 3 لين 12 حرف إنجليزي أو رقم.', 'What customers type in the app: 3 to 12 English letters or digits.'), value: p.code, dir: 'ltr', lang: 'en', maxlength: 12, autocapitalize: 'characters', spellcheck: 'false', error: p.errors.code, onInput: set('code') }),
      field({ key: 'name', label: t('الاسم', 'Name'), value: p.name, maxlength: 80, error: p.errors.name, onInput: set('name') }),
      field({ key: 'email', label: t('الإيميل', 'Email'), hint: t('للدخول على صفحة الشركاء.', 'For signing in to the partners page.'), value: p.email, type: 'email', dir: 'ltr', lang: 'en', maxlength: 254, autocapitalize: 'none', spellcheck: 'false', error: p.errors.email, onInput: set('email') }),
      field({ key: 'handle', label: t('الحساب في السوشال (اختياري)', 'Social handle (optional)'), value: p.handle, dir: 'ltr', lang: 'en', maxlength: 31, autocapitalize: 'none', spellcheck: 'false', placeholder: '@sara.cooks', error: p.errors.handle, onInput: set('handle') }),
      tick({ key: 'active', label: t('الكود شغّال (العملاء يقدرون يستخدمونه)', 'The code works (customers can use it)'), checked: p.active, onInput: set('active') }),
      p.error ? el('p', { class: 'note warn', role: 'alert' }, p.error) : null,
      el('button', { class: 'btn main', type: 'submit', 'data-key': 'save', disabled: p.busy || null }, p.busy ? t('نحفظ…', 'Saving…') : t('احفظ', 'Save')),
      el('button', { class: 'btn', type: 'button', 'data-key': 'cancel', disabled: p.busy || null, onclick: close }, t('إلغاء', 'Cancel')),
    ),
  );
}

function codesPanel(p, partner) {
  const save = () =>
    send(
      async (x) => {
        const codes = Object.fromEntries(LENGTHS.map(([m]) => [m, western(x.codes[m] || '').trim().toUpperCase() || null]));
        await myRpc('admin_set_codes', { p_partner: x.id, p_codes: codes });
        say(t(`حفظنا أكواد ${partner.name}.`, `${partner.name}'s codes are saved.`));
        close();
        await load();
      },
      {
        invalid_code: [null, t('الأكواد حروف إنجليزية وأرقام بس.', 'Codes are English letters and digits only.')],
        code_taken: [null, t('واحد من الأكواد عند شريك ثاني.', 'Another partner already has one of these codes.')],
      },
    );
  const empty = LENGTHS.filter(([m]) => !(p.codes[m] || '').trim());
  return el(
    'div',
    { class: 'panel' },
    form(
      { label: t('أكواد Apple', 'Apple codes'), onSubmit: save },
      el('h3', {}, t('أكواد Apple', 'Apple codes')),
      el('p', { class: 'small muted' }, t('الأكواد اللي سوّيتها لهالشريك في App Store Connect، كود لكل مدة. الخانة الفاضية تشيل كودها.', 'The codes you made for this partner in App Store Connect, one per length. An empty field removes its code.')),
      LENGTHS.map(([m, ar, en]) =>
        field({ key: `code-${m}`, label: t(ar, en), value: p.codes[m] || '', dir: 'ltr', lang: 'en', maxlength: 64, autocapitalize: 'characters', spellcheck: 'false', placeholder: `${partner.code}${m}`, onInput: (v) => (p.codes[m] = v) }),
      ),
      empty.length
        ? el(
            'button',
            { class: 'btn small', type: 'button', 'data-key': 'fill', onclick: () => (empty.forEach(([m]) => (p.codes[m] = `${partner.code}${m}`)), draw()) },
            t(`عبّ الفاضي: ${partner.code}1…${partner.code}12`, `Fill the empty ones: ${partner.code}1…${partner.code}12`),
          )
        : null,
      p.error ? el('p', { class: 'note warn', role: 'alert' }, p.error) : null,
      el('button', { class: 'btn main', type: 'submit', 'data-key': 'save', disabled: p.busy || null }, p.busy ? t('نحفظ…', 'Saving…') : t('احفظ الأكواد', 'Save the codes')),
      el('button', { class: 'btn', type: 'button', 'data-key': 'cancel', disabled: p.busy || null, onclick: close }, t('إلغاء', 'Cancel')),
    ),
  );
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function payoutPanel(p, partner) {
  const save = () => {
    const amount = western(p.amount).replace(/\s|,/g, '');
    const errors = {};
    if (!/^-?\d{1,7}(\.\d{1,2})?$/.test(amount) || Number(amount) === 0) errors.amount = t('مبلغ بالريال، مثل 150 أو 150.50 (بالسالب لو تصحّح دفعة).', 'An amount in riyals, like 150 or 150.50 (negative to correct one).');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || p.date > today()) errors.date = t('اختر يوم التحويل (اليوم أو قبله).', 'Pick the day it was paid (today or before).');
    if (Object.keys(errors).length) {
      p.errors = errors;
      draw();
      return focus(Object.keys(errors)[0]);
    }
    return send(
      async (x) => {
        await myRpc('admin_add_payout', { p_partner: x.id, p_amount_sar: Number(amount), p_note: x.note.trim() || null, p_paid_at: x.date === today() ? null : new Date(`${x.date}T12:00:00`).toISOString() });
        say(t(`سجّلنا ${riyals(Number(amount))} لـ ${partner.name}.`, `${riyals(Number(amount))} recorded for ${partner.name}.`));
        payouts.delete(x.id);
        open({ kind: 'payouts', id: x.id, back: `payouts-${x.id}` }, 'payouts-title');
        await load();
      },
      {
        invalid_amount: ['amount', t('مبلغ بالريال، مثل 150 أو 150.50.', 'An amount in riyals, like 150 or 150.50.')],
        invalid_note: ['note', t('الملاحظة 500 حرف بالكثير.', 'The note is 500 characters at most.')],
      },
    );
  };
  const owed = Number(partner.owed_sar) || 0;
  return el(
    'div',
    { class: 'panel' },
    form(
      { label: t('سجّل دفعة', 'Record a payout'), onSubmit: save },
      el('h3', {}, t('سجّل دفعة', 'Record a payout')),
      el('p', { class: 'small muted' }, t(`المستحق الحين: ${riyals(owed)}.`, `Owed now: ${riyals(owed)}.`)),
      field({ key: 'amount', label: t('المبلغ بالريال', 'Amount in riyals'), hint: t('المبلغ اللي حوّلته. بالسالب لو تصحّح دفعة قبلها.', 'What you paid. Negative to correct an earlier one.'), value: p.amount, inputmode: 'decimal', dir: 'ltr', lang: 'en', maxlength: 14, class: 'short', error: p.errors.amount, onInput: (v) => (p.amount = v) }),
      owed > 0 && western(p.amount).trim() !== String(owed)
        ? el('button', { class: 'btn small', type: 'button', 'data-key': 'all', onclick: () => ((p.amount = String(owed)), draw(), focus('amount')) }, t(`كل الباقي: ${riyals(owed)}`, `All of it: ${riyals(owed)}`))
        : null,
      field({ key: 'date', label: t('يوم التحويل', 'Paid on'), value: p.date, type: 'date', max: today(), dir: 'ltr', lang: 'en', error: p.errors.date, onInput: (v) => (p.date = v) }),
      field({ key: 'note', label: t('ملاحظة (اختياري، يشوفها الشريك)', 'Note (optional, the partner sees it)'), value: p.note, maxlength: 500, placeholder: t('تحويل بنكي، أكتوبر', 'Bank transfer, October'), error: p.errors.note, onInput: (v) => (p.note = v) }),
      p.error ? el('p', { class: 'note warn', role: 'alert' }, p.error) : null,
      el('button', { class: 'btn main', type: 'submit', 'data-key': 'save', disabled: p.busy || null }, p.busy ? t('نسجّلها…', 'Recording…') : t('سجّل الدفعة', 'Record the payout')),
      el('button', { class: 'btn', type: 'button', 'data-key': 'cancel', disabled: p.busy || null, onclick: close }, t('إلغاء', 'Cancel')),
    ),
  );
}

async function deletePayout(partner, row) {
  working = row.id;
  confirming = null;
  draw();
  try {
    await myRpc('admin_delete_payout', { p_id: row.id });
    say(t(`حذفنا دفعة ${partner.name}، ${riyals(row.amount_sar)}.`, `The ${riyals(row.amount_sar)} payout to ${partner.name} is deleted.`));
  } catch (e) {
    if (!auth.user()) {
      working = null;
      ended = true;
      return signedOut();
    }
    say(e.code === 'not_found' ? t('هالدفعة انحذفت من قبل.', 'That payout was already deleted.') : refusal(e), true);
  }
  working = null;
  payouts.delete(partner.id);
  loadPayouts(partner.id);
  await load();
  focus('payouts-title');
}

function payoutsPanel(p, partner) {
  const rows = payouts.get(partner.id);
  let body;
  if (!rows) body = el('p', { class: 'small muted', role: 'status' }, t('نجيب الدفعات…', 'Getting the payouts…'));
  else if (rows === 'failed') body = el('p', { class: 'note warn' }, t('ما قدرنا نجيب الدفعات. جرّب مرة ثانية.', "We couldn't get the payouts. Try again."));
  else if (!rows.length) body = el('p', { class: 'small muted' }, t('ما فيه دفعات مسجّلة بعد.', 'No payouts recorded yet.'));
  else {
    body = el(
      'ul',
      { class: 'list' },
      rows.map((row) =>
        el(
          'li',
          { class: 'item' },
          el('div', { class: 'line' }, el('span', {}, dateName(row.paid_at)), el('span', { class: 'amount' }, riyals(row.amount_sar))),
          row.note ? el('p', { class: 'small muted' }, el('bdi', {}, row.note)) : null,
          confirming === row.id
            ? el(
                'div',
                { class: 'confirm', role: 'group', 'aria-label': t('تأكيد الحذف', 'Confirm deleting') },
                el('p', { class: 'small' }, t(`تحذف دفعة ${riyals(row.amount_sar)}؟ يرجع المبلغ للمستحق.`, `Delete the ${riyals(row.amount_sar)} payout? It goes back to what they're owed.`)),
                el(
                  'div',
                  { class: 'row-actions' },
                  el('button', { class: 'btn small danger', type: 'button', 'data-key': `yes-${row.id}`, onclick: () => deletePayout(partner, row) }, t('إيه، احذفها', 'Yes, delete it')),
                  el('button', { class: 'btn small', type: 'button', 'data-key': `no-${row.id}`, onclick: () => ((confirming = null), draw(), focus(`del-${row.id}`)) }, t('خلّها', 'Keep it')),
                ),
              )
            : el(
                'div',
                { class: 'row-actions' },
                el(
                  'button',
                  { class: 'btn small', type: 'button', 'data-key': `del-${row.id}`, disabled: working ? true : null, onclick: () => ((confirming = row.id), draw(), focus(`no-${row.id}`)) },
                  working === row.id ? t('نحذفها…', 'Deleting…') : t('احذفها', 'Delete it'),
                ),
              ),
        ),
      ),
    );
  }
  return el(
    'div',
    { class: 'panel' },
    el('h3', { tabindex: '-1', 'data-key': 'payouts-title' }, t(`دفعات ${partner.name}`, `Payouts to ${partner.name}`)),
    body,
    el('div', { class: 'row-actions' }, el('button', { class: 'btn small', type: 'button', 'data-key': 'close', onclick: close }, t('سكّر', 'Close'))),
  );
}


function partnerItem(partner) {
  const mine = panel && panel.id === partner.id ? panel.kind : null;
  const codes = LENGTHS.filter(([m]) => partner.codes && partner.codes[m]);
  const button = (kind, key, ar, en, next, first) =>
    el('button', { class: 'btn small', type: 'button', 'data-key': `${key}-${partner.id}`, 'aria-expanded': String(mine === kind), onclick: () => (mine === kind ? close() : open({ ...next, back: `${key}-${partner.id}` }, first)) }, t(ar, en));
  return el(
    'li',
    { class: 'item' },
    el('p', { class: 'name' }, el('bdi', {}, partner.name), ' ', partner.active ? null : el('span', { class: 'tag no' }, t('موقوف', 'Paused'))),
    el('p', { class: 'small muted', dir: 'ltr' }, [partner.code, partner.handle, partner.email].filter(Boolean).join(' · ')),
    el(
      'dl',
      { class: 'stats' },
      stat(t('المستحق الحين', 'Owed now'), money(partner.owed_sar), true),
      stat(t('جرّبوا أو دفعوا', 'Tried or paid'), num(Number(partner.used) || 0)),
      stat(t('دفعوا مرة على الأقل', 'Paid at least once'), num(Number(partner.paid_customers) || 0)),
      stat(t('مشتركين الحين', 'Subscribed now'), num(Number(partner.paying_now) || 0)),
      stat(t('في الأسبوع المجاني', 'In the free week'), num(Number(partner.trying_now) || 0)),
      stat(t('الأرباح', 'Earned'), money(partner.earned_sar)),
      stat(t('حوّلناه', 'Paid out'), money(partner.paid_out_sar)),
    ),
    codes.length
      ? el('ul', { class: 'codes', 'aria-label': t('أكواد Apple', 'Apple codes') }, codes.map(([m, ar, en]) => el('li', {}, `${t(ar, en)}: `, el('bdi', {}, partner.codes[m]))))
      : el('p', { class: 'note warn' }, t('ما فيه أكواد Apple بعد: الكود ما يعطي العملاء خصم.', 'No Apple codes yet: the code gives customers no discount.')),
    el(
      'div',
      { class: 'row-actions' },
      button('partner', 'edit', 'عدّل', 'Change', { kind: 'partner', id: partner.id, code: partner.code, name: partner.name, email: partner.email, handle: partner.handle || '', active: partner.active }, 'code'),
      button('codes', 'codes', 'أكواد Apple', 'Apple codes', { kind: 'codes', id: partner.id, codes: { ...(partner.codes || {}) } }, 'code-1'),
      button('payout', 'pay', 'سجّل دفعة', 'Record a payout', { kind: 'payout', id: partner.id, amount: '', date: today(), note: '' }, 'amount'),
      button('payouts', 'payouts', 'الدفعات', 'Payouts', { kind: 'payouts', id: partner.id }, null),
    ),
    mine === 'partner' ? partnerPanel(panel) : null,
    mine === 'codes' ? codesPanel(panel, partner) : null,
    mine === 'payout' ? payoutPanel(panel, partner) : null,
    mine === 'payouts' ? payoutsPanel(panel, partner) : null,
  );
}

// Dishes ---------------------------------------------------------------------------------------------------------------

async function approve(dish) {
  working = dish.id;
  open(null);
  try {
    await myRpc('admin_review_dish', { p_id: dish.id, p_status: 'approved' });
    say(t(`اعتمدنا «${dishName(dish)}».`, `“${dishName(dish)}” is approved.`), false, dish.id);
  } catch (e) {
    if (!auth.user()) {
      working = null;
      ended = true;
      return signedOut();
    }
    say(refusal(e), true);
  }
  working = null;
  await load();
  focus('dishes');
}

/** Back to waiting, right after a one-tap approval. */
async function undoApprove(id) {
  notice = null;
  try {
    await myRpc('admin_review_dish', { p_id: id, p_status: 'pending' });
    say(t('رجّعناها تنتظر مراجعتك.', "It's back waiting for your review."));
  } catch (e) {
    say(refusal(e), true);
  }
  await load();
}

function rejectPanel(p, dish) {
  const save = () =>
    send(
      async (x) => {
        await myRpc('admin_review_dish', { p_id: dish.id, p_status: 'rejected', p_note: x.note.trim() || null });
        say(t(`رفضنا «${dishName(dish)}»، وتوصل ملاحظتك للشريك.`, `“${dishName(dish)}” is rejected; the partner sees your note.`));
        open(null);
        await load();
        focus('dishes');
      },
      {},
    );
  return el(
    'div',
    { class: 'panel' },
    form(
      { label: t('ارفضها', 'Reject it'), onSubmit: save },
      el('h3', {}, t('ارفضها', 'Reject it')),
      field({
        key: 'note', label: t('ملاحظة للشريك', 'A note for the partner'), hint: t('تطلع في صفحة الشريك. اكتب السبب، عشان تنرسل طبخة ثانية مكانها.', 'It shows on their page. Say why, so another dish can take its place.'),
        value: p.note, rows: 4, maxlength: 1000, onInput: (v) => (p.note = v),
      }),
      p.error ? el('p', { class: 'note warn', role: 'alert' }, p.error) : null,
      el('button', { class: 'btn main', type: 'submit', 'data-key': 'save', disabled: p.busy || null }, p.busy ? t('نرسل…', 'Sending…') : t('ارفضها', 'Reject it')),
      el('button', { class: 'btn', type: 'button', 'data-key': 'cancel', disabled: p.busy || null, onclick: close }, t('إلغاء', 'Cancel')),
    ),
  );
}

function editPanel(p, dish) {
  const save = () => {
    p.errors = checkDish(p);
    const wrong = Object.keys(p.errors);
    if (wrong.length) {
      draw();
      return focus(wrong[0]);
    }
    return send(async (x) => {
      const row = dishRow(x);
      await myRpc('admin_review_dish', { p_id: dish.id, p_status: 'approved', p_note: x.note.trim() || null, p_fields: row });
      say(t(`عدّلنا «${dishName(row)}» واعتمدناها.`, `“${dishName(row)}” is changed and approved.`));
      open(null);
      await load();
      focus('dishes');
    });
  };
  return el(
    'div',
    { class: 'panel' },
    form(
      { label: t('عدّلها واعتمدها', 'Change and approve'), onSubmit: save },
      el('h3', {}, t('عدّلها واعتمدها', 'Change and approve')),
      dishFields(p),
      field({ key: 'note', label: t('ملاحظة للشريك (اختياري)', 'A note for the partner (optional)'), hint: t('تطلع في صفحة الشريك، مثل وش عدّلنا.', 'It shows on their page, like what we changed.'), value: p.note, rows: 3, maxlength: 1000, onInput: (v) => (p.note = v) }),
      p.error ? el('p', { class: 'note warn', role: 'alert' }, p.error) : null,
      el('button', { class: 'btn main', type: 'submit', 'data-key': 'save', disabled: p.busy || null }, p.busy ? t('نحفظ…', 'Saving…') : t('احفظ واعتمدها', 'Save and approve')),
      el('button', { class: 'btn', type: 'button', 'data-key': 'cancel', disabled: p.busy || null, onclick: close }, t('إلغاء', 'Cancel')),
    ),
  );
}

function dishItem(dish) {
  const mine = panel && panel.id === dish.id ? panel.kind : null;
  const url = dish.photo_path ? photos.get(dish.photo_path) : null;
  const changed = dish.updated_at && dish.created_at && new Date(dish.updated_at) - new Date(dish.created_at) > 60_000;
  const second = dish.name_ar && dish.name_en ? t(dish.name_en, dish.name_ar) : null;
  return el(
    'li',
    { class: 'item' },
    el('p', { class: 'small muted' }, t('من ', 'From '), el('bdi', {}, dish.partner_name), ` · ${dish.partner_code} · `, changed ? t(`تعدّلت ${dateName(dish.updated_at)}`, `changed ${dateName(dish.updated_at)}`) : t(`وصلت ${dateName(dish.created_at)}`, `sent ${dateName(dish.created_at)}`)),
    el('p', { class: 'name' }, el('bdi', {}, dishName(dish))),
    second ? el('p', { class: 'small' }, el('bdi', { lang: t('en', 'ar') }, second)) : null,
    el('p', { class: 'small muted' }, mealLine(dish)),
    dish.photo_path
      ? url && url !== 'failed'
        ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'photo-link' }, el('img', { class: 'preview', src: url, alt: t(`صورة ${dishName(dish)}، افتحها كاملة`, `Photo of ${dishName(dish)}, open it full size`) }))
        : el('p', { class: 'small muted' }, url === 'failed' ? t('ما قدرنا نجيب الصورة.', "We couldn't get the photo.") : t('نجيب الصورة…', 'Getting the photo…'))
      : el('p', { class: 'small muted' }, t('بدون صورة.', 'No photo.')),
    el('h3', {}, t('المكونات', 'Ingredients')),
    el('p', { class: 'pre', dir: 'auto' }, dish.ingredients),
    el('h3', {}, t('الخطوات', 'Steps')),
    el('p', { class: 'pre', dir: 'auto' }, dish.steps),
    mine
      ? null
      : el(
          'div',
          { class: 'row-actions' },
          el('button', { class: 'btn small', type: 'button', 'data-key': `approve-${dish.id}`, disabled: working ? true : null, onclick: () => approve(dish) }, working === dish.id ? t('نعتمدها…', 'Approving…') : t('اعتمدها', 'Approve')),
          el(
            'button',
            {
              class: 'btn small', type: 'button', 'data-key': `edit-${dish.id}`, disabled: working ? true : null,
              onclick: () => open({ kind: 'dish', id: dish.id, name_ar: dish.name_ar || '', name_en: dish.name_en || '', meal: dish.meal, servings: String(dish.servings), ingredients: dish.ingredients, steps: dish.steps, note: '', back: `edit-${dish.id}` }, 'name_ar'),
            },
            t('عدّلها واعتمدها', 'Change and approve'),
          ),
          el('button', { class: 'btn small danger', type: 'button', 'data-key': `reject-${dish.id}`, disabled: working ? true : null, onclick: () => open({ kind: 'reject', id: dish.id, note: '', back: `reject-${dish.id}` }, 'note') }, t('ارفضها', 'Reject')),
        ),
    mine === 'reject' ? rejectPanel(panel, dish) : null,
    mine === 'dish' ? editPanel(panel, dish) : null,
  );
}

// The page -------------------------------------------------------------------------------------------------------------

function dashboard() {
  const { partners, pending_dishes: dishes } = overview;
  return [
    signedIn({ onSignOut: signedOut }),
    el(
      'section',
      { class: 'card' },
      el('p', { class: 'over' }, t('فريق منثفُل', 'Monthful team')),
      el('h1', {}, t('الشركاء والطبخات', 'Partners and dishes')),
      el('p', { class: 'muted' }, `${counted(partners.length, PARTNERS)} · ${counted(dishes.length, WAITING)}`),
      notice
        ? el(
            'p',
            { class: `note${notice.warn ? ' warn' : ''}`, role: 'status' },
            notice.text,
            notice.undo ? [' ', el('button', { class: 'link', type: 'button', 'data-key': 'undo', onclick: () => undoApprove(notice.undo) }, t('تراجع', 'Undo'))] : null,
          )
        : null,
    ),
    el(
      'section',
      { class: 'card', 'aria-labelledby': 'dishes' },
      el('h2', { id: 'dishes', tabindex: '-1', 'data-key': 'dishes' }, t('طبخات تنتظر مراجعتك', 'Dishes waiting for review')),
      dishes.length ? el('ul', { class: 'list' }, dishes.map(dishItem)) : el('p', { class: 'muted' }, t('ما فيه طبخات تنتظر.', 'Nothing is waiting.')),
    ),
    el(
      'section',
      { class: 'card', 'aria-labelledby': 'partners' },
      el('h2', { id: 'partners', tabindex: '-1', 'data-key': 'partners' }, t('الشركاء', 'Partners')),
      el(
        'p',
        { class: 'small muted' },
        t('كل شريك يكسب 10% من كل دفعة يدفعها عملاؤه، من السعر اللي يدفعه العميل، بالريال. الأرقام نفسها اللي يشوفها في صفحته.', 'Each partner earns 10% of every payment their customers make, of the price the customer pays, in riyals. These are the numbers they see on their page.'),
      ),
      panel && panel.kind === 'partner' && !panel.id
        ? partnerPanel(panel)
        : el('button', { class: 'btn small', type: 'button', 'data-key': 'add', onclick: () => open({ kind: 'partner', id: null, code: '', name: '', email: '', handle: '', active: true, back: 'add' }, 'code') }, t('أضف شريك', 'Add a partner')),
      partners.length ? el('ul', { class: 'list partners' }, partners.map(partnerItem)) : el('p', { class: 'muted' }, t('ما فيه شركاء بعد.', 'No partners yet.')),
    ),
  ];
}

function view() {
  if (state === 'loading') return el('p', { class: 'loading', role: 'status' }, t('نجيب الصفحة…', 'Getting the page…'));
  if (state === 'out') {
    const card = signInCard({
      draw,
      over: t('فريق منثفُل', 'Monthful team'),
      line: t('ادخل بإيميلك في فريق منثفُل.', 'Sign in with your Monthful team email.'),
      onSignedIn: () => {
        ended = false;
        load();
      },
    });
    return ended ? [el('p', { class: 'note warn', role: 'status' }, t('انتهى دخولك. ادخل مرة ثانية.', 'You were signed out. Please sign in again.')), card] : card;
  }
  if (state === 'stranger') {
    return notForYou({
      over: t('فريق منثفُل', 'Monthful team'),
      title: t('هالصفحة لفريق منثفُل', 'This page is for the Monthful team'),
      line: t('ما تفتح بهالإيميل. لو تبي تتواصل معنا، راسلنا على', "It doesn't open with this email. To get in touch, write to us at"),
      onSignOut: signedOut,
    });
  }
  if (state === 'error') {
    return [
      signedIn({ onSignOut: signedOut }),
      el(
        'section',
        { class: 'card' },
        el('h1', {}, t('ما قدرنا نجيب الصفحة', "We couldn't get the page")),
        el('p', { class: 'muted' }, t('تأكد من الإنترنت وجرّب مرة ثانية.', 'Check your connection and try again.')),
        el('button', { class: 'btn main', type: 'button', 'data-key': 'retry', onclick: () => (focusHeading(), load()) }, t('جرّب مرة ثانية', 'Try again')),
      ),
    ];
  }
  return dashboard();
}

const draw = page({ title: () => t('فريق منثفُل', 'Monthful team'), view });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state === 'ready' && !panel && !working) load();
});
load();
