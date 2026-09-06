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
}

export interface ZeroaraResultMessage {
  type: 'zeroara:result';
  version: 1;
  requestId: string;
  bundle: ZeroaraAuditPackage;
  redactedPdfBase64: string;
  fileName: string;
  deliveredAt: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Validate an untrusted wire request. Returns null for anything malformed. */
export function parseZeroaraRequest(raw: unknown): ZeroaraRequest | null {
  if (!isRecord(raw)) return null;
  const { requestId, requester, document, nonce, purpose, claim, replyOrigin, issuedAt } = raw;
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
  };
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
