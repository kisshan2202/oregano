(() => {
const $ = id => document.getElementById(id);
const API = String(window.OREGANO_API || '').replace(/\/$/, '');
const LS = { draft: 'oregano-draft' };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

let data = null;        // live data (published or draft)
let admin = false;
let dirty = false;
let deletes = new Set(); // published image files to remove on next Publish
let editing = null;     // {sectionId, item|null}
let pendingImage = undefined; // undefined = unchanged, '' = removed, 'data:' = new

const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmt = p => { p = String(p ?? '').trim(); if (!p) return ''; return isNaN(p) ? p : '$' + Number(p).toFixed(2); };
const hue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const toastEl = $('toast'); let toastT;
const toast = m => { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 4000); };

/* ---------- rendering ---------- */
function imageNode(item) {
  const box = el('div', 'img');
  if (item.image) {
    const img = new Image(); img.src = item.image; img.alt = item.name; img.loading = 'lazy';
    img.onerror = () => { box.replaceChildren(placeholder(item.name)); };
    box.append(img);
  } else box.append(placeholder(item.name));
  return box;
}
function placeholder(name) {
  const p = el('div', 'ph', (name.trim()[0] || '?').toUpperCase());
  p.style.setProperty('--h', hue(name)); return p;
}
function card(item, sectionId, withAdmin) {
  const c = el('article', 'card');
  c.append(imageNode(item));
  const b = el('div', 'body'), r = el('div', 'row');
  r.append(el('span', null, item.name));
  if (fmt(item.price)) r.append(el('span', 'price', fmt(item.price)));
  b.append(r);
  if (item.desc) b.append(el('div', 'desc', item.desc));
  c.append(b);
  c.tabIndex = 0; c.setAttribute('role', 'button'); c.setAttribute('aria-label', 'View ' + item.name);
  c.onclick = () => openDetail(item);
  c.onkeydown = ev => { if (ev.target === c && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openDetail(item); } };
  if (withAdmin) {
    const t = el('div', 'editbtns');
    const e = el('button', null, 'Edit'); e.onclick = ev => { ev.stopPropagation(); openEditor(sectionId, item); };
    const d = el('button', 'del', '✕'); d.title = 'Delete'; d.onclick = ev => { ev.stopPropagation(); removeItem(sectionId, item); };
    t.append(e, d); c.append(t);
  }
  return c;
}
/* ---------- about us ---------- */
const DEFAULT_ABOUT = { locations: [
  { name: 'Wollert', address: '4B Linfield Parade, Wollert VIC 3750', hours: '' },
  { name: 'Epping', address: 'Shop 3/299 Harvest Home Rd, Epping VIC 3076', hours: '' }
] };
function renderAbout() {
  const root = $('about'); root.replaceChildren();
  root.append(el('h2', null, 'About us'));
  root.append(el('p', 'about-intro', 'Visit Oregano’s Bakehouse & Cafe at either of our two locations.'));
  if (admin) { const b = el('button', 'ghost', 'Edit locations & hours'); b.onclick = openAboutEditor; const w = el('div', 'addrow'); w.append(b); root.append(w); }
  const grid = el('div', 'locs');
  data.about.locations.forEach(l => {
    const c = el('article', 'loc');
    const map = document.createElement('iframe');
    map.src = 'https://www.google.com/maps?q=' + encodeURIComponent(l.address) + '&output=embed';
    map.loading = 'lazy'; map.title = 'Map of Oregano’s ' + l.name; map.referrerPolicy = 'no-referrer-when-downgrade';
    const body = el('div', 'loc-body');
    body.append(el('h3', null, l.name), el('p', 'addr', l.address));
    const hrs = el('div', 'hours'); hrs.append(el('h4', null, 'Opening hours'));
    const lines = (l.hours || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) hrs.append(el('p', 'soon', 'Opening hours coming soon.'));
    lines.forEach(line => {
      const i = line.indexOf(': '), r = el('div', 'hrow');
      if (i > 0) r.append(el('span', null, line.slice(0, i)), el('span', null, line.slice(i + 2))); else r.append(el('span', null, line));
      hrs.append(r);
    });
    const dir = el('a', 'btn', 'Get directions'); dir.target = '_blank'; dir.rel = 'noopener';
    dir.href = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(l.address);
    body.append(hrs, dir); c.append(map, body); grid.append(c);
  });
  root.append(grid);
}
const aboutDlg = $('about-dlg');
function openAboutEditor() {
  const f = $('about-form'); f.replaceChildren(el('h3', null, 'Locations & hours'));
  data.about.locations.forEach((l, i) => {
    const wrap = el('fieldset', 'locedit'); wrap.append(el('legend', null, 'Location ' + (i + 1)));
    const mkLabel = (t, input) => { const lb = el('label', null, t); lb.append(input); return lb; };
    const n = el('input'); n.value = l.name; n.name = 'name' + i; n.required = true;
    const a = el('input'); a.value = l.address; a.name = 'addr' + i; a.required = true;
    const h = el('textarea'); h.rows = 7; h.value = l.hours || ''; h.name = 'hours' + i; h.placeholder = 'Monday: 7am – 3pm\nTuesday: 7am – 3pm\n…';
    wrap.append(mkLabel('Name', n), mkLabel('Address', a), mkLabel('Opening hours (one per line, as "Day: hours")', h)); f.append(wrap);
  });
  const act = el('div', 'actions'); const cancel = el('button', 'ghost', 'Cancel'); cancel.type = 'button'; cancel.onclick = () => aboutDlg.close();
  act.append(el('span', 'spacer'), cancel, el('button', null, 'Save')); f.append(act); aboutDlg.showModal();
}
$('about-form').onsubmit = () => {
  const f = $('about-form');
  data.about.locations.forEach((l, i) => { l.name = f['name' + i].value.trim(); l.address = f['addr' + i].value.trim(); l.hours = f['hours' + i].value.trim(); });
  markDirty();
};

function render() {
  if (!data.about) data.about = JSON.parse(JSON.stringify(DEFAULT_ABOUT));
  // showcase strip: items with images first, otherwise everything
  const all = data.sections.flatMap(s => s.items);
  let pool = all.filter(i => i.image);
  if (pool.length < 6) pool = all;
  const picks = pool.slice().sort(() => 0.5 - Math.random()).slice(0, 14);
  const track = $('track'); track.replaceChildren();
  [...picks, ...picks].forEach(i => track.append(card(i, null, false)));
  track.style.setProperty('--dur', Math.max(30, picks.length * 5) + 's');

  // nav
  const nav = $('nav'); nav.replaceChildren();
  [['bakery', 'Bakery'], ['pizza', 'Pizza'], ['sweets', 'Sweets'], ['drinks', 'Drinks']].forEach(([id, label]) => {
    if (!sectionOf(id)) return;
    const a = el('a', null, label); a.href = '#' + id; nav.append(a);
  });
  const ab = el('a', null, 'About us'); ab.href = '#about'; nav.append(ab);

  // sections
  const main = $('menu'); main.replaceChildren();
  data.sections.forEach(s => {
    const sec = el('section', 'menu'); sec.id = s.id;
    sec.append(el('h2', null, s.title));
    if (admin) {
      const row = el('div', 'addrow'); const b = el('button', null, '+ Add item');
      b.onclick = () => openEditor(s.id, null); row.append(b); sec.append(row);
    }
    const g = el('div', 'gallery');
    s.items.forEach(i => g.append(card(i, s.id, admin)));
    sec.append(g); main.append(sec);
  });
  $('updated').textContent = data.updated ? 'Menu as of ' + data.updated : '';
  $('adminbar').hidden = !admin;
  $('draftstate').textContent = dirty ? '· unpublished changes' : '· no changes';
  $('btn-publish').disabled = !dirty;
  $('btn-discard').disabled = !dirty;
  renderAbout();
  observe();
}
const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { threshold: .08 }) : null;
function observe() {
  document.querySelectorAll('.gallery .card').forEach((c, i) => {
    c.classList.add('reveal'); c.style.setProperty('--d', (i % 6) * .06 + 's');
    io ? io.observe(c) : c.classList.add('in');
  });
}

/* ---------- item detail popup ---------- */
const dd = $('detail'); let dCtx = null, dClosing = false;
function openDetail(item) {
  const sec = data.sections.find(s => s.items.some(i => i.id === item.id)); if (!sec) return;
  dCtx = { list: sec.items, idx: sec.items.findIndex(i => i.id === item.id), title: sec.title };
  dClosing = false; dd.classList.remove('closing'); fillDetail(0); dd.showModal();
}
function fillDetail(dir) {
  const it = dCtx.list[dCtx.idx], n = dCtx.list.length;
  $('d-img').replaceChildren(imageNode(it));
  $('d-sec').textContent = dCtx.title;
  $('d-name').textContent = it.name;
  $('d-price').textContent = fmt(it.price); $('d-price').hidden = !fmt(it.price);
  $('d-desc').textContent = it.desc || ''; $('d-desc').hidden = !it.desc;
  $('d-count').textContent = `${dCtx.idx + 1} / ${n}`;
  $('d-prev').hidden = $('d-next').hidden = n < 2;
  dd.style.setProperty('--dx', dir * 70 + 'px');
  dd.classList.remove('swap'); void dd.offsetWidth; dd.classList.add('swap');
}
function stepDetail(d) { const n = dCtx.list.length; dCtx.idx = (dCtx.idx + d + n) % n; fillDetail(d); }
function closeDetail() {
  if (dClosing || !dd.open) return; dClosing = true; dd.classList.add('closing');
  setTimeout(() => { dd.close(); dd.classList.remove('closing'); dClosing = false; }, 220);
}
$('d-close').onclick = closeDetail;
$('d-prev').onclick = () => stepDetail(-1);
$('d-next').onclick = () => stepDetail(1);
dd.addEventListener('cancel', e => { e.preventDefault(); closeDetail(); });
dd.addEventListener('click', e => {
  const r = dd.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDetail();
});
dd.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') stepDetail(-1); else if (e.key === 'ArrowRight') stepDetail(1);
});
let tx = null;
dd.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
dd.addEventListener('touchend', e => {
  if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; tx = null;
  if (Math.abs(dx) > 50) stepDetail(dx < 0 ? 1 : -1);
});

/* ---------- draft handling ---------- */
function markDirty() {
  dirty = true;
  if (!store.set(LS.draft, JSON.stringify({ data, deletes: [...deletes] }))) toast('Draft too large to save locally — publish soon.');
  render();
}
const sectionOf = id => data.sections.find(s => s.id === id);
const trackDelete = p => { if (p && p.startsWith('images/items/')) deletes.add(p); };
function removeItem(sid, item) {
  if (!confirm(`Delete "${item.name}"?`)) return;
  trackDelete(item.image);
  const s = sectionOf(sid); s.items = s.items.filter(i => i.id !== item.id); markDirty();
}

/* ---------- editor ---------- */
const dlg = $('editor');
function previewNode(name, image) {
  const p = $('f-preview'); p.replaceChildren();
  if (image) { const i = new Image(); i.src = image; i.style.cssText = 'width:100%;height:100%;object-fit:cover'; p.append(i); }
  else { const ph = placeholder(name || '?'); ph.style.fontSize = '32px'; p.append(ph); }
}
function openEditor(sid, item) {
  editing = { sid, item }; pendingImage = undefined;
  $('edit-title').textContent = item ? 'Edit item' : 'Add item';
  $('f-name').value = item?.name || ''; $('f-price').value = item?.price || ''; $('f-desc').value = item?.desc || '';
  $('f-image').value = ''; $('f-delete').style.display = item ? '' : 'none';
  previewNode(item?.name, item?.image); dlg.showModal();
}
async function shrink(file) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const max = 900, k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  return c.toDataURL('image/jpeg', .82);
}
$('f-image').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { pendingImage = await shrink(f); previewNode($('f-name').value, pendingImage); } catch { toast('Could not read that image.'); }
};
$('f-clear').onclick = () => { pendingImage = ''; $('f-image').value = ''; previewNode($('f-name').value, ''); };
$('f-cancel').onclick = () => dlg.close();
$('f-delete').onclick = () => { dlg.close(); removeItem(editing.sid, editing.item); };
$('edit-form').onsubmit = () => {
  const name = $('f-name').value.trim(); if (!name) return;
  const vals = { name, price: $('f-price').value.trim().replace(/^\$/, ''), desc: $('f-desc').value.trim() };
  const s = sectionOf(editing.sid);
  if (editing.item) {
    Object.assign(editing.item, vals);
    if (pendingImage !== undefined) { trackDelete(editing.item.image); editing.item.image = pendingImage; }
  } else s.items.push({ id: uid(), ...vals, image: pendingImage || '' });
  markDirty();
};

/* ---------- admin service (login + publish) ---------- */
const SES = 'oregano-session';
const getSession = () => { try { const s = JSON.parse(sessionStorage.getItem(SES) || 'null'); return s && s.exp > Date.now() ? s.token : null; } catch { return null; } };
const setSession = (token, hours) => { try { token ? sessionStorage.setItem(SES, JSON.stringify({ token, exp: Date.now() + (hours || 8) * 3600e3 - 60e3 })) : sessionStorage.removeItem(SES); } catch {} };
const unlocked = () => !!getSession();
async function call(path, body, token) {
  let r;
  try { r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) }, body: JSON.stringify(body) }); }
  catch { throw new Error('Could not reach the admin service.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Request failed (' + r.status + ').'); e.status = r.status; throw e; }
  return j;
}
async function publish() {
  const btn = $('btn-publish'); btn.disabled = true; btn.textContent = 'Publishing…';
  try {
    const out = JSON.parse(JSON.stringify(data)), images = [];
    for (const s of out.sections) for (const i of s.items) if (i.image.startsWith('data:')) {
      const path = `images/items/${i.id}-${Date.now().toString(36)}.jpg`;
      images.push({ path, data: i.image.split(',')[1] }); i.image = path;
    }
    const keep = new Set(out.sections.flatMap(s => s.items.map(i => i.image)));
    const res = await call('/publish', { menu: out, images, deletes: [...deletes].filter(p => !keep.has(p)) }, getSession());
    out.updated = res.updated || out.updated;
    data = out; dirty = false; deletes = new Set(); store.del(LS.draft);
    toast('Published! The live site updates in about a minute.');
  } catch (e) {
    if (e.status === 401) { setSession(null); admin = false; toast('Session expired. Sign in again; your changes are kept as a draft.'); }
    else toast('Publish failed: ' + e.message);
  }
  btn.textContent = 'Publish'; render();
}
$('btn-publish').onclick = publish;
$('btn-discard').onclick = async () => {
  if (!confirm('Discard all unpublished changes?')) return;
  store.del(LS.draft); deletes = new Set(); dirty = false; await load(true);
};

/* ---------- admin sign-in ---------- */
const pwDlg = $('pw');
function enterAdmin() { admin = true; render(); }
function openLogin() {
  if (!API) { toast('The admin service is not set up yet (see admin-service/README.md).'); return; }
  if (!unlocked()) { $('pw-err').textContent = ''; $('pw-input').value = ''; return pwDlg.showModal(); }
  enterAdmin();
}
$('pw-cancel').onclick = () => pwDlg.close();
$('pw-form').onsubmit = async e => {
  e.preventDefault();
  const btn = $('pw-go'); btn.disabled = true;
  try {
    const r = await call('/login', { password: $('pw-input').value });
    setSession(r.token, r.hours); pwDlg.close(); await load(); openLogin();
  } catch (err) { $('pw-err').textContent = err.message; }
  btn.disabled = false;
};
$('admin-link').onclick = e => { e.preventDefault(); openLogin(); };
$('btn-logout').onclick = () => {
  if (dirty && !confirm('You have unpublished changes (they stay saved as a draft). Exit anyway?')) return;
  setSession(null); admin = false; load(true);
};

/* ---------- load ---------- */
async function load(ignoreDraft) {
  try {
    const draft = !ignoreDraft && store.get(LS.draft);
    if (draft && unlocked()) { const d = JSON.parse(draft); data = d.data || d; deletes = new Set(d.deletes || []); dirty = true; admin = true; }
    else {
      const r = await fetch('menu.json?v=' + Date.now()); if (!r.ok) throw 0;
      data = await r.json();
      if (ignoreDraft) { dirty = false; }
    }
    render();
    if (location.hash === '#admin') openLogin();
  } catch { $('menu').innerHTML = '<p class="loading">Sorry, the menu could not be loaded. Please refresh.</p>'; }
}
load();
})();
