// monthful.app/partners: an influencer's own page (supabase/README.md, "Influencer program"). They sign in with an email
// code; my_partner_stats gives their code and its numbers (counts only, never a customer), their earnings in riyals and
// their dishes. At 100 customers who paid, «أضف طبختك» opens: up to 3 dishes, each with an optional photo in the private
// bucket (their own folder), changed or deleted while we haven't reviewed it. Anyone else signed in gets a calm note.
import { SUPPORT, checkDish, dateName, dishFields, dishName, dishRow, form, mealLine, money, notForYou, problem, riyals, signInCard, signedIn, stat } from './account.js?v=c02ca9fe5f';
import { announce, auth, counted, el, files, focusHeading, myRpc, num, page, t, table } from './site.js?v=0a3adf5db8';

const BUCKET = 'partner-dishes';
/** The bucket takes photos up to 5 MB; bigger ones are made smaller here first. */
const MAX_PHOTO = 5 * 1024 * 1024;
const NEEDED = 100;
const MOST = 3;

const DISHES = { ar: ['ولا طبخة', 'طبخة وحدة', 'طبختين', '{n} طبخات', '{n} طبخة'], en: ['no dishes', 'one dish', '{n} dishes'] };
const MORE = { ar: DISHES.ar, en: ['no more dishes', 'one more dish', '{n} more dishes'] };
const CUSTOMERS = { ar: ['ولا عميل', 'عميل واحد', 'عميلين', '{n} عملاء', '{n} عميل'], en: ['no customers', 'one customer', '{n} customers'] };

/** loading | out (signed out) | stranger (signed in, not a partner) | error | ready */
let state = 'loading';
let stats = null;
let partnerId = null;
let payouts = [];
/** Signed out by the server (the session ended): the sign-in card says so. */
let ended = false;
/** One line over the dishes after a change: { text, warn }. */
let notice = null;
/** photo_path → a signed link (or 'failed'), for the dishes' photos. */
const photos = new Map();
/** The dish form, open: { id (null for a new one), fields…, oldPath, photo: { file, url } | null, dropPhoto, busy, error, errors }. */
let editor = null;
/** A dish waiting for «إيه، احذفها», and one being deleted. */
let confirming = null;
let deleting = null;
let asked = 0;

async function load() {
  const ask = ++asked;
  if (!auth.user()) {
    state = 'out';
    return draw();
  }
  if (state !== 'ready') {
    state = 'loading';
    draw();
  }
  try {
    const [mine, id] = await Promise.all([myRpc('my_partner_stats'), myRpc('my_partner_id')]);
    if (ask !== asked) return;
    if (!mine || !id) {
      state = 'stranger';
      stats = null;
    } else {
      stats = mine;
      partnerId = id;
      state = 'ready';
      // Their own, by name: the table lets the team read every partner's, so a team member who is a partner too would
      // otherwise see everyone's payouts listed as theirs.
      payouts = await table('payouts', { select: 'id,amount_sar,paid_at,note', filter: { partner_id: `eq.${id}`, order: 'paid_at.desc' } }).catch(() => payouts);
      if (ask !== asked) return;
      signPhotos(stats.dishes.map((d) => d.photo_path));
    }
  } catch (e) {
    if (ask !== asked) return;
    if (!auth.user()) {
      ended = true;
      signedOut();
      return;
    }
    // Offline on a refresh: what's shown stays.
    if (state !== 'ready') state = 'error';
  }
  draw();
}

/** Signed links for the photos not asked for yet (an hour each), then the page again. */
async function signPhotos(paths) {
  const todo = paths.filter((p) => p && !photos.has(p));
  if (!todo.length) return;
  for (const p of todo) photos.set(p, null);
  await Promise.all(
    todo.map((p) =>
      files.signedUrl(BUCKET, p, 3600).then(
        (url) => photos.set(p, url),
        () => photos.set(p, 'failed'),
      ),
    ),
  );
  draw();
}

const signedOut = () => {
  stats = null;
  partnerId = null;
  payouts = [];
  editor = null;
  notice = null;
  photos.clear();
  state = 'out';
  draw();
};

// The dish form --------------------------------------------------------------------------------------------------------

const blank = () => ({ id: null, name_ar: '', name_en: '', meal: '', servings: '', ingredients: '', steps: '', oldPath: null, photo: null, dropPhoto: false, busy: false, error: null, errors: {} });

function closeEditor() {
  if (editor && editor.photo) URL.revokeObjectURL(editor.photo.url);
  editor = null;
}

/** Cancel: the form closes, back on the button that opened it. */
function cancel(d) {
  closeEditor();
  draw();
  focusKey(d.id ? `edit-${d.id}` : 'add');
}

async function openEditor(id) {
  notice = null;
  confirming = null;
  if (!id) {
    editor = blank();
    draw();
    return focus('name_ar');
  }
  try {
    // Theirs only (the team can read every partner's dish).
    const [row] = await table('partner_dishes', { select: 'id,status,name_ar,name_en,meal,servings,ingredients,steps,photo_path', filter: { id: `eq.${id}`, partner_id: `eq.${partnerId}` } });
    if (!row || row.status !== 'pending') {
      notice = { text: t('راجعناها قبل شوي، فما عاد تقدر تعدّلها.', "We've just reviewed it, so it can't be changed now."), warn: true };
      return load();
    }
    editor = { ...blank(), id, name_ar: row.name_ar || '', name_en: row.name_en || '', meal: row.meal, servings: String(row.servings), ingredients: row.ingredients, steps: row.steps, oldPath: row.photo_path };
    signPhotos([row.photo_path]);
  } catch (e) {
    notice = { text: problem(e), warn: true };
  }
  draw();
  focus('name_ar');
}

const focus = (key) => {
  const node = document.getElementById(`f-${key}`) || document.getElementById(key);
  if (node) node.focus();
};

/** The photo as it goes up: a JPEG 2048 px at most (phones' photos are often over 5 MB), else the file as it is when it fits. */
async function prepare(file) {
  try {
    const image = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    if (image.close) image.close();
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', 0.86));
    if (blob && blob.size <= MAX_PHOTO) return { blob, ext: 'jpg' };
  } catch {
    // A format this browser can't draw (HEIC outside Safari): sent as it is.
  }
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' }[file.type];
  return ext && file.size <= MAX_PHOTO ? { blob: file, ext } : null;
}

function dishProblem(e) {
  const code = (e && e.code) || '';
  if (code === 'locked') return t(`الطبخات تنفتح لما يدفع ${NEEDED} عميل بكودك.`, `Dishes open once ${NEEDED} customers have paid with your code.`);
  if (code === 'limit') return t(`أرسلت ${MOST} طبخات، وهذا الحد. لو ما اعتمدنا وحدة، ينفتح مكانها.`, `You've sent ${MOST} dishes, the most for now. If we don't approve one, its place opens again.`);
  if (code === 'inactive') return t(`كودك موقوف الحين، فما تقدر ترسل طبخات. راسلنا على ${SUPPORT}.`, `Your code is paused, so dishes can't be sent now. Write to us at ${SUPPORT}.`);
  if (/check constraint|violates/i.test(code)) return t('في خانة ما ضبطت. تأكد منها وجرّب مرة ثانية.', "Something in the form doesn't fit. Check it and try again.");
  return problem(e);
}

async function save() {
  const d = editor;
  d.errors = checkDish(d);
  d.error = null;
  const wrong = Object.keys(d.errors);
  if (wrong.length) {
    draw();
    return focus(wrong[0]);
  }
  d.busy = true;
  draw();
  let uploaded = null;
  try {
    if (d.photo) {
      const ready = await prepare(d.photo.file);
      if (!ready) throw { code: 'photo_size' };
      const path = `${partnerId}/${crypto.randomUUID()}.${ready.ext}`;
      try {
        await files.upload(BUCKET, path, ready.blob);
      } catch (e) {
        throw e.code === 'network' ? e : { code: 'photo' };
      }
      uploaded = path;
    }
    const row = { ...dishRow(d), ...(uploaded ? { photo_path: uploaded } : d.dropPhoto ? { photo_path: null } : {}) };
    if (d.id) {
      const changed = await table('partner_dishes', { method: 'PATCH', select: 'id', filter: { id: `eq.${d.id}` }, body: row });
      if (!changed.length) {
        if (uploaded) files.remove(BUCKET, [uploaded]).catch(() => {});
        notice = { text: t('راجعناها قبل ما توصل تعديلاتك، فما تغيّرت.', 'We reviewed it before your changes got in, so it stays as it was.'), warn: true };
      } else {
        // The old photo goes once the dish no longer names it.
        if ((uploaded || d.dropPhoto) && d.oldPath) files.remove(BUCKET, [d.oldPath]).catch(() => {});
        notice = { text: t('حفظنا تعديلاتك.', 'Your changes are saved.') };
      }
    } else {
      await table('partner_dishes', { method: 'POST', select: 'id', body: { partner_id: partnerId, ...row } });
      notice = { text: t('وصلتنا طبختك. نراجعها ونرد عليك هنا.', "Your dish is in. We'll review it and reply here.") };
    }
    closeEditor();
    announce(notice.text);
    await load();
    focus('dishes');
  } catch (e) {
    if (uploaded) files.remove(BUCKET, [uploaded]).catch(() => {});
    if (!auth.user()) return signedOut();
    d.busy = false;
    d.error =
      e.code === 'photo_size'
        ? t('الصورة كبيرة علينا. جرّب صورة ثانية أو أرسلها بدون صورة.', "That photo is too big for us. Try another, or send the dish without one.")
        : e.code === 'photo'
          ? t('ما قدرنا نرفع الصورة. جرّب صورة JPG أو PNG، أو أرسلها بدون صورة.', "We couldn't upload the photo. Try a JPG or PNG, or send the dish without one.")
          : dishProblem(e);
    draw();
    announce(d.error);
    // Refused by the gate: the list shows why (a dish sent from another tab, the count changed).
    if (['limit', 'locked', 'inactive'].includes(e.code)) load();
  }
}

async function remove(id) {
  deleting = id;
  confirming = null;
  draw();
  try {
    const gone = await table('partner_dishes', { method: 'DELETE', select: 'id,photo_path', filter: { id: `eq.${id}` } });
    if (!gone.length) notice = { text: t('راجعناها قبل شوي، فما عاد تقدر تحذفها.', "We've just reviewed it, so it can't be deleted now."), warn: true };
    else {
      if (gone[0].photo_path) files.remove(BUCKET, [gone[0].photo_path]).catch(() => {});
      notice = { text: t('حذفناها.', 'Deleted.') };
    }
  } catch (e) {
    if (!auth.user()) {
      deleting = null;
      return signedOut();
    }
    notice = { text: problem(e), warn: true };
  }
  deleting = null;
  announce(notice.text);
  await load();
  focus('dishes');
}

function pickPhoto(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) {
    editor.error = t('اختر صورة.', 'Pick a photo.');
    return draw();
  }
  if (editor.photo) URL.revokeObjectURL(editor.photo.url);
  editor.photo = { file, url: URL.createObjectURL(file) };
  editor.dropPhoto = false;
  editor.error = null;
  draw();
  focus('photo');
}

function photoField(d) {
  const current = d.photo ? d.photo.url : d.oldPath && !d.dropPhoto ? photos.get(d.oldPath) : null;
  const has = Boolean(d.photo || (d.oldPath && !d.dropPhoto));
  return el(
    'div',
    { class: 'field' },
    el('p', { class: 'label', id: 'photo-label' }, t('صورة الطبخة (اختياري)', 'A photo of the dish (optional)')),
    el('p', { class: 'hint', id: 'photo-hint' }, t('تعرّفنا على شكلها. نصوّرها بأسلوب منثفُل قبل ما تنزل في التطبيق.', "It shows us how it looks. We'll photograph it in Monthful's style before it goes in the app.")),
    has && current && current !== 'failed' ? el('img', { class: 'preview', src: current, alt: t('الصورة اللي اخترتها', 'The photo you picked') }) : null,
    el(
      'div',
      { class: 'row-actions' },
      el('input', { id: 'f-photo', class: 'sr-only file', type: 'file', accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif', 'data-key': 'photo', 'aria-describedby': 'photo-hint', onchange: pickPhoto }),
      el('label', { for: 'f-photo', class: 'btn small' }, has ? t('غيّر الصورة', 'Change the photo') : t('أضف صورة', 'Add a photo')),
      has
        ? el(
            'button',
            {
              class: 'btn small', type: 'button', 'data-key': 'drop-photo',
              onclick: () => {
                if (d.photo) URL.revokeObjectURL(d.photo.url);
                d.photo = null;
                d.dropPhoto = Boolean(d.oldPath);
                draw();
                focus('photo');
              },
            },
            t('شيل الصورة', 'Remove the photo'),
          )
        : null,
    ),
  );
}

function editorView(d) {
  return form(
    { label: d.id ? t('عدّل طبختك', 'Change your dish') : t('أضف طبختك', 'Add your dish'), onSubmit: save },
    el('h3', {}, d.id ? t('عدّل طبختك', 'Change your dish') : t('أضف طبختك', 'Add your dish')),
    dishFields(d),
    photoField(d),
    d.error ? el('p', { class: 'note warn', role: 'alert' }, d.error) : null,
    el('button', { class: 'btn main', type: 'submit', 'data-key': 'save', disabled: d.busy || null }, d.busy ? t('نرسلها…', 'Sending…') : d.id ? t('احفظ التعديل', 'Save the changes') : t('أرسلها', 'Send it')),
    el('button', { class: 'btn', type: 'button', 'data-key': 'cancel', disabled: d.busy || null, onclick: () => cancel(d) }, t('إلغاء', 'Cancel')),
  );
}

// The page -------------------------------------------------------------------------------------------------------------

const STATUS = {
  pending: ['ننتظر مراجعتنا', 'Waiting for our review', 'wait'],
  approved: ['اعتمدناها', 'Approved', 'yes'],
  rejected: ['ما اعتمدناها', 'Not approved', 'no'],
};

function dishItem(d) {
  const name = dishName(d);
  const other = t(d.name_ar && d.name_en ? d.name_en : null, d.name_ar && d.name_en ? d.name_ar : null);
  const [ar, en, look] = STATUS[d.status] || STATUS.pending;
  const url = d.photo_path ? photos.get(d.photo_path) : null;
  const pending = d.status === 'pending';
  const asking = confirming === d.id;
  return el(
    'li',
    { class: 'item dish' },
    url && url !== 'failed' ? el('img', { class: 'thumb', src: url, alt: '' }) : null,
    el(
      'div',
      {},
      el('p', { class: 'name' }, el('bdi', {}, name)),
      other ? el('p', { class: 'small muted' }, el('bdi', { lang: lang2() }, other)) : null,
      el('p', { class: 'small muted' }, mealLine(d)),
      el('span', { class: `tag ${look}` }, t(ar, en)),
      d.status === 'approved' ? el('p', { class: 'small muted' }, t('تنزل في منثفُل باسمك في تحديث جاي.', 'It goes into Monthful under your name in a coming update.')) : null,
      d.admin_note ? el('p', { class: 'small said' }, el('span', { class: 'said-who' }, t('ملاحظتنا: ', 'Our note: ')), el('bdi', {}, d.admin_note)) : null,
      el('p', { class: 'small muted' }, t(`أرسلتها ${dateName(d.created_at)}`, `Sent ${dateName(d.created_at)}`)),
      pending && !editor
        ? asking
          ? el(
              'div',
              { class: 'confirm', role: 'group', 'aria-label': t('تأكيد الحذف', 'Confirm deleting') },
              el('p', { class: 'small' }, t('تحذفها؟ ما ترجع بعدها.', "Delete it? It can't be brought back.")),
              el(
                'div',
                { class: 'row-actions' },
                el('button', { class: 'btn small danger', type: 'button', 'data-key': `yes-${d.id}`, onclick: () => remove(d.id) }, t('إيه، احذفها', 'Yes, delete it')),
                el('button', { class: 'btn small', type: 'button', 'data-key': `no-${d.id}`, onclick: () => ((confirming = null), draw(), focusKey(`del-${d.id}`)) }, t('خلّها', 'Keep it')),
              ),
            )
          : el(
              'div',
              { class: 'row-actions' },
              el('button', { class: 'btn small', type: 'button', 'data-key': `edit-${d.id}`, disabled: deleting ? true : null, onclick: () => openEditor(d.id) }, t('عدّلها', 'Change it')),
              el(
                'button',
                { class: 'btn small', type: 'button', 'data-key': `del-${d.id}`, disabled: deleting ? true : null, onclick: () => ((confirming = d.id), draw(), focusKey(`no-${d.id}`)) },
                deleting === d.id ? t('نحذفها…', 'Deleting…') : t('احذفها', 'Delete it'),
              ),
            )
        : null,
    ),
  );
}

/** The other language, for the dish's second name. */
const lang2 = () => t('en', 'ar');
const focusKey = (key) => {
  const node = document.querySelector(`[data-key="${key}"]`);
  if (node) node.focus();
};


function dishesCard(s) {
  const paid = Number(s.paid_customers) || 0;
  const left = Number(s.dishes_left) || 0;
  const list = Array.isArray(s.dishes) ? s.dishes : [];
  let body;
  if (!s.dishes_unlocked) {
    const bar = el('span', {});
    bar.style.width = `${Math.min(100, Math.round((paid / NEEDED) * 100))}%`;
    body = [
      el('p', { class: 'muted' }, t(`لما يدفع ${NEEDED} عميل بكودك، تقدر ترسل لنا لين ${MOST} طبخات من مطبخك، وننزّل اللي نعتمده في منثفُل باسمك.`, `Once ${NEEDED} customers have paid with your code, you can send us up to ${MOST} of your own dishes, and the ones we approve go into Monthful under your name.`)),
      el('span', { class: 'bar wide-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': NEEDED, 'aria-valuenow': Math.min(paid, NEEDED), 'aria-label': t('اللي دفعوا بكودك', 'Paid with your code') }, bar),
      el('p', { class: 'small muted' }, t(`${num(paid)} من ${num(NEEDED)} · باقي ${counted(NEEDED - paid, CUSTOMERS)}`, `${num(paid)} of ${num(NEEDED)} · ${counted(NEEDED - paid, CUSTOMERS)} to go`)),
    ];
  } else {
    body = [
      el('p', { class: 'muted' }, t(`ترسل لين ${MOST} طبخات. نراجعها، وننزّل اللي نعتمده في منثفُل باسمك في تحديث جاي.`, `Send up to ${MOST} dishes. We review them, and the ones we approve go into Monthful under your name in a coming update.`)),
      list.length ? el('ul', { class: 'list' }, list.map(dishItem)) : null,
      editor
        ? editorView(editor)
        : !s.active
          ? el('p', { class: 'note warn' }, t(`كودك موقوف الحين، فما تقدر ترسل طبخات. راسلنا على ${SUPPORT}.`, `Your code is paused, so dishes can't be sent now. Write to us at ${SUPPORT}.`))
          : left > 0
            ? [
                el('button', { class: 'btn main', type: 'button', 'data-key': 'add', onclick: () => openEditor(null) }, t('أضف طبختك', 'Add your dish')),
                el('p', { class: 'small muted center' }, t(`تقدر ترسل ${counted(left, MORE)} بعد.`, `You can send ${counted(left, MORE)}.`)),
              ]
            : el('p', { class: 'note' }, t(`أرسلت ${MOST} طبخات، وهذا الحد. لو ما اعتمدنا وحدة، ينفتح مكانها.`, `You've sent ${MOST} dishes, the most for now. If we don't approve one, its place opens again.`)),
    ];
  }
  return el(
    'section',
    { class: 'card', 'aria-labelledby': 'dishes' },
    el('h2', { id: 'dishes', tabindex: '-1', 'data-key': 'dishes' }, t('طبخاتك', 'Your dishes')),
    notice ? el('p', { class: `note${notice.warn ? ' warn' : ''}` }, notice.text) : null,
    body.flat(),
  );
}

function dashboard(s) {
  const out = () => signedOut();
  return [
    signedIn({ onSignOut: out }),
    el(
      'section',
      { class: 'card' },
      el('p', { class: 'over' }, t('شركاء منثفُل', 'Monthful partners')),
      el('h1', {}, t('أهلاً ', 'Hello, '), el('bdi', {}, s.name)),
      s.handle ? el('p', { class: 'muted' }, el('bdi', { dir: 'ltr' }, s.handle)) : null,
      el(
        'div',
        { class: 'code' },
        el('p', { class: 'code-label', id: 'code-label' }, t('كودك', 'Your code')),
        el('p', { class: 'code-value big', dir: 'ltr', lang: 'en', 'aria-labelledby': 'code-label' }, s.code),
        el('p', { class: 'small muted' }, t('عملاؤك يكتبونه في منثفُل («عندي كود») وياخذون خصم على أول دفعة.', 'Your customers type it in Monthful (I have a code) and get a discount on their first payment.')),
      ),
      s.active ? null : el('p', { class: 'note warn' }, t(`كودك موقوف الحين: العملاء ما يقدرون يستخدمونه. لو هذا غلط، راسلنا على ${SUPPORT}.`, `Your code is paused for now: customers can't use it. If that's a mistake, write to us at ${SUPPORT}.`)),
    ),
    el(
      'section',
      { class: 'card' },
      el('h2', {}, t('عملاؤك', 'Your customers')),
      el(
        'dl',
        { class: 'stats' },
        stat(t('جرّبوا أو دفعوا بكودك', 'Tried or paid with your code'), num(Number(s.used) || 0)),
        stat(t('دفعوا مرة على الأقل', 'Paid at least once'), num(Number(s.paid_customers) || 0)),
        stat(t('مشتركين الحين', 'Subscribed now'), num(Number(s.paying_now) || 0)),
        stat(t('في الأسبوع المجاني الحين', 'In the free week now'), num(Number(s.trying_now) || 0)),
      ),
      el('p', { class: 'small muted' }, t('نعدّ العملاء بس، وما نعرض اسم أي أحد.', 'We only count customers; nobody is named.')),
    ),
    el(
      'section',
      { class: 'card' },
      el('h2', {}, t('أرباحك', 'Your earnings')),
      el('dl', { class: 'stats' }, stat(t('باقي لك', 'Still owed'), money(s.owed_sar), true), stat(t('كسبت', 'Earned'), money(s.earned_sar)), stat(t('حوّلنا لك', 'Paid to you'), money(s.paid_out_sar))),
      el(
        'p',
        { class: 'small muted' },
        t(
          'تكسب 10% من كل دفعة يدفعها عملاؤك، من السعر اللي يدفعه العميل نفسه، ونحسبها بالريال. الأسبوع المجاني ما فيه دفع، والدفعة اللي تنرد للعميل تنخصم.',
          'You earn 10% of every payment your customers make, of the price the customer pays, counted in riyals. The free week has no payment, and refunds come off.',
        ),
      ),
      payouts.length
        ? el(
            'div',
            { class: 'section' },
            el('h3', {}, t('اللي حوّلناه لك', 'What we have paid you')),
            el(
              'ul',
              { class: 'list' },
              payouts.map((p) => el('li', { class: 'item line' }, el('span', {}, dateName(p.paid_at), p.note ? el('bdi', { class: 'small muted block' }, p.note) : null), el('span', { class: 'amount' }, riyals(p.amount_sar)))),
            ),
          )
        : null,
    ),
    dishesCard(s),
  ];
}

function view() {
  if (state === 'loading') return el('p', { class: 'loading', role: 'status' }, t('نجيب صفحتك…', 'Getting your page…'));
  if (state === 'out') {
    const card = signInCard({
      draw,
      over: t('شركاء منثفُل', 'Monthful partners'),
      line: t('ادخل بالإيميل اللي أعطيتنا، وتشوف كودك وعملاءه وأرباحك وطبخاتك.', 'Sign in with the email you gave us to see your code, its customers, your earnings and your dishes.'),
      onSignedIn: () => {
        ended = false;
        load();
      },
    });
    return ended ? [el('p', { class: 'note warn', role: 'status' }, t('انتهى دخولك. ادخل مرة ثانية.', 'You were signed out. Please sign in again.')), card] : card;
  }
  if (state === 'stranger') {
    return notForYou({
      over: t('شركاء منثفُل', 'Monthful partners'),
      title: t('هالصفحة لشركاء منثفُل', 'This page is for Monthful partners'),
      line: t('ما لقينا شريك بهالإيميل. لو أنت شريك، ادخل بالإيميل اللي أعطيتنا، أو راسلنا على', "We couldn't find a partner with this email. If you're a partner, sign in with the email you gave us, or write to us at"),
      onSignOut: signedOut,
    });
  }
  if (state === 'error') {
    return [
      signedIn({ onSignOut: signedOut }),
      el(
        'section',
        { class: 'card' },
        el('h1', {}, t('ما قدرنا نجيب صفحتك', "We couldn't get your page")),
        el('p', { class: 'muted' }, t('تأكد من الإنترنت وجرّب مرة ثانية.', 'Check your connection and try again.')),
        el('button', { class: 'btn main', type: 'button', 'data-key': 'retry', onclick: () => (focusHeading(), load()) }, t('جرّب مرة ثانية', 'Try again')),
      ),
    ];
  }
  return dashboard(stats);
}

const draw = page({ title: () => t('شركاء منثفُل', 'Monthful partners'), view });
// Back on the page: the latest numbers (not while they're writing a dish).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state === 'ready' && !editor && !deleting) load();
});
load();
