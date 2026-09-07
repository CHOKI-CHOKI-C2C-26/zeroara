/**
 * Verifier core — the online side of the Zeroara protocol, independent of the
 * transport (plain Node server or Vercel serverless functions) and of the
 * session store (memory or Upstash Redis).
 */
import { createHash, randomBytes } from 'node:crypto';
import * as snarkjs from 'snarkjs';
import { VERIFICATION_KEY } from './verification-key.mjs';

export const DOCUMENTS = new Set(['aadhaar', 'pan', 'college_id', 'bank_statement', 'salary_slip', 'tax_form', 'income_accredited', 'generic_id', 'generic_financial']);
export const SEAL_ONLY_DOCUMENTS = new Set(['pan', 'college_id', 'generic_id']);
export const DEFAULT_TTL_MS = 15 * 60 * 1000;
/** Largest redacted PDF kept for the relying party (Upstash free tier caps requests at 1 MB). */
export const MAX_STORED_PDF_BYTES = 700 * 1024;

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const nowIso = () => new Date().toISOString();

export function base64url(str) {
  return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* Exactly mirrors src/layers/layer5_seal/sealEngine.ts::computeMasterAuditSeal */
export function recomputeSeal(docRedactedHash, bboxes, commitment, proof) {
  const bboxSummary = bboxes.map((b) => `${b.id}[x:${b.x},y:${b.y},w:${b.width},h:${b.height}]`).join(';');
  const proofDigest = proof ? sha256(JSON.stringify(proof)) : 'NO_PROOF';
  const commitmentField = commitment || 'NO_COMMITMENT';
  return sha256(`zeroara:seal:v1:doc:${docRedactedHash}:bbox:${bboxSummary}:commit:${commitmentField}:proof:${proofDigest}`);
}

/* ----------------------------------------------------------------- stores */

/** In-memory store: for the standalone Node server and local tests only. */
export function memoryStore() {
  const sessions = new Map();
  const pdfs = new Map();
  return {
    kind: 'memory',
    async get(id) { return sessions.get(id) ?? null; },
    async set(id, session) { sessions.set(id, session); },
    async setPdf(id, buf) { pdfs.set(id, buf); },
    async getPdf(id) { return pdfs.get(id) ?? null; },
    async sweep(olderThanMs) {
      const cutoff = Date.now() - olderThanMs;
      for (const [id, s] of sessions) if (Date.parse(s.expiresAt) < cutoff) { sessions.delete(id); pdfs.delete(id); }
    },
    sessions,
  };
}

/** Upstash Redis over its REST API (works from serverless functions, zero dependencies). */
export function upstashStore({ url, token }) {
  const base = url.replace(/\/+$/, '');
  async function call(cmd) {
    const r = await fetch(base, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(`Upstash ${cmd[0]} failed: ${j.error || r.status}`);
    return j.result;
  }
  return {
    kind: 'upstash',
    async get(id) { const v = await call(['GET', `zeroara:session:${id}`]); return v ? JSON.parse(v) : null; },
    async set(id, session, ttlSeconds) { await call(['SET', `zeroara:session:${id}`, JSON.stringify(session), 'EX', String(ttlSeconds)]); },
    async setPdf(id, buf, ttlSeconds) { await call(['SET', `zeroara:pdf:${id}`, buf.toString('base64'), 'EX', String(ttlSeconds)]); },
    async getPdf(id) { const v = await call(['GET', `zeroara:pdf:${id}`]); return v ? Buffer.from(v, 'base64') : null; },
    async sweep() { /* Redis TTLs handle expiry */ },
  };
}

/* ------------------------------------------------------------------ core */

export function createVerifier({ store, publicUrl, zeroaraWeb, ttlMs = DEFAULT_TTL_MS, log = () => {}, onChange = () => {} }) {
  const base = publicUrl.replace(/\/+$/, '');
  const web = (zeroaraWeb || base).replace(/\/+$/, '');
  const keepSeconds = Math.ceil(ttlMs / 1000) + 60 * 60; // keep the record an hour past expiry for polling

  function view(s) {
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
      redactedPdfAvailable: !!s.redactedPdfAvailable,
      redactedPdfUrl: s.redactedPdfAvailable ? `${base}/api/verify/redacted/${s.requestId}` : null,
    };
  }

  async function save(s, patch) {
    Object.assign(s, patch, { updatedAt: nowIso() });
    await store.set(s.requestId, s, keepSeconds);
    onChange(s);
    return s;
  }

  async function load(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(id)) return null;
    const s = await store.get(id);
    if (!s) return null;
    if (s.status === 'PENDING' && Date.parse(s.expiresAt) < Date.now()) await save(s, { status: 'EXPIRED', reasons: ['The session expired before a result arrived.'] });
    return s;
  }

  async function init(body) {
    body = body && typeof body === 'object' ? body : {};
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
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
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
      callbackUrl: `${base}/api/verify/callback`,
      wantRedactedPdf: body.wantRedactedPdf === true,
    };
    const session = { requestId, nonce, issuedAt, expiresAt, request, status: 'PENDING', updatedAt: issuedAt, verification: null, reasons: [], redactedPdfAvailable: false };
    await store.set(requestId, session, keepSeconds);
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
        webFallbackUrl: `${web}/?request=${encoded}`,
        statusUrl: `${base}/api/verify/status/${requestId}`,
        eventsUrl: `${base}/api/verify/events/${requestId}`,
      },
    ];
  }

  async function callback(body) {
    body = body && typeof body === 'object' ? body : {};
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const s = await load(requestId);
    if (!s) return [404, { ok: false, error: 'Unknown requestId.' }];
    if (s.status !== 'PENDING') return [409, { ok: false, status: s.status, error: `Session is ${s.status}; results are accepted once.` }];
    if (body.nonce !== s.nonce) {
      await save(s, { status: 'FAILED', reasons: ['Challenge nonce mismatch (replay or wrong session).'] });
      return [400, { ok: false, status: 'FAILED', reasons: s.reasons }];
    }

    const status = body.status;
    if (status === 'DECLINED') {
      await save(s, { status: 'DECLINED', reasons: ['The user declined the request.'] });
      log('callback', requestId, 'DECLINED');
      return [200, { ok: true, status: 'DECLINED', message: 'Declined recorded.' }];
    }
    if (status === 'FAILED') {
      await save(s, { status: 'FAILED', reasons: [typeof body.reason === 'string' ? body.reason : 'The claim was not satisfied.'] });
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
    let verifyMs = 0;
    let pdf = null;

    if (reasons.length === 0) {
      const zk = receipt.zeroKnowledgeProof;
      const bboxes = receipt.sanitizedDocument.burnedBoundingBoxes;
      if (!Array.isArray(bboxes) || bboxes.length === 0) reasons.push('No redaction geometry in the receipt.');

      if (claim) {
        if (receipt.redactionMode !== 'PROOF_BACKED' || !zk || !body.proof) reasons.push('A numeric claim was requested but the receipt carries no zero-knowledge proof.');
        else {
          const t0 = Date.now();
          try {
            proofValid = await snarkjs.groth16.verify(VERIFICATION_KEY, body.proof.publicSignals, body.proof);
          } catch {
            proofValid = false;
          }
          verifyMs = Date.now() - t0;
          if (!proofValid) reasons.push('The Groth16 proof does not verify.');
          // income_threshold public signals: [thresholdValue, expectedCommitment]
          const [thresholdSignal, commitmentSignal] = body.proof.publicSignals ?? [];
          const proven = Number(thresholdSignal);
          const thresholdOk = Number.isFinite(proven) && proven >= claim.value && Number(receipt.enterpriseRequirement.thresholdValue) === proven;
          if (!thresholdOk) reasons.push(`The proven threshold (${thresholdSignal}) does not cover the requested ${claim.value}.`);
          if (commitmentSignal !== zk.poseidonCommitment || (body.commitment && body.commitment !== zk.poseidonCommitment)) reasons.push("The proof is not bound to the receipt's commitment.");
          const strip = (p) => JSON.stringify({ pi_a: p.pi_a, pi_b: p.pi_b, pi_c: p.pi_c, protocol: p.protocol, curve: p.curve });
          if (strip(body.proof) !== strip(zk.proof)) reasons.push('The proof in the payload differs from the one sealed in the receipt.');
        }
      } else {
        proofValid = true; // seal-only request: no numeric proof expected
      }

      if (Array.isArray(bboxes) && bboxes.length > 0) {
        const recomputed = recomputeSeal(receipt.sanitizedDocument.preimageSha256, bboxes, zk?.poseidonCommitment ?? '', zk?.proof ?? null);
        sealValid = recomputed.toLowerCase() === String(receipt.masterAuditSeal.sealHex).toLowerCase() && body.masterAuditSeal === receipt.masterAuditSeal.sealHex;
        if (!sealValid) reasons.push('The master audit seal does not recompute from the receipt.');
      }

      if (body.redactedDocumentSha256 !== receipt.sanitizedDocument.preimageSha256) reasons.push('Redacted-document hash mismatch between payload and receipt.');
      if (typeof body.redactedPdfBase64 === 'string' && body.redactedPdfBase64.length > 0) {
        pdf = Buffer.from(body.redactedPdfBase64, 'base64');
        if (sha256(pdf) !== body.redactedDocumentSha256) { reasons.push('The attached PDF does not hash to the sealed redacted-document fingerprint.'); pdf = null; }
      }
    }

    if (reasons.length > 0) {
      await save(s, { status: 'FAILED', reasons });
      log('callback', requestId, 'FAILED:', reasons.join(' | '));
      return [422, { ok: false, status: 'FAILED', reasons }];
    }

    let redactedPdfAvailable = false;
    if (pdf) {
      if (pdf.length <= MAX_STORED_PDF_BYTES) {
        try { await store.setPdf(requestId, pdf, keepSeconds); redactedPdfAvailable = true; } catch (err) { log('callback', requestId, 'pdf not stored:', err.message); }
      } else log('callback', requestId, `pdf not stored: ${pdf.length} bytes exceeds ${MAX_STORED_PDF_BYTES}`);
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
    await save(s, { status: 'VERIFIED', verification, reasons: [], redactedPdfAvailable });
    log('callback', requestId, 'VERIFIED · proof', verifyMs + 'ms · seal ok');
    return [200, { ok: true, status: 'VERIFIED', message: 'Verified: proof, seal and nonce all check out.', verification }];
  }

  async function status(id) {
    const s = await load(id);
    return s ? [200, { ok: true, ...view(s) }] : [404, { ok: false, error: 'Unknown requestId.' }];
  }

  async function redacted(id) {
    const s = await load(id);
    if (!s || !s.redactedPdfAvailable) return null;
    return store.getPdf(id);
  }

  return { init, callback, status, redacted, view, load };
}
