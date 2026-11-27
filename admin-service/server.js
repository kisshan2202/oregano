'use strict';
// Oregano admin service: checks the admin password, then commits menu/image changes to GitHub.
// The GitHub token and admin password only ever exist here (as Secret Manager env vars), never in the browser.
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const { GITHUB_TOKEN, ADMIN_PASSWORD } = process.env;
const OWNER = process.env.GITHUB_OWNER || 'kisshan2202';
const REPO = process.env.GITHUB_REPO || 'oregano';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const API = process.env.GITHUB_API || 'https://api.github.com';
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 8);

if (!GITHUB_TOKEN || !ADMIN_PASSWORD) { console.error('GITHUB_TOKEN and ADMIN_PASSWORD must be set.'); process.exit(1); }

const sha256 = s => crypto.createHash('sha256').update(s).digest();
const KEY = sha256('oregano|' + GITHUB_TOKEN + '|' + ADMIN_PASSWORD);
const PASS_HASH = sha256(ADMIN_PASSWORD);
const PATH_RE = /^images\/items\/[a-z0-9][a-z0-9._-]{0,80}\.jpg$/;
const MAX_BODY = 12 * 1024 * 1024, MAX_IMAGE = 800 * 1024;

/* ---- sessions: signed, expiring tokens (no database needed) ---- */
const b64u = b => Buffer.from(b).toString('base64url');
function makeSession() {
  const p = b64u(JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600e3 }));
  return p + '.' + crypto.createHmac('sha256', KEY).update(p).digest('base64url');
}
function checkSession(tok) {
  if (!tok || !tok.includes('.')) return false;
  const [p, sig] = tok.split('.');
  const good = crypto.createHmac('sha256', KEY).update(p).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try { return JSON.parse(Buffer.from(p, 'base64url')).exp > Date.now(); } catch { return false; }
}

/* ---- brute-force guard (per instance, best effort) ---- */
const fails = new Map();
function lockedOut(ip) { const f = fails.get(ip); return f && f.n >= 5 && f.until > Date.now(); }
function noteFail(ip) { const f = fails.get(ip) || { n: 0 }; f.n++; f.until = Date.now() + 15 * 60e3; fails.set(ip, f); }

/* ---- helpers ---- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, 'Request too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new HttpError(400, 'Invalid JSON.')); } });
    req.on('error', reject);
  });
}
async function gh(method, path, body) {
  const r = await fetch(`${API}/repos/${OWNER}/${REPO}${path}`, {
    method,
    headers: { Authorization: 'Bearer ' + GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'oregano-admin', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  if (!r.ok) { console.error('GitHub', method, path, r.status, text.slice(0, 300)); throw new HttpError(r.status === 422 && method === 'PATCH' ? 409 : 502, r.status === 422 && method === 'PATCH' ? 'The menu changed elsewhere. Reload and try again.' : 'GitHub request failed (' + r.status + ').'); }
  return text ? JSON.parse(text) : {};
}

/* ---- validation ---- */
function validate(body) {
  const { menu, images = [], deletes = [] } = body;
  if (!menu || !Array.isArray(menu.sections) || menu.sections.length > 20) throw new HttpError(400, 'Invalid menu.');
  for (const s of menu.sections) {
    if (typeof s.id !== 'string' || typeof s.title !== 'string' || !Array.isArray(s.items) || s.items.length > 500) throw new HttpError(400, 'Invalid section.');
    for (const i of s.items) {
      if (typeof i.id !== 'string' || typeof i.name !== 'string' || !i.name.trim()) throw new HttpError(400, 'Every item needs a name.');
      if (i.image && !PATH_RE.test(i.image)) throw new HttpError(400, 'Invalid image path for ' + i.name + '.');
    }
  }
  if (JSON.stringify(menu).length > 1e6) throw new HttpError(400, 'Menu is too large.');
  if (!Array.isArray(images) || images.length > 60 || !Array.isArray(deletes) || deletes.length > 300) throw new HttpError(400, 'Too many files.');
  const bufs = images.map(im => {
    if (!im || !PATH_RE.test(im.path) || typeof im.data !== 'string') throw new HttpError(400, 'Invalid image.');
    const buf = Buffer.from(im.data, 'base64');
    if (buf.length > MAX_IMAGE) throw new HttpError(400, 'Image too large (max 800 KB).');
    if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) throw new HttpError(400, 'Images must be JPEG.');
    return { path: im.path, data: im.data };
  });
  for (const d of deletes) if (!PATH_RE.test(d)) throw new HttpError(400, 'Invalid delete path.');
  return { menu, images: bufs, deletes };
}

/* ---- one atomic commit: menu.json + new images - removed images ---- */
async function publish(body) {
  const { menu, images, deletes } = validate(body);
  const keep = new Set(menu.sections.flatMap(s => s.items.map(i => i.image)).filter(Boolean));
  menu.updated = new Date().toLocaleString('en-AU', { month: 'long', year: 'numeric', timeZone: 'Australia/Melbourne' });

  const ref = await gh('GET', `/git/ref/heads/${BRANCH}`);
  const head = ref.object.sha;
  const commit = await gh('GET', `/git/commits/${head}`);
  const base = commit.tree.sha;
  const tree = [{ path: 'menu.json', mode: '100644', type: 'blob', content: JSON.stringify(menu, null, 1) + '\n' }];

  for (const im of images) {
    const blob = await gh('POST', '/git/blobs', { content: im.data, encoding: 'base64' });
    tree.push({ path: im.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  if (deletes.length) {
    const existing = new Set((await gh('GET', `/git/trees/${base}?recursive=1`)).tree.map(t => t.path));
    for (const d of deletes) if (existing.has(d) && !keep.has(d) && !images.some(i => i.path === d)) tree.push({ path: d, mode: '100644', type: 'blob', sha: null });
  }
  const newTree = await gh('POST', '/git/trees', { base_tree: base, tree });
  const msg = `Update menu via admin (${images.length} new image${images.length === 1 ? '' : 's'}, ${tree.filter(t => t.sha === null).length} removed)`;
  const nc = await gh('POST', '/git/commits', { message: msg, tree: newTree.sha, parents: [head] });
  await gh('PATCH', `/git/refs/heads/${BRANCH}`, { sha: nc.sha });
  return { ok: true, commit: nc.sha, updated: menu.updated };
}

/* ---- server ---- */
const handle = async (req, res) => {
  const origin = req.headers.origin;
  const allowed = origin && (ORIGINS.includes('*') || ORIGINS.includes(origin));
  const send = (status, obj) => {
    const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    if (allowed) { h['Access-Control-Allow-Origin'] = origin; h['Vary'] = 'Origin'; }
    res.writeHead(status, h); res.end(JSON.stringify(obj));
  };
  try {
    if (req.method === 'OPTIONS') {
      const h = { 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' };
      if (allowed) { h['Access-Control-Allow-Origin'] = origin; h['Vary'] = 'Origin'; }
      res.writeHead(204, h); return res.end();
    }
    const path = new URL(req.url, 'http://x').pathname;
    if (req.method === 'GET' && (path === '/' || path === '/health')) return send(200, { ok: true });
    if (req.method !== 'POST') return send(404, { error: 'Not found.' });
    if (ORIGINS.length && origin && !allowed) return send(403, { error: 'Origin not allowed.' });

    if (path === '/login') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (lockedOut(ip)) return send(429, { error: 'Too many attempts. Try again in 15 minutes.' });
      const { password } = await readBody(req);
      const ok = typeof password === 'string' && crypto.timingSafeEqual(sha256(password), PASS_HASH);
      if (!ok) { noteFail(ip); await new Promise(r => setTimeout(r, 800)); return send(401, { error: 'Wrong password.' }); }
      fails.delete(ip);
      return send(200, { token: makeSession(), hours: SESSION_HOURS });
    }
    if (path === '/publish') {
      if (!checkSession((req.headers.authorization || '').replace(/^Bearer /, ''))) return send(401, { error: 'Session expired. Please sign in again.' });
      return send(200, await publish(await readBody(req)));
    }
    return send(404, { error: 'Not found.' });
  } catch (e) {
    if (e instanceof HttpError) return send(e.status, { error: e.message });
    console.error(e); return send(500, { error: 'Server error.' });
  }
};
module.exports = { handle };
if (require.main === module) http.createServer(handle).listen(PORT, () => console.log('oregano-admin listening on', PORT));
