#!/usr/bin/env node
/**
 * Zeroara reference Verifier API — the ONLINE side of the protocol.
 *
 *   POST /api/verify/init             create a session: requestId, nonce, callbackUrl, deep link
 *   POST /api/verify/callback         receive the result from the (offline) Zeroara app and verify it
 *   GET  /api/verify/status/:id       poll the session
 *   GET  /api/verify/events/:id       server-sent events for the session
 *   GET  /api/verify/redacted/:id     the redacted PDF, if the user chose to include it
 *
 * Verification on the callback: nonce + requestId match an unexpired PENDING
 * session, the document type matches, the Groth16 proof verifies against the
 * public verification key, its public signals encode a threshold ≥ the claim
 * and the receipt's commitment, the master audit seal recomputes from the
 * receipt, and the redacted-document hash matches (and the PDF, if attached).
 *
 * Zero dependencies beyond snarkjs (resolved from the repository's node_modules).
 * Run:  node server/verifier-api.mjs        (PORT, PUBLIC_URL, ZEROARA_WEB, VKEY_PATH)
 */
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as snarkjs from 'snarkjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const ZEROARA_WEB = (process.env.ZEROARA_WEB || 'http://localhost:1420').replace(/\/+$/, '');
const VKEY_PATH = process.env.VKEY_PATH || path.resolve(__dirname, '../public/zk/verification_key.json');
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 15 * 60 * 1000);
const MAX_BODY = 25 * 1024 * 1024;

const VKEY = JSON.parse(readFileSync(VKEY_PATH, 'utf8'));
const DOCUMENTS = new Set(['aadhaar', 'pan', 'college_id', 'bank_statement', 'salary_slip', 'tax_form', 'income_accredited', 'generic_id', 'generic_financial']);
const SEAL_ONLY_DOCUMENTS = new Set(['pan', 'college_id', 'generic_id']);

/** @type {Map<string, any>} */
const sessions = new Map();

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const nowIso = () => new Date().toISOString();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function base64url(str) {
  return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* Exactly mirrors src/layers/layer5_seal/sealEngine.ts::computeMasterAuditSeal */
function recomputeSeal(docRedactedHash, bboxes, commitment, proof) {
  const bboxSummary = bboxes.map((b) => `${b.id}[x:${b.x},y:${b.y},w:${b.width},h:${b.height}]`).join(';');
  const proofDigest = proof ? sha256(JSON.stringify(proof)) : 'NO_PROOF';
  const commitmentField = commitment || 'NO_COMMITMENT';
  return sha256(`zeroara:seal:v1:doc:${docRedactedHash}:bbox:${bboxSummary}:commit:${commitmentField}:proof:${proofDigest}`);
}

function json(res, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), ...cors(), ...extra });
  res.end(payload);
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '600',
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function publicView(s) {
  return {
    requestId: s.requestId,
    status: s.status,
    document: s.request.document,
    claim: s.request.claim,
    requester: s.request.requester,
    issuedAt: s.issuedAt,
    expiresAt: s.expiresAt,
    updatedAt: s.updatedAt,
    verification: s.verification ?? null,
    reasons: s.reasons ?? [],
    redactedPdfAvailable: !!s.redactedPdf,
    redactedPdfUrl: s.redactedPdf ? `${PUBLIC_URL}/api/verify/redacted/${s.requestId}` : null,
  };
}

function touch(s, patch) {
  Object.assign(s, patch, { updatedAt: nowIso() });
  const view = publicView(s);
  for (const res of s.listeners) {
    try {
      res.write(`event: status\ndata: ${JSON.stringify(view)}\n\n`);
    } catch {
      /* listener gone */
    }
  }
}

function expireIfNeeded(s) {
  if (s.status === 'PENDING' && Date.parse(s.expiresAt) < Date.now()) touch(s, { status: 'EXPIRED', reasons: ['The session expired before a result arrived.'] });
}

/* ------------------------------------------------------------------ init */
function handleInit(body) {
  const document = typeof body.document === 'string' ? body.document : '';
  if (!DOCUMENTS.has(document)) return [400, { ok: false, error: `Unknown document type "${document}".` }];
  let claim = null;
  if (body.claim != null) {
    const c = body.claim;
    if (typeof c !== 'object' || (c.op !== undefined && c.op !== '>=') || typeof c.value !== 'number' || !Number.isFinite(c.value) || c.value < 0) {
      return [400, { ok: false, error: 'claim must be { field?, op: ">=", value: number, unit? }.' }];
    }
    if (SEAL_ONLY_DOCUMENTS.has(document)) return [400, { ok: false, error: `"${document}" is a seal-only document type; it cannot carry a numeric claim.` }];
    claim = { field: typeof c.field === 'string' ? c.field.slice(0, 64) : undefined, op: '>=', value: Math.floor(c.value), unit: typeof c.unit === 'string' ? c.unit.slice(0, 16) : undefined };
  }
  const requestId = 'req_' + randomBytes(6).toString('hex');
  const nonce = '0x' + randomBytes(24).toString('hex');
  const issuedAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const request = {
    version: 1,
    requestId,
    requester: typeof body.requester === 'string' && body.requester.trim() ? body.requester.trim().slice(0, 80) : 'Relying party',
    purpose: typeof body.purpose === 'string' ? body.purpose.slice(0, 200) : '',
    document,
    claim,
    nonce,
    issuedAt,
    expiresAt,
    callbackUrl: `${PUBLIC_URL}/api/verify/callback`,
    wantRedactedPdf: body.wantRedactedPdf === true,
  };
  const session = { requestId, nonce, issuedAt, expiresAt, request, status: 'PENDING', updatedAt: issuedAt, listeners: new Set(), verification: null, reasons: [], redactedPdf: null };
  sessions.set(requestId, session);
  const encoded = base64url(JSON.stringify(request));
  log('init', requestId, document, claim ? `${claim.field ?? 'value'} >= ${claim.value}` : 'seal-only', 'for', request.requester);
  return [
    201,
    {
      ok: true,
      requestId,
      nonce,
      issuedAt,
      expiresAt,
      callbackUrl: request.callbackUrl,
      request,
      deepLink: `zeroara://verify?request=${encoded}`,
      webFallbackUrl: `${ZEROARA_WEB}/?request=${encoded}`,
      statusUrl: `${PUBLIC_URL}/api/verify/status/${requestId}`,
      eventsUrl: `${PUBLIC_URL}/api/verify/events/${requestId}`,
    },
  ];
}

/* -------------------------------------------------------------- callback */
async function handleCallback(body) {
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  const s = sessions.get(requestId);
  if (!s) return [404, { ok: false, error: 'Unknown requestId.' }];
  expireIfNeeded(s);
  if (s.status !== 'PENDING') return [409, { ok: false, status: s.status, error: `Session is ${s.status}; results are accepted once.` }];
  if (body.nonce !== s.nonce) {
    touch(s, { status: 'FAILED', reasons: ['Challenge nonce mismatch (replay or wrong session).'] });
    return [400, { ok: false, status: 'FAILED', reasons: s.reasons }];
  }

  const status = body.status;
  if (status === 'DECLINED') {
    touch(s, { status: 'DECLINED', reasons: ['The user declined the request.'] });
    log('callback', requestId, 'DECLINED');
    return [200, { ok: true, status: 'DECLINED', message: 'Declined recorded.' }];
  }
  if (status === 'FAILED') {
    touch(s, { status: 'FAILED', reasons: [typeof body.reason === 'string' ? body.reason : 'The claim was not satisfied.'] });
    log('callback', requestId, 'FAILED');
    return [200, { ok: true, status: 'FAILED', message: 'Failure recorded.' }];
  }
  if (status !== 'VERIFIED') return [400, { ok: false, error: 'status must be VERIFIED, FAILED or DECLINED.' }];

  const reasons = [];
  const receipt = body.receipt;
  const claim = s.request.claim;
  if (!receipt || typeof receipt !== 'object' || !receipt.masterAuditSeal || !receipt.sanitizedDocument) reasons.push('Receipt (audit package) missing.');
  if (body.document !== s.request.document || (receipt && receipt.scenario?.id !== s.request.document)) reasons.push('Document type does not match the request.');
  if (receipt && receipt.enterpriseRequirement?.challengeNonce !== s.nonce) reasons.push('The receipt was sealed for a different nonce.');

  let proofValid = false;
  let sealValid = false;
  let thresholdOk = !claim;
  let pdfHashOk = true;
  let verifyMs = 0;

  if (reasons.length === 0) {
    const zk = receipt.zeroKnowledgeProof;
    const bboxes = receipt.sanitizedDocument.burnedBoundingBoxes;
    if (!Array.isArray(bboxes) || bboxes.length === 0) reasons.push('No redaction geometry in the receipt.');

    if (claim) {
      if (receipt.redactionMode !== 'PROOF_BACKED' || !zk || !body.proof) reasons.push('A numeric claim was requested but the receipt carries no zero-knowledge proof.');
      else {
        const t0 = Date.now();
        try {
          proofValid = await snarkjs.groth16.verify(VKEY, body.proof.publicSignals, body.proof);
        } catch {
          proofValid = false;
        }
        verifyMs = Date.now() - t0;
        if (!proofValid) reasons.push('The Groth16 proof does not verify.');
        // income_threshold public signals: [thresholdValue, expectedCommitment]
        const [thresholdSignal, commitmentSignal] = body.proof.publicSignals ?? [];
        const proven = Number(thresholdSignal);
        thresholdOk = Number.isFinite(proven) && proven >= claim.value && Number(receipt.enterpriseRequirement.thresholdValue) === proven;
        if (!thresholdOk) reasons.push(`The proven threshold (${thresholdSignal}) does not cover the requested ${claim.value}.`);
        if (commitmentSignal !== zk.poseidonCommitment || (body.commitment && body.commitment !== zk.poseidonCommitment)) reasons.push('The proof is not bound to the receipt\'s commitment.');
        if (JSON.stringify({ ...body.proof, publicSignals: undefined }) !== JSON.stringify({ ...zk.proof, publicSignals: undefined })) reasons.push('The proof in the payload differs from the one sealed in the receipt.');
      }
    } else if (receipt.zeroKnowledgeProof) {
      proofValid = true; // extra proof on a seal-only request is harmless but unused
    } else {
      proofValid = true;
    }

    if (Array.isArray(bboxes) && bboxes.length > 0) {
      const recomputed = recomputeSeal(receipt.sanitizedDocument.preimageSha256, bboxes, zk?.poseidonCommitment ?? '', zk?.proof ?? null);
      sealValid = recomputed.toLowerCase() === String(receipt.masterAuditSeal.sealHex).toLowerCase() && body.masterAuditSeal === receipt.masterAuditSeal.sealHex;
      if (!sealValid) reasons.push('The master audit seal does not recompute from the receipt.');
    }

    if (body.redactedDocumentSha256 !== receipt.sanitizedDocument.preimageSha256) reasons.push('Redacted-document hash mismatch between payload and receipt.');
    if (typeof body.redactedPdfBase64 === 'string' && body.redactedPdfBase64.length > 0) {
      const pdf = Buffer.from(body.redactedPdfBase64, 'base64');
      pdfHashOk = sha256(pdf) === body.redactedDocumentSha256;
      if (!pdfHashOk) reasons.push('The attached PDF does not hash to the sealed redacted-document fingerprint.');
      else s.redactedPdf = pdf;
    }
  }

  if (reasons.length > 0) {
    touch(s, { status: 'FAILED', reasons });
    log('callback', requestId, 'FAILED:', reasons.join(' | '));
    return [422, { ok: false, status: 'FAILED', reasons }];
  }

  const verification = {
    verifiedAt: nowIso(),
    claim,
    document: s.request.document,
    redactionMode: receipt.redactionMode,
    proofVerified: proofValid,
    proofVerifyMs: verifyMs,
    sealValid,
    masterAuditSeal: receipt.masterAuditSeal.sealHex,
    redactedDocumentSha256: receipt.sanitizedDocument.preimageSha256,
    burnedZones: receipt.sanitizedDocument.burnedBoundingBoxes.length,
    redactedFields: (receipt.redactedFields ?? []).map((f) => f.label),
    confidentialBytesReceived: 0,
  };
  touch(s, { status: 'VERIFIED', verification, reasons: [] });
  log('callback', requestId, 'VERIFIED · proof', verifyMs + 'ms · seal ok');
  return [200, { ok: true, status: 'VERIFIED', message: 'Verified: proof, seal and nonce all check out.', verification }];
}

/* ---------------------------------------------------------------- server */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors());
    res.end();
    return;
  }
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return json(res, 200, { service: 'zeroara-verifier-api', endpoints: ['POST /api/verify/init', 'POST /api/verify/callback', 'GET /api/verify/status/:id', 'GET /api/verify/events/:id', 'GET /api/verify/redacted/:id'], zeroaraWeb: ZEROARA_WEB });
    }
    if (req.method === 'POST' && url.pathname === '/api/verify/init') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const [code, out] = handleInit(body);
      return json(res, code, out);
    }
    if (req.method === 'POST' && url.pathname === '/api/verify/callback') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const [code, out] = await handleCallback(body);
      return json(res, code, out);
    }
    let m = url.pathname.match(/^\/api\/verify\/status\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'GET' && m) {
      const s = sessions.get(m[1]);
      if (!s) return json(res, 404, { ok: false, error: 'Unknown requestId.' });
      expireIfNeeded(s);
      return json(res, 200, { ok: true, ...publicView(s) });
    }
    m = url.pathname.match(/^\/api\/verify\/events\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'GET' && m) {
      const s = sessions.get(m[1]);
      if (!s) return json(res, 404, { ok: false, error: 'Unknown requestId.' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...cors() });
      res.write(`event: status\ndata: ${JSON.stringify(publicView(s))}\n\n`);
      s.listeners.add(res);
      const beat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
      req.on('close', () => {
        clearInterval(beat);
        s.listeners.delete(res);
      });
      return;
    }
    m = url.pathname.match(/^\/api\/verify\/redacted\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'GET' && m) {
      const s = sessions.get(m[1]);
      if (!s || !s.redactedPdf) return json(res, 404, { ok: false, error: 'No redacted PDF for this session.' });
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': s.redactedPdf.length, 'Content-Disposition': `inline; filename="${s.requestId}_REDACTED.pdf"`, ...cors() });
      res.end(s.redactedPdf);
      return;
    }
    json(res, 404, { ok: false, error: 'Not found.' });
  } catch (err) {
    json(res, 400, { ok: false, error: err.message || 'Bad request.' });
  }
});

setInterval(() => {
  for (const s of sessions.values()) expireIfNeeded(s);
  for (const [id, s] of sessions) if (Date.parse(s.expiresAt) + 60 * 60 * 1000 < Date.now()) sessions.delete(id);
}, 60 * 1000).unref();

server.listen(PORT, () => log(`Zeroara verifier API listening on ${PUBLIC_URL} (Zeroara web: ${ZEROARA_WEB})`));
