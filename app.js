(() => {
const $ = id => document.getElementById(id);
const API = String(window.OREGANO_API || '').replace(/\/$/, '');
// Ordering (cart + WhatsApp) is hidden unless switched on in config.js or by adding ?order=1 to the address (handy for demos).
const ORDERING = window.OREGANO_ORDERING === true || new URLSearchParams(location.search).get('order') === '1';
document.documentElement.classList.toggle('ordering', ORDERING);
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
function card(item, sectionId, withAdmin, compact) {
  const c = el('article', 'card');
  c.append(imageNode(item));
  const b = el('div', 'body'), r = el('div', 'row');
  r.append(el('span', null, item.name));
  if (fmt(item.price)) r.append(el('span', 'price', fmt(item.price)));
  b.append(r);
  if (item.desc && !compact) b.append(el('div', 'desc', item.desc));
  if (!compact && ORDERING) b.append(cartControl(item));
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
  { name: 'Wollert', address: '4B Linfield Parade, Wollert VIC 3750', hours: '', whatsapp: '' },
  { name: 'Epping', address: 'Shop 3/299 Harvest Home Rd, Epping VIC 3076', hours: '', whatsapp: '' }
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
    if (admin) { const w = el('p', 'wa-row' + (waNumber(l.whatsapp) ? '' : ' unset'), '📱 WhatsApp orders: ' + (l.whatsapp ? l.whatsapp : 'not set (ordering disabled for this store)')); body.append(w); }
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
    const w = el('input'); w.value = l.whatsapp || ''; w.name = 'wa' + i; w.type = 'tel'; w.placeholder = '+61 4xx xxx xxx'; w.pattern = '\\+?[0-9 \\(\\)\\-]{8,22}'; w.title = 'Include the country code, e.g. +61 412 345 678';
    const h = el('textarea'); h.rows = 7; h.value = l.hours || ''; h.name = 'hours' + i; h.placeholder = 'Monday: 7am – 3pm\nTuesday: 7am – 3pm\n…';
    wrap.append(mkLabel('Name', n), mkLabel('Address', a), mkLabel('WhatsApp number for orders (with country code; a leading 0 is treated as Australia +61)', w), mkLabel('Opening hours (one per line, as "Day: hours")', h)); f.append(wrap);
  });
  const act = el('div', 'actions'); const cancel = el('button', 'ghost', 'Cancel'); cancel.type = 'button'; cancel.onclick = () => aboutDlg.close();
  act.append(el('span', 'spacer'), cancel, el('button', null, 'Save')); f.append(act); aboutDlg.showModal();
}
$('about-form').onsubmit = () => {
  const f = $('about-form');
  data.about.locations.forEach((l, i) => { l.name = f['name' + i].value.trim(); l.address = f['addr' + i].value.trim(); l.hours = f['hours' + i].value.trim(); l.whatsapp = f['wa' + i].value.trim(); });
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
  [...picks, ...picks].forEach(i => track.append(card(i, null, false, true)));
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
  document.documentElement.style.setProperty('--ab', admin ? $('adminbar').offsetHeight + 'px' : '0px');
  refreshCart();
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
  $('d-cart').replaceChildren(...(ORDERING ? [cartControl(it, true)] : []));
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
  closeCropper();
  $('edit-title').textContent = item ? 'Edit item' : 'Add item';
  $('f-name').value = item?.name || ''; $('f-price').value = item?.price || ''; $('f-desc').value = item?.desc || '';
  $('f-image').value = ''; $('f-delete').style.display = item ? '' : 'none';
  previewNode(item?.name, item?.image); dlg.showModal();
}
/* photo cropper: choose which part of the photo shows in the 4:3 box, then resize */
const CW = 640, CH = 480, BG = '#fffaf2';
const cc = $('crop-canvas'), cctx = cc.getContext('2d');
let crop = null; // { img, url, s, ox, oy, min, max }
const coverScale = () => Math.max(CW / crop.img.width, CH / crop.img.height);
const containScale = () => Math.min(CW / crop.img.width, CH / crop.img.height);
function clampCrop() {
  const w = crop.img.width * crop.s, h = crop.img.height * crop.s;
  crop.ox = w >= CW ? Math.min(0, Math.max(CW - w, crop.ox)) : Math.min(CW - w, Math.max(0, crop.ox));
  crop.oy = h >= CH ? Math.min(0, Math.max(CH - h, crop.oy)) : Math.min(CH - h, Math.max(0, crop.oy));
}
function drawCrop() {
  cctx.fillStyle = BG; cctx.fillRect(0, 0, CW, CH);
  cctx.drawImage(crop.img, crop.ox, crop.oy, crop.img.width * crop.s, crop.img.height * crop.s);
  cctx.strokeStyle = 'rgba(255,255,255,.45)'; cctx.lineWidth = 1; cctx.beginPath();
  for (let k = 1; k < 3; k++) { cctx.moveTo(CW * k / 3, 0); cctx.lineTo(CW * k / 3, CH); cctx.moveTo(0, CH * k / 3); cctx.lineTo(CW, CH * k / 3); }
  cctx.stroke();
  $('crop-zoom').value = Math.round(100 * (crop.s - crop.min) / (crop.max - crop.min));
}
function setScale(s, px = CW / 2, py = CH / 2) {
  s = Math.min(crop.max, Math.max(crop.min, s));
  crop.ox = px - (px - crop.ox) * s / crop.s; crop.oy = py - (py - crop.oy) * s / crop.s; crop.s = s;
  clampCrop(); drawCrop();
}
function centerAt(s) { crop.s = s; crop.ox = (CW - crop.img.width * s) / 2; crop.oy = (CH - crop.img.height * s) / 2; clampCrop(); drawCrop(); }
function closeCropper() {
  if (crop) URL.revokeObjectURL(crop.url);
  crop = null; $('cropper').hidden = true; $('f-image').value = '';
}
$('f-image').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    if (crop) URL.revokeObjectURL(crop.url);
    crop = { img, url, s: 1, ox: 0, oy: 0 };
    crop.min = Math.min(containScale(), coverScale()); crop.max = coverScale() * 4;
    $('cropper').hidden = false; centerAt(coverScale());
  } catch { URL.revokeObjectURL(url); toast('Could not read that image.'); $('f-image').value = ''; }
};
$('crop-zoom').oninput = e => setScale(crop.min + (crop.max - crop.min) * e.target.value / 100);
$('crop-fill').onclick = () => crop && centerAt(coverScale());
$('crop-fit').onclick = () => crop && centerAt(containScale());
$('crop-cancel').onclick = closeCropper;
let drag = null;
const pt = e => { const r = cc.getBoundingClientRect(); return { x: (e.clientX - r.left) * CW / r.width, y: (e.clientY - r.top) * CH / r.height }; };
cc.addEventListener('pointerdown', e => { if (!crop) return; cc.setPointerCapture(e.pointerId); const p = pt(e); drag = { x: p.x, y: p.y, ox: crop.ox, oy: crop.oy }; });
cc.addEventListener('pointermove', e => { if (!drag) return; const p = pt(e); crop.ox = drag.ox + p.x - drag.x; crop.oy = drag.oy + p.y - drag.y; clampCrop(); drawCrop(); });
['pointerup', 'pointercancel'].forEach(ev => cc.addEventListener(ev, () => { drag = null; }));
cc.addEventListener('wheel', e => { if (!crop) return; e.preventDefault(); const p = pt(e); setScale(crop.s * (e.deltaY < 0 ? 1.08 : 1 / 1.08), p.x, p.y); }, { passive: false });
function applyCrop() {
  const W = Number($('crop-size').value), H = Math.round(W * CH / CW), k = W / CW;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const c = out.getContext('2d'); c.fillStyle = BG; c.fillRect(0, 0, W, H);
  c.drawImage(crop.img, crop.ox * k, crop.oy * k, crop.img.width * crop.s * k, crop.img.height * crop.s * k);
  let q = .86, data = out.toDataURL('image/jpeg', q);
  while (data.length * .75 > 700 * 1024 && q > .4) { q -= .08; data = out.toDataURL('image/jpeg', q); }
  pendingImage = data; previewNode($('f-name').value, pendingImage); closeCropper();
}
$('crop-apply').onclick = applyCrop;
$('f-clear').onclick = () => { closeCropper(); pendingImage = ''; $('f-image').value = ''; previewNode($('f-name').value, ''); };
$('f-cancel').onclick = () => { closeCropper(); dlg.close(); };
$('f-delete').onclick = () => { dlg.close(); removeItem(editing.sid, editing.item); };
$('edit-form').onsubmit = () => {
  if (crop) applyCrop(); // photo still being framed: use the current framing
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

/* ---------- cart & WhatsApp order ---------- */
const CART_KEY = 'oregano-cart', CUST_KEY = 'oregano-customer';
let cart = {}; try { cart = JSON.parse(store.get(CART_KEY) || '{}') || {}; } catch { cart = {}; }
let storeIdx = -1, lastCount = -1;
const itemById = id => { for (const s of data.sections) for (const i of s.items) if (i.id === id) return i; return null; };
const priceOf = i => { const v = String(i.price ?? '').trim(); const n = Number(v); return v !== '' && !isNaN(n) ? n : null; };
const money = n => '$' + n.toFixed(2);
const saveCart = () => store.set(CART_KEY, JSON.stringify(cart));
const cartLines = () => Object.entries(cart).map(([id, q]) => ({ item: itemById(id), q })).filter(l => l.item);
const cartCount = () => cartLines().reduce((n, l) => n + l.q, 0);
const cartTotal = () => cartLines().reduce((n, l) => n + (priceOf(l.item) ?? 0) * l.q, 0);
const hasUnpriced = () => cartLines().some(l => priceOf(l.item) === null);
function setQty(id, q) { q = Math.max(0, Math.min(20, q)); q ? cart[id] = q : delete cart[id]; saveCart(); refreshCart(); }
function waNumber(raw) {
  let s = String(raw || '').trim(); if (!s) return '';
  const plus = s.startsWith('+'); s = s.replace(/\D/g, ''); if (!s) return '';
  if (!plus) { if (s.startsWith('00')) s = s.slice(2); else if (s.startsWith('0')) s = '61' + s.slice(1); }
  return s.length >= 8 && s.length <= 15 ? s : '';
}
const CART_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/><path d="M2 3h3l2.4 12.2a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.6-1.2L21 7H6"/></svg>';
function stepper(id, q) {
  const s = el('div', 'step');
  const m = el('button', null, '−'); m.type = 'button'; m.setAttribute('aria-label', 'Remove one'); m.onclick = e => { e.stopPropagation(); setQty(id, q - 1); };
  const n = el('span', null, String(q));
  const p = el('button', null, '+'); p.type = 'button'; p.setAttribute('aria-label', 'Add one'); p.onclick = e => { e.stopPropagation(); setQty(id, q + 1); };
  s.append(m, n, p); return s;
}
function fillCtl(w, item) {
  const q = cart[item.id] || 0; w.replaceChildren();
  if (!q) {
    const b = el('button', 'add', w.classList.contains('big') ? '+ Add to cart' : '+ Add'); b.type = 'button';
    b.setAttribute('aria-label', 'Add ' + item.name + ' to cart'); b.onclick = e => { e.stopPropagation(); setQty(item.id, 1); };
    w.append(b);
  } else w.append(stepper(item.id, q));
}
function cartControl(item, big) {
  const w = el('div', 'cartctl' + (big ? ' big' : '')); w.dataset.id = item.id;
  w.onclick = e => e.stopPropagation(); fillCtl(w, item); return w;
}
function refreshCart() {
  if (!data || !ORDERING) return;
  for (const id of Object.keys(cart)) if (!itemById(id)) delete cart[id];
  document.querySelectorAll('.cartctl').forEach(w => { const it = itemById(w.dataset.id); if (it) fillCtl(w, it); });
  const n = cartCount(), total = cartTotal() ;
  const badge = $('cart-badge'), dc = $('dock-count');
  badge.textContent = dc.textContent = n; badge.hidden = n === 0; dc.hidden = n === 0;
  $('dock-total').textContent = n ? money(total) + (hasUnpriced() ? '+' : '') : 'Cart empty';
  $('dock').classList.toggle('has-items', n > 0);
  if (n !== lastCount && lastCount !== -1) [badge, dc].forEach(b => { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); });
  lastCount = n;
  if (cd.open) renderCartDrawer();
  if (dd.open && dCtx) { const w = $('d-cart').firstChild; const it = dCtx.list[dCtx.idx]; if (w && it) fillCtl(w, it); }
}
const cd = $('cart');
function thumb(item) { const t = el('div', 'th'); t.append(imageNode(item)); return t; }
function showView(v) {
  if (v === 'order' && !cartCount()) v = 'cart';
  $('c-view-cart').hidden = v !== 'cart'; $('c-view-order').hidden = v !== 'order';
  $('c-title').textContent = v === 'cart' ? 'Your cart' : 'Review your order';
  if (v === 'order') buildStores();
  renderCartDrawer();
}
function openCart(view) {
  if (!cd.open) { cd.classList.remove('closing'); cd.showModal(); }
  showView(view);
}
let cClosing = false;
function closeCart() {
  if (cClosing || !cd.open) return; cClosing = true; cd.classList.add('closing');
  setTimeout(() => { cd.close(); cd.classList.remove('closing'); cClosing = false; }, 250);
}
function renderCartDrawer() {
  const lines = cartLines(), n = cartCount();
  const items = $('c-items'); items.replaceChildren();
  if (!lines.length) {
    const e = el('div', 'c-empty'); e.append(el('div', 'c-empty-icon'), el('p', null, 'Your cart is empty.'), el('p', 'muted', 'Tap “+ Add” on any item to start your order.'));
    e.firstChild.innerHTML = CART_ICON; items.append(e);
    if (!$('c-view-order').hidden) showView('cart');
  }
  lines.forEach(({ item, q }) => {
    const row = el('div', 'line'), mid = el('div', 'mid'), p = priceOf(item);
    mid.append(el('div', 'nm', item.name), el('div', 'sub', p === null ? 'Price at store' : money(p) + ' each'));
    const end = el('div', 'end'); end.append(stepper(item.id, q), el('div', 'lt', p === null ? '' : money(p * q)));
    row.append(thumb(item), mid, end); items.append(row);
  });
  const tot = money(cartTotal()) + (hasUnpriced() ? ' +' : '');
  $('c-total').textContent = tot; $('c-total2').textContent = tot;
  $('c-note').hidden = !hasUnpriced();
  $('c-review').disabled = !n; $('c-clear').hidden = !n;
  const sum = $('c-summary'); sum.replaceChildren();
  lines.forEach(({ item, q }) => { const p = priceOf(item), r = el('div', 'srow'); r.append(el('span', null, `${q} × ${item.name}`), el('span', null, p === null ? 'at store' : money(p * q))); sum.append(r); });
}
function buildStores() {
  const box = $('c-stores'); box.replaceChildren();
  const locs = data.about.locations;
  if (storeIdx < 0 || storeIdx >= locs.length) { const saved = Number(store.get('oregano-store')); storeIdx = locs[saved] && waNumber(locs[saved].whatsapp) ? saved : Math.max(0, locs.findIndex(l => waNumber(l.whatsapp))); }
  locs.forEach((l, i) => {
    const ok = !!waNumber(l.whatsapp);
    const b = el('button', 'store' + (i === storeIdx ? ' on' : '') + (ok ? '' : ' off')); b.type = 'button'; b.setAttribute('aria-pressed', i === storeIdx);
    b.append(el('span', 'dot'), (() => { const d = el('span', 'sd'); d.append(el('strong', null, l.name), el('span', null, l.address), ...(ok ? [] : [el('em', null, 'Online ordering not available yet')])); return d; })());
    b.onclick = () => { storeIdx = i; store.set('oregano-store', String(i)); buildStores(); };
    box.append(b);
  });
  $('c-err').textContent = '';
  const c = (() => { try { return JSON.parse(store.get(CUST_KEY) || '{}'); } catch { return {}; } })();
  if (!$('c-name').value && c.name) $('c-name').value = c.name;
}
$('c-view-order').onsubmit = e => {
  e.preventDefault();
  const loc = data.about.locations[storeIdx], num = loc && waNumber(loc.whatsapp), name = $('c-name').value.trim(), notes = $('c-notes').value.trim();
  if (!loc) { $('c-err').textContent = 'Please choose a store.'; return; }
  if (!num) { $('c-err').textContent = loc.name + ' can’t take online orders yet. Please choose another store.'; return; }
  if (!name) { $('c-err').textContent = 'Please enter your name.'; $('c-name').focus(); return; }
  const lines = cartLines().map(({ item, q }) => { const p = priceOf(item); return `${q} × ${item.name} — ${p === null ? 'price at store' : money(p * q)}`; });
  const text = [`*New order — Oregano’s Bakehouse & Cafe*`, `Store: ${loc.name}`, `Name: ${name}`, '', ...lines, '', `*Total: ${money(cartTotal())}${hasUnpriced() ? ' + items priced at store' : ''}*`, ...(notes ? ['', `Notes: ${notes}`] : [])].join('\n');
  store.set(CUST_KEY, JSON.stringify({ name }));
  const url = `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
  const w = window.open(url, '_blank', 'noopener'); if (!w) location.href = url;
  toast('Opening WhatsApp… tap Send there to place your order.');
};
$('c-review').onclick = () => showView('order');
$('c-back').onclick = () => showView('cart');
$('c-clear').onclick = () => { if (confirm('Remove everything from your cart?')) { cart = {}; saveCart(); refreshCart(); } };
$('c-close').onclick = closeCart;
cd.addEventListener('cancel', e => { e.preventDefault(); closeCart(); });
cd.addEventListener('click', e => { const r = cd.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeCart(); });
$('cart-top').onclick = () => openCart('cart');
$('dock-cart').onclick = () => openCart('cart');
$('dock-order').onclick = () => openCart(cartCount() ? 'order' : 'cart');
document.querySelectorAll('.ci').forEach(e => { e.innerHTML = CART_ICON; });
window.addEventListener('resize', () => document.documentElement.style.setProperty('--ab', admin ? $('adminbar').offsetHeight + 'px' : '0px'));

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
