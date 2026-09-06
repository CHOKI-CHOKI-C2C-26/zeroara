/** Type declarations for the Zeroara Verify SDK (public/sdk/zeroara.js). */
export interface ZeroaraClaim { field?: string; op?: '>='; value: number; unit?: string }
export interface ZeroaraVerifyOptions {
  /** Scenario id: 'aadhaar' | 'pan' | 'college_id' | 'bank_statement' | 'salary_slip' | 'tax_form' | 'income_accredited' | 'generic_id' | 'generic_financial' */
  document: string;
  /** Condition to prove in zero knowledge (proof-backed document types only). */
  claim?: ZeroaraClaim | null;
  requester?: string;
  purpose?: string;
  /** 'auto' (popup, falling back to an overlay iframe), 'popup' or 'iframe'. */
  mode?: 'auto' | 'popup' | 'iframe';
  /** Element that hosts the overlay in iframe mode (default: document.body). */
  container?: HTMLElement;
  /** Zeroara origin (default: the origin this script was loaded from). */
  origin?: string;
  nonce?: string;
  requestId?: string;
  timeoutMs?: number;
  keepOpen?: boolean;
}
export interface ZeroaraRequest { version: 1; requestId: string; requester: string; purpose: string; document: string; claim: ZeroaraClaim | null; nonce: string; replyOrigin: string; issuedAt: string }
export interface ZeroaraCheck { ok: boolean; reasons: string[] }
export interface ZeroaraResult {
  ok: boolean;
  checks: ZeroaraCheck;
  requestId: string;
  request: ZeroaraRequest;
  /** The audit package (cryptographic receipt). */
  bundle: Record<string, unknown>;
  redactedPdfBase64: string;
  redactedPdfBytes: Uint8Array;
  fileName: string;
  deliveredAt: string;
  origin: string;
}
export interface ZeroaraGate { gateNumber: number; gateName: string; passed: boolean; expectedValue: string; actualValue: string; details: string; latencyMs: number }
export interface ZeroaraAuditReport { overallValid: boolean; auditTimestamp: string; totalDurationMs: number; gates: ZeroaraGate[]; confidentialBytesDisclosed: 0 }
export interface ZeroaraSDK {
  version: string;
  origin: string;
  verify(options: ZeroaraVerifyOptions): Promise<ZeroaraResult>;
  check(result: { bundle: unknown }, request: ZeroaraRequest): ZeroaraCheck;
  audit(bundle: unknown, options?: { origin?: string; timeoutMs?: number }): Promise<ZeroaraAuditReport>;
  buildRequest(options: ZeroaraVerifyOptions): ZeroaraRequest;
}
declare global { interface Window { Zeroara: ZeroaraSDK } }
export {};
