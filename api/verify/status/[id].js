import { getVerifier, handleCors, sendJson, STORE_ERROR } from '../../../server/lib/vercel.mjs';

/** GET /api/verify/status/:id — poll a session. */
export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'Use GET.' });
  const verifier = getVerifier(req);
  if (!verifier) return sendJson(res, 503, { ok: false, error: STORE_ERROR });
  const id = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  const [code, out] = await verifier.status(String(id ?? ''));
  sendJson(res, code, out);
}
