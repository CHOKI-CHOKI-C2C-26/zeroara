import { getVerifier, handleCors, sendJson, bodyOf, STORE_ERROR } from '../../server/lib/vercel.mjs';

/** POST /api/verify/init — create a verification session. */
export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Use POST.' });
  const verifier = getVerifier(req);
  if (!verifier) return sendJson(res, 503, { ok: false, error: STORE_ERROR });
  try {
    const [code, out] = await verifier.init(bodyOf(req));
    sendJson(res, code, out);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || 'init failed' });
  }
}
