#!/usr/bin/env node
/**
 * Zeroara reference Verifier API — standalone Node server (in-memory sessions,
 * server-sent events). The same logic runs on Vercel via api/verify/* with an
 * Upstash Redis store. See server/README.md.
 *
 *   node server/verifier-api.mjs      (PORT, PUBLIC_URL, ZEROARA_WEB, SESSION_TTL_MS)
 */
import http from 'node:http';
import { createVerifier, memoryStore, DEFAULT_TTL_MS } from './lib/verifier-core.mjs';

const PORT = Number(process.env.PORT || 8787);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const ZEROARA_WEB = (process.env.ZEROARA_WEB || 'http://localhost:1420').replace(/\/+$/, '');
const TTL_MS = Number(process.env.SESSION_TTL_MS || DEFAULT_TTL_MS);
const MAX_BODY = 25 * 1024 * 1024;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const listeners = new Map(); // requestId -> Set<res> (SSE)
const store = memoryStore();
const verifier = createVerifier({
  store,
  publicUrl: PUBLIC_URL,
  zeroaraWeb: ZEROARA_WEB,
  ttlMs: TTL_MS,
  log,
  onChange: (s) => {
    const set = listeners.get(s.requestId);
    if (!set) return;
    const payload = `event: status\ndata: ${JSON.stringify(verifier.view(s))}\n\n`;
    for (const res of set) { try { res.write(payload); } catch { /* gone */ } }
  },
});

const cors = () => ({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept', 'Access-Control-Max-Age': '600' });
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), ...cors() });
  res.end(payload);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL);
  if (req.method === 'OPTIONS') { res.writeHead(204, cors()); res.end(); return; }
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return json(res, 200, { service: 'zeroara-verifier-api', store: store.kind, endpoints: ['POST /api/verify/init', 'POST /api/verify/callback', 'GET /api/verify/status/:id', 'GET /api/verify/events/:id', 'GET /api/verify/redacted/:id'], zeroaraWeb: ZEROARA_WEB });
    }
    if (req.method === 'POST' && url.pathname === '/api/verify/init') {
      const [code, out] = await verifier.init(JSON.parse((await readBody(req)) || '{}'));
      return json(res, code, out);
    }
    if (req.method === 'POST' && url.pathname === '/api/verify/callback') {
      const [code, out] = await verifier.callback(JSON.parse((await readBody(req)) || '{}'));
      return json(res, code, out);
    }
    let m = url.pathname.match(/^\/api\/verify\/status\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'GET' && m) { const [code, out] = await verifier.status(m[1]); return json(res, code, out); }
    m = url.pathname.match(/^\/api\/verify\/events\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'GET' && m) {
      const s = await verifier.load(m[1]);
      if (!s) return json(res, 404, { ok: false, error: 'Unknown requestId.' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...cors() });
      res.write(`event: status\ndata: ${JSON.stringify(verifier.view(s))}\n\n`);
      if (!listeners.has(s.requestId)) listeners.set(s.requestId, new Set());
      listeners.get(s.requestId).add(res);
      const beat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
      req.on('close', () => { clearInterval(beat); listeners.get(s.requestId)?.delete(res); });
      return;
    }
    m = url.pathname.match(/^\/api\/verify\/redacted\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'GET' && m) {
      const pdf = await verifier.redacted(m[1]);
      if (!pdf) return json(res, 404, { ok: false, error: 'No redacted PDF for this session.' });
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Content-Disposition': `inline; filename="${m[1]}_REDACTED.pdf"`, ...cors() });
      res.end(pdf);
      return;
    }
    json(res, 404, { ok: false, error: 'Not found.' });
  } catch (err) {
    json(res, 400, { ok: false, error: err.message || 'Bad request.' });
  }
});

setInterval(() => store.sweep(60 * 60 * 1000), 60 * 1000).unref();
server.listen(PORT, () => log(`Zeroara verifier API listening on ${PUBLIC_URL} (Zeroara web: ${ZEROARA_WEB}, store: memory)`));
