import { useRef, useState } from 'react';
import {
  ShieldCheck,
  KeyRound,
  UploadCloud,
  Lock,
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  CircleDot,
  EyeOff,
  Send,
  Download,
  FileText,
  Flame,
  Cpu,
  Fingerprint,
  ScanLine,
  AlertTriangle,
  RefreshCw,
  Clock,
} from 'lucide-react';
import type { ActiveVerifierRequest } from '../integration/protocol';
import { StatusBadge, KV } from './ui';

/* Authenticator-style flow for an external verification request
 * (the "offline app" side of the Online Verifier <-> Zeroara workflow).
 *
 *   1. Review the request      2. Provide the document      3. Local processing
 *   4. Privacy & consent        5. Authorize & release
 *
 * Purely presentational: every action is a callback into App, which owns the
 * pipeline (OCR -> burn -> prove -> seal) and the release transport. */

export type RequestScreen = 'review' | 'ingest' | 'processing' | 'consent' | 'release';
export type ReleaseState = 'idle' | 'sending' | 'sent' | 'failed' | 'declined';
export type Outcome = 'VERIFIED' | 'FAILED';

export interface PipelineStatus {
  ocrRunning: boolean;
  ocrDone: boolean;
  targets: number;
  burned: boolean;
  proving: boolean;
  proofDone: boolean;
  proofRequired: boolean;
  sealed: boolean;
  error: string | null;
}

export interface ReleaseInfo {
  ok: boolean;
  channel: 'callback' | 'message' | 'download';
  status?: string;
  message?: string;
  error?: string;
  reasons?: string[];
}

export interface RequestFlowProps {
  request: ActiveVerifierRequest;
  scenarioLabel: string;
  screen: RequestScreen;
  expired: boolean;
  doc: { fileName: string; sizeBytes: number } | null;
  uploadError: string | null;
  pdfLocked: { incorrect: boolean } | null;
  pdfPasswordDraft: string;
  onPdfPasswordDraft: (v: string) => void;
  onUnlockPdf: () => void;
  pipeline: PipelineStatus;
  burnedPreviewUrl: string | null;
  burnedFields: string[];
  outcome: Outcome | null;
  predicateText: string;
  includePdf: boolean;
  onIncludePdf: (v: boolean) => void;
  release: { state: ReleaseState; info: ReleaseInfo | null };
  canCloseWindow: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onFile: (file: File) => void;
  onAuthorize: () => void;
  onRetrySend: () => void;
  onDone: () => void;
  onCloseWindow: () => void;
}

const SCREENS: { id: RequestScreen; label: string }[] = [
  { id: 'review', label: 'Request' },
  { id: 'ingest', label: 'Document' },
  { id: 'processing', label: 'Process' },
  { id: 'consent', label: 'Consent' },
  { id: 'release', label: 'Release' },
];

function fmtBytes(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function remaining(expiresAt?: string): string | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt) - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return 'expired';
  const m = Math.floor(ms / 60000);
  return m >= 1 ? `${m} min left` : `${Math.ceil(ms / 1000)} s left`;
}

export function RequestFlow(p: RequestFlowProps) {
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const idx = SCREENS.findIndex((s) => s.id === p.screen);
  const req = p.request;
  const where = req.requesterOrigin ?? (req.callbackUrl ? new URL(req.callbackUrl).host : undefined);

  const stepRow = (icon: React.ReactNode, title: string, detail: string, state: 'done' | 'active' | 'pending' | 'failed') => (
    <div className="neu-check-item" style={{ cursor: 'default', padding: '9px 12px' }}>
      <span className={`neu-check-icon ${state === 'done' ? 'neu-tone-ok' : state === 'active' ? 'neu-tone-active' : state === 'failed' ? 'neu-tone-warn' : 'neu-tone-muted'}`} style={{ width: '28px', height: '28px' }}>
        {state === 'active' ? <Loader2 size={14} className="spin" /> : state === 'done' ? <CheckCircle2 size={14} /> : state === 'failed' ? <XCircle size={14} /> : icon}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, flex: 1 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.82rem', color: 'var(--fg-primary)' }}>{title}</span>
        <span style={{ fontSize: '0.72rem', color: 'var(--fg-muted)' }}>{detail}</span>
      </span>
    </div>
  );

  return (
    <div className="pane-scroll" style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: 'min(760px, 100%)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Progress */}
        <div className="neu-card stepper-strip" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
          {SCREENS.map((s, i) => {
            const state = i < idx ? 'done' : i === idx ? 'active' : 'pending';
            const Icon = state === 'done' ? CheckCircle2 : state === 'active' ? CircleDot : Circle;
            return (
              <div key={s.id} className={`neu-step-item ${state === 'active' ? 'current' : ''}`} style={{ cursor: 'default', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                <span className={`neu-check-icon ${state === 'done' ? 'neu-tone-ok' : state === 'active' ? 'neu-tone-active' : 'neu-tone-muted'}`} style={{ width: '22px', height: '22px' }}>
                  <Icon size={13} />
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.76rem', color: state === 'active' ? 'var(--accent)' : 'var(--fg-primary)' }}>
                  {i + 1}. {s.label}
                </span>
              </div>
            );
          })}
        </div>

        <div className="neu-card" style={{ padding: '22px', gap: '14px' }}>
          {/* ------------------------------------------------ 1. Review */}
          {p.screen === 'review' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="neu-check-icon" style={{ width: '44px', height: '44px', color: 'var(--accent)' }}>
                  <KeyRound size={20} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.05rem', color: 'var(--fg-primary)' }}>External verification request</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--fg-muted)' }}>
                    {req.requester}
                    {where ? ` · ${where}` : ''} asks you to prove something about a document — without handing over the document.
                  </div>
                </div>
              </div>

              <div className="neu-well" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <KV label="Requested by" value={req.requester} mono={false} />
                {where && <KV label="Verifier" value={where} />}
                <KV label="Purpose" value={req.purpose} mono={false} />
                <KV label="Document" value={p.scenarioLabel} mono={false} />
                <KV label="Must be true" value={<span className="neu-tone-active">{req.claim}</span>} />
                <KV label="Challenge nonce" value={`${req.nonce.slice(0, 18)}…`} />
                {req.expiresAt && <KV label="Valid for" value={remaining(req.expiresAt) ?? '—'} />}
                <KV label="They will receive" value={req.claimSpec ? 'true/false + zero-knowledge proof + audit seal' : 'audit seal of the redaction'} mono={false} />
                <KV label="They will never receive" value="the document, its values, your identity" mono={false} />
              </div>

              {p.expired ? (
                <StatusBadge tone="warn">
                  <Clock size={13} /> This request has expired. Ask {req.requester} to start again.
                </StatusBadge>
              ) : (
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button type="button" className="neu-btn-primary" style={{ padding: '12px 18px', fontSize: '0.9rem', gap: '8px', flex: 1 }} onClick={p.onAccept}>
                    <ShieldCheck size={17} /> <span>Continue</span>
                  </button>
                  <button type="button" className="neu-btn-secondary" style={{ padding: '12px 18px', fontSize: '0.86rem' }} onClick={p.onDecline}>
                    Decline
                  </button>
                </div>
              )}
              {p.expired && (
                <button type="button" className="neu-btn-secondary" style={{ padding: '10px 16px', fontSize: '0.84rem', alignSelf: 'flex-start' }} onClick={p.onDone}>
                  Done
                </button>
              )}
            </>
          )}

          {/* ------------------------------------------------ 2. Ingest */}
          {p.screen === 'ingest' && (
            <>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.05rem', color: 'var(--fg-primary)' }}>Provide your {p.scenarioLabel.toLowerCase()}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--fg-muted)' }}>A photo, scan or PDF from this device. It is read here and never uploaded.</div>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,image/*,.pdf"
                data-request-file="ingest"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) p.onFile(f);
                  e.target.value = '';
                }}
              />
              <div
                className={`neu-dropzone ${dragging ? 'dragging' : ''}`}
                style={{ minHeight: '260px' }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) p.onFile(f);
                }}
                onClick={() => fileInput.current?.click()}
              >
                <div style={{ width: '60px', height: '60px', borderRadius: '50%', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-extruded)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                  <UploadCloud size={30} />
                </div>
                <div>
                  <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 800 }}>Drop the document here, or click to browse</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--fg-muted)', marginTop: '6px', maxWidth: '400px' }}>
                    PDF or image (PNG, JPEG, WebP, GIF, BMP, AVIF). <strong>Nothing leaves your device.</strong>
                  </p>
                  {p.uploadError && (
                    <p role="alert" style={{ fontSize: '0.78rem', color: 'var(--accent-rose)', marginTop: '8px' }}>
                      {p.uploadError}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="neu-btn-primary"
                  style={{ fontSize: '0.84rem', padding: '10px 20px' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInput.current?.click();
                  }}
                >
                  Browse files
                </button>
              </div>
              <button type="button" className="neu-btn-secondary" style={{ padding: '9px 14px', fontSize: '0.8rem', alignSelf: 'flex-start' }} onClick={p.onDecline}>
                Decline request
              </button>
            </>
          )}

          {/* ------------------------------------------------ 3. Processing */}
          {p.screen === 'processing' && (
            <>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.05rem', color: 'var(--fg-primary)' }}>Processing on this device</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--fg-muted)' }}>
                  {p.doc ? `${p.doc.fileName} · ${fmtBytes(p.doc.sizeBytes)}` : ''} · no network access to the document at any point.
                </div>
              </div>

              {p.pdfLocked && (
                <div className="neu-well-deep" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.82rem' }}>
                    <Lock size={14} /> This PDF is password-protected
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--fg-muted)' }}>e-Aadhaar PDFs open with the first four letters of your name in CAPITALS followed by your birth year. The password stays on this device.</span>
                  <form
                    style={{ display: 'flex', gap: '8px' }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      p.onUnlockPdf();
                    }}
                  >
                    <input className="neu-input" type="password" value={p.pdfPasswordDraft} onChange={(e) => p.onPdfPasswordDraft(e.target.value)} placeholder="PDF password" aria-label="PDF password" />
                    <button type="submit" className="neu-btn-primary" style={{ padding: '8px 14px', fontSize: '0.78rem' }}>
                      Unlock
                    </button>
                  </form>
                  {p.pdfLocked.incorrect && <span style={{ fontSize: '0.72rem', color: 'var(--accent-rose)' }}>That password did not open the file.</span>}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {stepRow(<ScanLine size={14} />, 'Read locally', p.pipeline.ocrDone ? `${p.pipeline.targets} sensitive fields found` : 'OCR runs in this app; the file is never uploaded', p.pipeline.error && !p.pipeline.ocrDone ? 'failed' : p.pipeline.ocrDone ? 'done' : 'active')}
                {stepRow(<Flame size={14} />, 'Burn', p.pipeline.burned ? 'Every sensitive field blacked out; PDF flattened' : 'Pixels under each field are replaced with black', p.pipeline.burned ? 'done' : p.pipeline.ocrDone && !p.pipeline.error ? 'active' : 'pending')}
                {p.pipeline.proofRequired &&
                  stepRow(<Cpu size={14} />, 'Prove in zero knowledge', p.pipeline.proofDone ? `${p.predicateText} proven without revealing the value` : `Groth16 proof of ${p.predicateText}`, p.pipeline.proofDone ? 'done' : p.pipeline.error && p.pipeline.burned ? 'failed' : p.pipeline.proving || (p.pipeline.burned && !p.pipeline.error) ? 'active' : 'pending')}
                {stepRow(<Fingerprint size={14} />, 'Seal', p.pipeline.sealed ? 'Master audit seal computed' : 'Binds the redacted document, boxes and proof', p.pipeline.sealed ? 'done' : (p.pipeline.proofRequired ? p.pipeline.proofDone : p.pipeline.burned) && !p.pipeline.error ? 'active' : 'pending')}
              </div>

              {p.pipeline.error && (
                <div className="neu-well-deep" style={{ padding: '10px 12px', fontSize: '0.78rem', color: 'var(--accent-rose)', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                  <span>{p.pipeline.error}</span>
                </div>
              )}
              {p.pipeline.error && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button type="button" className="neu-btn-primary" style={{ padding: '10px 16px', fontSize: '0.84rem', gap: '8px' }} onClick={() => fileInput.current?.click()}>
                    <RefreshCw size={15} /> <span>Try another file</span>
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="application/pdf,image/*,.pdf"
                    data-request-file="retry"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) p.onFile(f);
                      e.target.value = '';
                    }}
                  />
                  {p.outcome === 'FAILED' && (
                    <button type="button" className="neu-btn-secondary" style={{ padding: '10px 16px', fontSize: '0.84rem' }} onClick={p.onAuthorize}>
                      Report “not satisfied” to {req.requester}
                    </button>
                  )}
                  <button type="button" className="neu-btn-secondary" style={{ padding: '10px 16px', fontSize: '0.84rem' }} onClick={p.onDecline}>
                    Decline
                  </button>
                </div>
              )}
            </>
          )}

          {/* ------------------------------------------------ 4. Consent */}
          {p.screen === 'consent' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.05rem', color: 'var(--fg-primary)' }}>Review what leaves this device</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--fg-muted)' }}>Nothing is sent until you authorize it.</div>
                </div>
                {p.outcome === 'VERIFIED' ? (
                  <StatusBadge tone="ok">
                    <CheckCircle2 size={13} /> {p.predicateText}: proven
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="warn">
                    <XCircle size={13} /> {p.predicateText}: not satisfied
                  </StatusBadge>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '14px' }}>
                <div className="neu-well" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--fg-muted)' }}>Redacted document (as the verifier may see it)</span>
                  {p.burnedPreviewUrl ? (
                    <img src={p.burnedPreviewUrl} alt="Redacted document preview" style={{ width: '100%', height: 'auto', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }} />
                  ) : (
                    <span style={{ fontSize: '0.76rem', color: 'var(--fg-muted)' }}>No document is included in a “not satisfied” result.</span>
                  )}
                  {p.burnedFields.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                      {p.burnedFields.map((f) => (
                        <span key={f} className="neu-hash-pill" style={{ fontSize: '0.64rem' }}>
                          <EyeOff size={10} style={{ verticalAlign: '-1px', marginRight: '3px' }} />
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div className="neu-well" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)' }}>Will be sent to {req.requester}</span>
                    <KV label="Result" value={p.outcome === 'VERIFIED' ? 'VERIFIED · true' : 'FAILED · false'} />
                    {p.outcome === 'VERIFIED' && (
                      <>
                        {p.pipeline.proofRequired && <KV label="Zero-knowledge proof" value="Groth16 · 2 public signals" mono={false} />}
                        <KV label="Master audit seal" value="SHA-256" />
                        <KV label="Redacted-document hash" value="SHA-256" />
                        <KV label="Audit receipt" value="geometry + proof, no secrets" mono={false} />
                        {req.wantRedactedPdf && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'var(--fg-primary)', cursor: 'pointer' }}>
                            <input type="checkbox" checked={p.includePdf} onChange={(e) => p.onIncludePdf(e.target.checked)} />
                            Include the redacted PDF (requested by {req.requester})
                          </label>
                        )}
                      </>
                    )}
                    <KV label="Challenge nonce" value={`${req.nonce.slice(0, 14)}…`} />
                  </div>
                  <div className="neu-well" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-secondary)' }}>Stays on this device</span>
                    <span style={{ fontSize: '0.76rem', color: 'var(--fg-primary)' }}>The original file · every value under a black box · the private witness and its blinding salt · OCR text.</span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button type="button" className="neu-btn-primary" style={{ padding: '12px 18px', fontSize: '0.9rem', gap: '8px', flex: 1 }} onClick={p.onAuthorize}>
                  <Send size={16} /> <span>{p.outcome === 'VERIFIED' ? `Authorize & send to ${req.requester}` : `Send “not satisfied” to ${req.requester}`}</span>
                </button>
                <button type="button" className="neu-btn-secondary" style={{ padding: '12px 18px', fontSize: '0.86rem' }} onClick={p.onDecline}>
                  Decline
                </button>
              </div>
            </>
          )}

          {/* ------------------------------------------------ 5. Release */}
          {p.screen === 'release' && (
            <>
              {p.release.state === 'sending' && (
                <StatusBadge tone="active">
                  <Loader2 size={13} className="spin" /> Sending the result to {req.requester}…
                </StatusBadge>
              )}
              {p.release.state === 'sent' && p.release.info && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', textAlign: 'center', padding: '10px 0' }}>
                  <span className="demo-success-ring">
                    <ShieldCheck size={44} />
                  </span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.15rem', color: 'var(--accent-secondary)' }}>
                    {p.release.info.channel === 'download' ? 'Result saved' : `Sent to ${req.requester}`}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted)', maxWidth: '520px' }}>
                    {p.release.info.channel === 'callback'
                      ? `The verifier at ${where ?? 'the callback URL'} answered: ${p.release.info.status ?? 'received'}${p.release.info.message ? ` — ${p.release.info.message}` : ''}.`
                      : p.release.info.channel === 'message'
                        ? 'Delivered to the site that opened Zeroara. 0 bytes of confidential data were shared.'
                        : 'No verifier could be reached, so the result and the redacted PDF were downloaded for you to hand over.'}
                  </span>
                </div>
              )}
              {p.release.state === 'failed' && p.release.info && (
                <>
                  <StatusBadge tone="warn">
                    <AlertTriangle size={13} /> Could not deliver the result
                  </StatusBadge>
                  <span style={{ fontSize: '0.8rem', color: 'var(--fg-primary)' }}>{p.release.info.error ?? p.release.info.message}</span>
                  {p.release.info.reasons && p.release.info.reasons.length > 0 && (
                    <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.78rem', color: 'var(--fg-muted)' }}>
                      {p.release.info.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button type="button" className="neu-btn-primary" style={{ padding: '10px 16px', fontSize: '0.84rem', gap: '8px' }} onClick={p.onRetrySend}>
                      <RefreshCw size={15} /> <span>Try again</span>
                    </button>
                  </div>
                </>
              )}
              {p.release.state === 'declined' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <StatusBadge tone="muted">Request declined</StatusBadge>
                  <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted)' }}>Nothing was sent to {req.requester}.</span>
                </div>
              )}
              {p.release.state !== 'sending' && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {p.canCloseWindow && (
                    <button type="button" className="neu-btn-primary" style={{ padding: '10px 16px', fontSize: '0.84rem' }} onClick={p.onCloseWindow}>
                      Close this window
                    </button>
                  )}
                  <button type="button" className="neu-btn-secondary" style={{ padding: '10px 16px', fontSize: '0.84rem' }} onClick={p.onDone}>
                    Done
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.72rem', color: 'var(--fg-dim)', justifyContent: 'center' }}>
          <Lock size={12} />
          <span>Zeroara processes the document on this device. Only the outcome, a zero-knowledge proof and an audit seal can leave it — after you authorize.</span>
          <FileText size={12} style={{ opacity: 0 }} />
          <Download size={12} style={{ opacity: 0 }} />
        </div>
      </div>
    </div>
  );
}
