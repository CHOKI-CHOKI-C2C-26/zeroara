import { handleCors, sendJson } from '../../../server/lib/vercel.mjs';

/**
 * GET /api/verify/events/:id — server-sent events are not available on
 * serverless functions; answer 501 so the SDK switches to polling /status.
 */
export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  sendJson(res, 501, { ok: false, error: 'Server-sent events are not available on this deployment; poll /api/verify/status/:id instead.' });
}
