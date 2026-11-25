(() => {
const $ = id => document.getElementById(id);
const host = location.hostname.endsWith('.github.io');
const REPO = {
  owner: host ? location.hostname.split('.')[0] : 'kisshan2202',
  name: host ? (location.pathname.split('/')[1] || 'oregano') : 'oregano',
  branch: 'main'
};
const LS = { token: 'oregano-token', draft: 'oregano-draft' };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

let data = null;        // live data (published or draft)
let admin = false;
let dirty = false;
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
function render() {
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
  if (!store.set(LS.draft, JSON.stringify(data))) toast('Draft too large to save locally — publish soon.');
  render();
}
const sectionOf = id => data.sections.find(s => s.id === id);
function removeItem(sid, item) {
  if (!confirm(`Delete "${item.name}"?`)) return;
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
    if (pendingImage !== undefined) editing.item.image = pendingImage;
  } else s.items.push({ id: uid(), ...vals, image: pendingImage || '' });
  markDirty();
};

/* ---------- GitHub publishing ---------- */
const api = (path, opts = {}) => fetch(`https://api.github.com/repos/${REPO.owner}/${REPO.name}/${path}`, {
  ...opts, headers: { Authorization: 'Bearer ' + store.get(LS.token), Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
});
const b64 = s => btoa(unescape(encodeURIComponent(s)));
async function putFile(path, content, base64, message) {
  let sha; const g = await api(`contents/${path}?ref=${REPO.branch}`);
  if (g.ok) sha = (await g.json()).sha; else if (g.status !== 404) throw new Error('Could not read ' + path + ' (' + g.status + ')');
  const r = await api(`contents/${path}`, { method: 'PUT', body: JSON.stringify({ message, content: base64 ? content : b64(content), branch: REPO.branch, ...(sha && { sha }) }) });
  if (!r.ok) throw new Error('Could not write ' + path + ' (' + r.status + ')');
}
async function publish() {
  const btn = $('btn-publish'); btn.disabled = true; btn.textContent = 'Publishing…';
  try {
    const out = JSON.parse(JSON.stringify(data));
    for (const s of out.sections) for (const i of s.items) {
      if (i.image.startsWith('data:')) {
        const path = `images/items/${i.id}-${Date.now().toString(36)}.jpg`;
        await putFile(path, i.image.split(',')[1], true, `Add image for ${i.name}`);
        i.image = path;
      }
    }
    out.updated = new Date().toLocaleString('en-AU', { month: 'long', year: 'numeric' });
    await putFile('menu.json', JSON.stringify(out, null, 1) + '\n', false, 'Update menu');
    data = out; dirty = false; store.del(LS.draft);
    toast('Published! The live site updates in about a minute.');
  } catch (e) { toast('Publish failed: ' + e.message); }
  btn.textContent = 'Publish'; render();
}
$('btn-publish').onclick = publish;
$('btn-discard').onclick = async () => {
  if (!confirm('Discard all unpublished changes?')) return;
  store.del(LS.draft); dirty = false; await load(true);
};

/* ---------- admin sign-in ---------- */
const login = $('login');
async function verify(token) {
  const r = await fetch(`https://api.github.com/repos/${REPO.owner}/${REPO.name}`, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error(r.status === 401 ? 'Token not accepted.' : 'Could not reach the repository (' + r.status + ').');
  if (!(await r.json()).permissions?.push) throw new Error('This token cannot write to the repository.');
}
// Password gate. Only a salted PBKDF2 hash is stored here, never the password itself.
// Note: this is a convenience lock for the admin screen; real write access is the GitHub token.
const PW = { salt: '2cf4f6079230a93f8db0b862638f331f', hash: '1d27ae48486eda0c017327ec228217cf4aaf2860dfc939f75b9fcc2e0c7ec93d', iter: 150000 };
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const unhex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
async function pwOk(pw) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(PW.salt), iterations: PW.iter }, key, 256);
  return hex(bits) === PW.hash;
}
const unlocked = () => { try { return sessionStorage.getItem('oregano-unlocked') === '1'; } catch { return false; } };
const setUnlocked = v => { try { v ? sessionStorage.setItem('oregano-unlocked', '1') : sessionStorage.removeItem('oregano-unlocked'); } catch {} };
const pwDlg = $('pw');
function enterAdmin() { admin = true; render(); }
function openLogin() {
  if (!unlocked()) { $('pw-err').textContent = ''; $('pw-input').value = ''; return pwDlg.showModal(); }
  if (store.get(LS.token)) return enterAdmin();
  $('login-err').textContent = ''; $('token').value = ''; login.showModal();
}
$('pw-cancel').onclick = () => pwDlg.close();
$('pw-form').onsubmit = async e => {
  e.preventDefault();
  const btn = $('pw-go'); btn.disabled = true;
  let ok = false; try { ok = await pwOk($('pw-input').value); } catch { $('pw-err').textContent = 'This browser cannot check passwords here (needs https).'; btn.disabled = false; return; }
  if (ok) { setUnlocked(true); pwDlg.close(); btn.disabled = false; await load(); openLogin(); }
  else { await new Promise(r => setTimeout(r, 1200)); $('pw-err').textContent = 'Wrong password.'; btn.disabled = false; }
};
$('admin-link').onclick = e => { e.preventDefault(); openLogin(); };
$('login-cancel').onclick = () => login.close();
$('login-form').onsubmit = async e => {
  const t = $('token').value.trim();
  e.preventDefault();
  try { await verify(t); store.set(LS.token, t); login.close(); enterAdmin(); }
  catch (err) { $('login-err').textContent = err.message; }
};
$('btn-logout').onclick = () => {
  if (dirty && !confirm('You have unpublished changes (they stay saved as a draft). Exit anyway?')) return;
  setUnlocked(false); admin = false; load(true);
};

/* ---------- load ---------- */
async function load(ignoreDraft) {
  try {
    const draft = !ignoreDraft && store.get(LS.draft);
    if (draft && store.get(LS.token) && unlocked()) { data = JSON.parse(draft); dirty = true; admin = true; }
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
