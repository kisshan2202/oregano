'use strict';
// One Cloud Run service for the whole site:
//  - serves the public website files (only an allow-list, never the repo's other files)
//  - serves the admin API at /api/* (login + publish) when GITHUB_TOKEN and ADMIN_PASSWORD are set
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const api = process.env.GITHUB_TOKEN && process.env.ADMIN_PASSWORD ? require('./admin-service/server.js').handle : null;
if (!api) console.warn('GITHUB_TOKEN / ADMIN_PASSWORD not set: serving the site only, admin API disabled.');

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg']);
const PUBLIC_FILES = new Set(['/index.html', '/styles.css', '/app.js', '/config.js', '/menu.json', '/favicon.ico']);
const isPublic = p => p === '/index.html' || PUBLIC_FILES.has(p) || /^\/images\/[A-Za-z0-9._\/-]+$/.test(p);
const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' };

function send(res, status, headers, body) { res.writeHead(status, { ...SECURITY, ...headers }); res.end(body); }

function serveStatic(req, res) {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(res, 400, {}, 'Bad request'); }
  if (p === '/') p = '/index.html';
  if (p.includes('..') || p.includes('\\') || !isPublic(p)) return send(res, 404, { 'Content-Type': 'text/plain' }, 'Not found');
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 404, { 'Content-Type': 'text/plain' }, 'Not found');
  let st; try { st = fs.statSync(file); if (!st.isFile()) throw 0; } catch { return send(res, 404, { 'Content-Type': 'text/plain' }, 'Not found'); }
  const ext = path.extname(file).toLowerCase();
  let body = fs.readFileSync(file);
  // config.js: tell the page to use the API on this same address
  if (p === '/config.js') body = Buffer.concat([Buffer.from('window.OREGANO_SAME_ORIGIN = true;\n'), body]);
  const etag = '"' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 20) + '"';
  const headers = {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    ETag: etag,
    // pages and scripts are re-checked every time (so edits show immediately); photos are cached for a day
    'Cache-Control': p.startsWith('/images/') ? 'public, max-age=86400' : 'no-cache',
    Vary: 'Accept-Encoding'
  };
  if (req.headers['if-none-match'] === etag) return send(res, 304, headers, '');
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) { body = zlib.gzipSync(body); headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = body.length;
  if (req.method === 'HEAD') return send(res, 200, headers, '');
  send(res, 200, headers, body);
}

http.createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/healthz') return send(res, 200, { 'Content-Type': 'text/plain' }, 'ok');
  if (url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')) {
    if (!api) return send(res, 503, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Admin is not configured on this server.' }));
    req.url = url.slice(4) || '/';
    return api(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { 'Content-Type': 'text/plain', Allow: 'GET, HEAD' }, 'Method not allowed');
  serveStatic(req, res);
}).listen(PORT, () => console.log('oregano site listening on', PORT));
