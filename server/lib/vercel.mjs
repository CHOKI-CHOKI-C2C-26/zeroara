/**
 * Glue for Vercel serverless functions (api/verify/*): picks the session store
 * from the environment and builds the verifier for the request's own origin.
 *
 * Store (required in production): Upstash Redis via the Vercel Marketplace —
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN   (or KV_REST_API_URL + KV_REST_API_TOKEN)
 * Local development only: VERIFIER_STORE=memory (a single process keeps sessions in RAM).
 */
import { createVerifier, memoryStore, upstashStore, DEFAULT_TTL_MS } from './verifier-core.mjs';

export const STORE_ERROR = 'Verifier API store not configured. Add Upstash Redis to the Vercel project and set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (see server/README.md).';

let memory = null;
export function resolveStore(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return upstashStore({ url, token });
  if (env.VERIFIER_STORE === 'memory') return (memory ||= memoryStore());
  return null;
}

export function requestOrigin(req, env = process.env) {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}

export function getVerifier(req, env = process.env) {
  const store = resolveStore(env);
  if (!store) return null;
  const origin = requestOrigin(req, env);
  return createVerifier({
    store,
    publicUrl: origin,
    zeroaraWeb: (env.ZEROARA_WEB || origin).replace(/\/+$/, ''),
    ttlMs: Number(env.SESSION_TTL_MS || DEFAULT_TTL_MS),
    log: (...a) => console.log('[verifier]', ...a),
  });
}

export function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Max-Age', '600');
}

/** Returns true when the request was a preflight that has been answered. */
export function handleCors(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  return false;
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Vercel parses JSON bodies; be tolerant of raw strings too. */
export function bodyOf(req) {
  const b = req.body;
  if (b == null) return {};
  if (typeof b === 'string') { try { return JSON.parse(b || '{}'); } catch { return {}; } }
  if (Buffer.isBuffer(b)) { try { return JSON.parse(b.toString('utf8') || '{}'); } catch { return {}; } }
  return b;
}
