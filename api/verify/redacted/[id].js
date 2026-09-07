import { getVerifier, handleCors, sendJson, STORE_ERROR } from '../../../server/lib/vercel.mjs';

/** GET /api/verify/redacted/:id — the redacted PDF the user chose to include. */
export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'Use GET.' });
  const verifier = getVerifier(req);
  if (!verifier) return sendJson(res, 503, { ok: false, error: STORE_ERROR });
  const id = String((Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id) ?? '');
  const pdf = await verifier.redacted(id);
  if (!pdf) return sendJson(res, 404, { ok: false, error: 'No redacted PDF for this session.' });
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${id}_REDACTED.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(pdf);
}
