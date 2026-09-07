import type { ZeroaraAuditPackage } from '../layers';
import { SCENARIOS, getScenario, isProofBacked, DEFAULT_SCENARIO_ID } from '../core/scenarios';

/* Zeroara integration protocol (v1).
 *
 * A relying party ("verifier") asks Zeroara to prove a condition about a
 * document it never sees. The request travels either as a postMessage
 * `zeroara:request` from the opener/parent window (the SDK does this) or as a
 * `?request=<base64url JSON>` URL parameter. Zeroara replies with
 * `zeroara:result` to the authenticated origin only, carrying the flattened
 * redacted PDF and the audit package (receipt) — never the original bytes. */

export const ZEROARA_PROTOCOL_VERSION = 1 as const;

export interface ZeroaraClaim {
  /** Human label for the value being proven, e.g. "Age" or "Net income". */
  field?: string;
  op: '>=';
  value: number;
  unit?: string;
}

export interface ZeroaraRequest {
  version: 1;
  requestId: string;
  requester: string;
  purpose?: string;
  /** Scenario id: 'aadhaar' | 'income_accredited' | 'salary_slip' | ... */
  document: string;
  claim?: ZeroaraClaim | null;
  nonce: string;
  /** Origin that should receive the result when the request arrived via URL. */
  replyOrigin?: string;
  issuedAt?: string;
  /** Online verifier endpoint that receives the result (desktop / deep-link flow). */
  callbackUrl?: string;
  /** Ask the user to include the flattened redacted PDF in the result. */
  wantRedactedPdf?: boolean;
  /** ISO time after which the verifier will refuse the result. */
  expiresAt?: string;
}

export type RequestSource = 'demo' | 'external';

/** A request after it has been resolved against the scenario registry. */
export interface ActiveVerifierRequest {
  id: string;
  source: RequestSource;
  requester: string;
  purpose: string;
  claim: string;
  scenarioId: string;
  thresholdValue: number;
  unit: string;
  nonce: string;
  issuedAt: string;
  replyOrigin?: string;
  callbackUrl?: string;
  /** Host shown to the user: the callback's host, else the reply origin's host. */
  requesterOrigin?: string;
  wantRedactedPdf: boolean;
  expiresAt?: string;
  /** The claim as requested (null for seal-only document types). */
  claimSpec: ZeroaraClaim | null;
}

export interface ZeroaraResultMessage {
  type: 'zeroara:result';
  version: 1;
  requestId: string;
  /** Sanitized receipt; null when the claim was not satisfied. */
  bundle: ZeroaraAuditPackage | null;
  redactedPdfBase64: string;
  fileName: string;
  deliveredAt: string;
  /** The same payload an online verifier would receive on its callback. */
  verification: ZeroaraVerificationResult;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** A callback must be https, or plain http on a loopback host (local development). */
export function isAllowedCallbackUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    if (u.protocol === 'https:') return true;
    if (u.protocol !== 'http:') return false;
    const h = u.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost');
  } catch {
    return false;
  }
}

/** Validate an untrusted wire request. Returns null for anything malformed. */
export function parseZeroaraRequest(raw: unknown): ZeroaraRequest | null {
  if (!isRecord(raw)) return null;
  const { requestId, requester, document, nonce, purpose, claim, replyOrigin, issuedAt, callbackUrl, wantRedactedPdf, expiresAt } = raw;
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(requestId)) return null;
  if (typeof document !== 'string' || !SCENARIOS.some((s) => s.id === document)) return null;
  if (typeof nonce !== 'string' || nonce.length < 8 || nonce.length > 130) return null;
  if (typeof requester !== 'string' || !requester.trim()) return null;

  let parsedClaim: ZeroaraClaim | null = null;
  if (claim != null) {
    if (!isRecord(claim)) return null;
    if (claim.op !== '>=' || typeof claim.value !== 'number' || !Number.isFinite(claim.value) || claim.value < 0) return null;
    parsedClaim = {
      op: '>=',
      value: Math.floor(claim.value),
      field: typeof claim.field === 'string' ? claim.field.slice(0, 64) : undefined,
      unit: typeof claim.unit === 'string' ? claim.unit.slice(0, 16) : undefined,
    };
  }

  return {
    version: 1,
    requestId,
    requester: requester.trim().slice(0, 80),
    purpose: typeof purpose === 'string' ? purpose.slice(0, 200) : undefined,
    document,
    claim: parsedClaim,
    nonce,
    replyOrigin: typeof replyOrigin === 'string' && /^https?:\/\/[^/]+$/.test(replyOrigin) ? replyOrigin : undefined,
    issuedAt: typeof issuedAt === 'string' ? issuedAt : undefined,
    callbackUrl: isAllowedCallbackUrl(callbackUrl) ? callbackUrl : undefined,
    wantRedactedPdf: wantRedactedPdf === true,
    expiresAt: typeof expiresAt === 'string' && !Number.isNaN(Date.parse(expiresAt)) ? expiresAt : undefined,
  };
}

/** Resolve a wire request into the workspace's active request. */
export function resolveRequest(req: ZeroaraRequest, source: RequestSource, replyOrigin?: string): ActiveVerifierRequest {
  const scenario = getScenario(SCENARIOS.some((s) => s.id === req.document) ? req.document : DEFAULT_SCENARIO_ID);
  const proofBacked = isProofBacked(scenario);
  const witnessLabel = scenario.fields.find((f) => f.isWitness)?.label ?? scenario.fields[0].label;
  const thresholdValue = proofBacked && req.claim ? req.claim.value : scenario.defaults.thresholdValue;
  const unit = (proofBacked && req.claim?.unit) || scenario.defaults.unit;
  const claim = proofBacked
    ? `${req.claim?.field || witnessLabel} ≥ ${thresholdValue.toLocaleString()} ${unit}`.trim()
    : `${scenario.label} · redaction sealed (no numeric claim)`;
  return {
    id: req.requestId,
    source,
    requester: req.requester,
    purpose: req.purpose || scenario.defaults.purpose,
    claim,
    scenarioId: scenario.id,
    thresholdValue,
    unit,
    nonce: req.nonce,
    issuedAt: req.issuedAt || new Date().toISOString(),
    replyOrigin,
    callbackUrl: req.callbackUrl,
    requesterOrigin: hostOf(req.callbackUrl) ?? hostOf(replyOrigin),
    wantRedactedPdf: req.wantRedactedPdf === true,
    expiresAt: req.expiresAt,
    claimSpec: proofBacked && req.claim ? req.claim : null,
  };
}

function hostOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------------- */
/* Result payload (offline app -> online verifier)                            */
/* ------------------------------------------------------------------------- */

export type VerificationStatus = 'VERIFIED' | 'FAILED' | 'DECLINED';

export interface ZeroaraVerificationResult {
  version: 1;
  requestId: string;
  nonce: string;
  status: VerificationStatus;
  predicateSatisfied: boolean;
  /** Scenario id the document was processed as. */
  document: string;
  claim: ZeroaraClaim | null;
  redactionMode?: 'PROOF_BACKED' | 'SEAL_ONLY';
  proof?: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
    /** [thresholdValue, poseidonCommitment] for the income_threshold circuit. */
    publicSignals: string[];
  };
  commitment?: string;
  masterAuditSeal?: string;
  redactedDocumentSha256?: string;
  /** Only when the requester asked for it and the user consented. */
  redactedPdfBase64?: string;
  /** The audit package with every secret stripped (see sanitizeReceipt). */
  receipt?: ZeroaraAuditPackage;
  reason?: string;
  /** Issued-at time. A device signature over this payload is reserved for the hardware-attestation layer. */
  signedTimestamp: string;
}

/**
 * Strip everything a relying party must never learn from an audit package:
 * the blinding salt (with it, the committed value can be brute-forced), the
 * original file's hash and name. The master seal does not cover these fields,
 * so the sanitized receipt still verifies exactly like the original.
 */
export function sanitizeReceipt(pkg: ZeroaraAuditPackage): ZeroaraAuditPackage {
  const copy: ZeroaraAuditPackage = JSON.parse(JSON.stringify(pkg));
  copy.sourceDocument = {
    fileName: 'document (name withheld)',
    fileSizeBytes: pkg.sourceDocument.fileSizeBytes,
    mimeType: pkg.sourceDocument.mimeType,
    preimageSha256: '',
  };
  if (copy.zeroKnowledgeProof) copy.zeroKnowledgeProof.blindingSalt = '';
  return copy;
}

export function buildVerificationResult(args: {
  request: ActiveVerifierRequest;
  status: VerificationStatus;
  pkg?: ZeroaraAuditPackage | null;
  redactedPdf?: Uint8Array | null;
  includePdf?: boolean;
  reason?: string;
}): ZeroaraVerificationResult {
  const { request, status, pkg, redactedPdf, includePdf, reason } = args;
  const base: ZeroaraVerificationResult = {
    version: 1,
    requestId: request.id,
    nonce: request.nonce,
    status,
    predicateSatisfied: false,
    document: request.scenarioId,
    claim: request.claimSpec,
    signedTimestamp: new Date().toISOString(),
  };
  if (reason) base.reason = reason;
  if (status !== 'VERIFIED' || !pkg) return base;

  const receipt = sanitizeReceipt(pkg);
  const zk = receipt.zeroKnowledgeProof;
  base.predicateSatisfied = request.claimSpec ? !!zk?.verified : true;
  base.redactionMode = receipt.redactionMode;
  if (zk) {
    base.proof = { ...zk.proof, publicSignals: zk.publicSignals };
    base.commitment = zk.poseidonCommitment;
  }
  base.masterAuditSeal = receipt.masterAuditSeal.sealHex;
  base.redactedDocumentSha256 = receipt.sanitizedDocument.preimageSha256;
  base.receipt = receipt;
  if (includePdf && redactedPdf && redactedPdf.length > 0) base.redactedPdfBase64 = bytesToBase64(redactedPdf);
  return base;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

function base64UrlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeRequestParam(req: ZeroaraRequest): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(req))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeRequestParam(param: string): ZeroaraRequest | null {
  try {
    return parseZeroaraRequest(JSON.parse(new TextDecoder().decode(base64UrlDecode(param))));
  } catch {
    return null;
  }
}

export function makeNonceHex(bytes = 12): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return '0x' + Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function makeRequestId(): string {
  return makeNonceHex(6).slice(2);
}
