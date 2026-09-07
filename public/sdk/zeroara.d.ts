/** Type declarations for the Zeroara Verify SDK (public/sdk/zeroara.js). */
export interface ZeroaraClaim { field?: string; op?: '>='; value: number; unit?: string }
export interface ZeroaraVerifyOptions {
  /** Scenario id: 'aadhaar' | 'pan' | 'college_id' | 'bank_statement' | 'salary_slip' | 'tax_form' | 'income_accredited' | 'generic_id' | 'generic_financial' */
  document: string;
  /** Condition to prove in zero knowledge (proof-backed document types only). */
  claim?: ZeroaraClaim | null;
  requester?: string;
  purpose?: string;
  /** 'auto' (popup, falling back to an overlay iframe), 'popup', 'iframe', or 'desktop' (verifier API + zeroara:// deep link). */
  mode?: 'auto' | 'popup' | 'iframe' | 'desktop';
  /** Desktop mode: base URL of the verifier API. Defaults to the Zeroara origin, which hosts /api/verify/* on Vercel. */
  api?: string;
  /** Desktop mode: what to do when the app does not open — 'auto' (overlay after fallbackAfterMs), 'iframe', 'popup' or 'none'. */
  fallback?: 'auto' | 'iframe' | 'popup' | 'none';
  fallbackAfterMs?: number;
  /**
   * Optional HTTPS/HTTP installer page shown by `Zeroara.mount` when the
   * desktop deep link has not opened. Relative URLs are resolved against the
   * relying party's page; invalid or non-web URLs are ignored.
   */
  desktopDownloadUrl?: string;
  /** Label for the optional desktop installer link. */
  downloadLabel?: string;
  /** Desktop mode: skip launching the deep link (useful in tests). */
  openApp?: boolean;
  /** Ask the user to include the redacted PDF (browser modes default to true). */
  wantRedactedPdf?: boolean;
  onStatus?: (status: ZeroaraSessionStatus) => void;
  onFallback?: (openWeb: (kind?: 'iframe' | 'popup') => void, session: ZeroaraSession) => void;
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
export interface ZeroaraSession { requestId: string; nonce: string; expiresAt: string; callbackUrl: string; request: ZeroaraRequest; deepLink: string; webFallbackUrl: string; statusUrl: string; eventsUrl: string }
export interface ZeroaraSessionStatus { requestId: string; status: 'PENDING' | 'VERIFIED' | 'FAILED' | 'DECLINED' | 'EXPIRED'; verification?: Record<string, unknown> | null; reasons?: string[]; redactedPdfUrl?: string | null; launched?: boolean }
export interface ZeroaraVerificationResult { version: 1; requestId: string; nonce: string; status: 'VERIFIED' | 'FAILED' | 'DECLINED'; predicateSatisfied: boolean; document: string; claim: ZeroaraClaim | null; proof?: Record<string, unknown>; commitment?: string; masterAuditSeal?: string; redactedDocumentSha256?: string; redactedPdfBase64?: string; receipt?: Record<string, unknown>; reason?: string; signedTimestamp: string }
export interface ZeroaraResult {
  ok: boolean;
  status: string;
  requestId: string;
  request: ZeroaraRequest;
  /** Browser transport only. */
  checks?: ZeroaraCheck;
  /** The sanitized audit package (cryptographic receipt); null when the claim failed. Browser transport only. */
  bundle?: Record<string, unknown> | null;
  verification?: ZeroaraVerificationResult | null;
  redactedPdfBase64?: string;
  redactedPdfBytes?: Uint8Array;
  fileName?: string;
  deliveredAt?: string;
  origin?: string;
  /** Desktop transport only: the verifier API's session record. */
  record?: ZeroaraSessionStatus;
  reasons?: string[];
  redactedPdfUrl?: string | null;
  transport: 'browser' | 'desktop' | 'web-fallback';
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
  /** Render a "Verify with Zeroara" button into `target`; resolves results through onResult/onError. */
  mount(target: string | HTMLElement, options: ZeroaraVerifyOptions & { label?: string; hint?: string; fallbackLabel?: string; onResult?: (r: ZeroaraResult) => void; onError?: (e: Error) => void }): { element: HTMLElement; destroy: () => void };
  desktop: { init(api: string, options: ZeroaraVerifyOptions): Promise<ZeroaraSession>; watchStatus(api: string, requestId: string, onUpdate: (s: ZeroaraSessionStatus) => void): () => void; fetchStatus(api: string, requestId: string): Promise<ZeroaraSessionStatus>; launchDeepLink(url: string): boolean };
}
declare global { interface Window { Zeroara: ZeroaraSDK } }
export {};
