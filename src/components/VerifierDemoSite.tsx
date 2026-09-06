import { useState } from 'react';
import {
  BadgeCheck,
  CheckCircle2,
  ShieldCheck,
  ExternalLink,
  Download,
  FileText,
  RefreshCw,
  KeyRound,
  Car,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import type { ZeroaraAuditPackage, VerifierAuditReport } from '../layers';
import { runEnterpriseAudit, downloadFile, formatChunkedHash } from '../layers';
import type { ActiveVerifierRequest } from '../integration/protocol';
import { Drawer, KV, StatusBadge } from './ui';

export type VerifierRequest = ActiveVerifierRequest;

/* A realistic third-party website ("Aegis Rentals") that gates a booking on
   age >= 18. It never receives the document: it issues a challenge nonce and a
   claim, receives back only the flattened redacted PDF + the cryptographic
   receipt, and verifies them independently. */

export interface VerifierResult {
  pkg: ZeroaraAuditPackage;
  pdfBytes: Uint8Array;
  fileName: string;
  receivedAt: string;
}

// The relying party's acceptance policy. Everything here is checked against
// what the receipt actually proves — nothing is inferred from the document.
export function evaluateVerifierResult(request: VerifierRequest, result: VerifierResult): { ok: boolean; reasons: string[] } {
  const pkg = result.pkg;
  const reasons: string[] = [];
  if (pkg.scenario?.id !== request.scenarioId) reasons.push('Document category does not match the request.');
  if (pkg.enterpriseRequirement.challengeNonce !== request.nonce) reasons.push('Challenge nonce mismatch — bundle was not produced for this session (replay rejected).');
  if (pkg.redactionMode !== 'PROOF_BACKED' || !pkg.zeroKnowledgeProof) reasons.push('The bundle is seal-only: it contains no zero-knowledge age proof.');
  else if (!pkg.zeroKnowledgeProof.verified) reasons.push('The zero-knowledge proof did not verify.');
  if (pkg.enterpriseRequirement.thresholdValue < request.thresholdValue)
    reasons.push(`Proven threshold (${pkg.enterpriseRequirement.thresholdValue}) is below the required ${request.thresholdValue}.`);
  return { ok: reasons.length === 0, reasons };
}

export function VerifierDemoSite({
  request,
  result,
  onStart,
  onOpenZeroara,
  onReset,
}: {
  request: VerifierRequest | null;
  result: VerifierResult | null;
  onStart: () => void;
  onOpenZeroara: () => void;
  onReset: () => void;
}) {
  const [report, setReport] = useState<VerifierAuditReport | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);

  const evaluation = request && result ? evaluateVerifierResult(request, result) : null;
  const status: 'idle' | 'pending' | 'verified' | 'failed' = !request ? 'idle' : !result ? 'pending' : evaluation?.ok ? 'verified' : 'failed';
  const minAge = request?.thresholdValue ?? 18;

  const runAudit = async () => {
    if (!result) return;
    setAuditing(true);
    try {
      setReport(await runEnterpriseAudit(result.pkg));
    } finally {
      setAuditing(false);
    }
  };

  const reset = () => {
    setReport(null);
    setShowReceipt(false);
    onReset();
  };

  return (
    <div className="demo-frame">
      {/* Browser chrome — this is a different website, not Zeroara */}
      <div className="demo-chrome">
        <span className="demo-dot" />
        <span className="demo-dot" />
        <span className="demo-dot" />
        <span className="demo-url">https://aegis-rentals.example/booking/age-check</span>
        <span className="neu-badge" style={{ fontSize: '0.64rem' }}>Third-party site · demo</span>
      </div>

      <div className="demo-body">
        {/* Site header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="neu-check-icon" style={{ width: '38px', height: '38px', color: 'var(--accent-secondary)' }}>
              <Car size={18} />
            </span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.15rem', color: 'var(--fg-primary)' }}>Aegis Rentals</span>
            <span style={{ fontSize: '0.78rem', color: 'var(--fg-muted)' }}>Cars · Bikes · Vans</span>
          </div>
          <span className="neu-hash-pill">Booking #AR-58213 · Pick-up today</span>
        </div>

        <div className="demo-hero">
          {/* Left: the booking being gated */}
          <div className="neu-well" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.4rem', color: 'var(--fg-primary)', lineHeight: 1.2 }}>
              Almost there — confirm you're {minAge}+
            </span>
            <p style={{ fontSize: '0.86rem', color: 'var(--fg-muted)', lineHeight: 1.55 }}>
              Local law requires renters to be at least {minAge}. We don't want your ID, your date of birth, or your Aadhaar number — we only
              need cryptographic proof that you're old enough.
            </p>
            <KV label="Vehicle" value="Hero Splendor+ · 2 days" mono={false} />
            <KV label="Requirement" value={`Age ≥ ${minAge}`} />
            <KV label="Data we will store" value="0 bytes of PII" />
          </div>

          {/* Right: the verification state */}
          <div className="neu-well" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '14px', justifyContent: 'center' }}>
            {status === 'idle' && (
              <>
                <StatusBadge tone="muted">Age not yet verified</StatusBadge>
                <p style={{ fontSize: '0.8rem', color: 'var(--fg-muted)' }}>
                  Verification runs on your device. This site receives a redacted, non-extractable document and a receipt — never the original.
                </p>
                <button type="button" className="neu-btn-primary" style={{ padding: '14px 18px', fontSize: '0.92rem', gap: '10px', width: '100%' }} onClick={onStart}>
                  <ShieldCheck size={18} />
                  <span>Verify with Zeroara</span>
                </button>
                <span style={{ fontSize: '0.7rem', color: 'var(--fg-dim)', textAlign: 'center' }}>Zero-knowledge · nothing leaves your device</span>
              </>
            )}

            {status === 'pending' && request && (
              <>
                <StatusBadge tone="active">
                  <Loader2 size={13} className="spin" /> Waiting for proof from Zeroara
                </StatusBadge>
                <KV label="Claim requested" value={request.claim} />
                <KV label="Challenge nonce" value={`${request.nonce.slice(0, 18)}…`} />
                <KV label="Issued" value={new Date(request.issuedAt).toLocaleTimeString()} />
                <button type="button" className="neu-btn-primary" style={{ padding: '12px 16px', fontSize: '0.86rem', gap: '8px', width: '100%' }} onClick={onOpenZeroara}>
                  <ExternalLink size={16} />
                  <span>Open Zeroara to continue</span>
                </button>
                <button type="button" className="neu-btn-secondary" style={{ padding: '9px 14px', fontSize: '0.78rem', width: '100%' }} onClick={reset}>
                  Cancel request
                </button>
              </>
            )}

            {status === 'verified' && request && result && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', textAlign: 'center' }}>
                  <span className="demo-success-ring">
                    <BadgeCheck size={44} />
                  </span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.15rem', color: 'var(--accent-secondary)' }}>
                    Identity &amp; Age ({minAge}+) Verified
                  </span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted)' }}>Zero PII retained. 0 bytes of sensitive data received.</span>
                </div>
                <KV label="Verified by" value={result.pkg.enterpriseRequirement.requesterName} mono={false} />
                <KV label="Claim" value={request.claim} />
                <KV
                  label="Challenge nonce"
                  value={
                    <span className="neu-tone-ok">
                      <CheckCircle2 size={12} style={{ verticalAlign: '-2px', marginRight: '4px' }} />
                      matched
                    </span>
                  }
                />
                <KV label="Master audit seal" value={`${result.pkg.masterAuditSeal.sealHex.slice(0, 16)}…`} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    type="button"
                    className="neu-btn-secondary"
                    style={{ padding: '9px 12px', fontSize: '0.76rem', gap: '6px', justifyContent: 'center' }}
                    onClick={() => downloadFile(result.pdfBytes, result.fileName, 'application/pdf')}
                  >
                    <Download size={13} />
                    <span>Redacted PDF</span>
                  </button>
                  <button
                    type="button"
                    className="neu-btn-secondary"
                    style={{ padding: '9px 12px', fontSize: '0.76rem', gap: '6px', justifyContent: 'center' }}
                    onClick={() => setShowReceipt(true)}
                  >
                    <FileText size={13} />
                    <span>Receipt</span>
                  </button>
                </div>
                <button
                  type="button"
                  className="neu-btn-primary"
                  style={{ padding: '11px 14px', fontSize: '0.82rem', gap: '8px', width: '100%' }}
                  onClick={runAudit}
                  disabled={auditing}
                >
                  {auditing ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />}
                  <span>{auditing ? 'Auditing…' : report ? 'Re-run independent audit' : 'Run independent 5-gate audit'}</span>
                </button>
                <button type="button" className="neu-pill-btn" style={{ alignSelf: 'center', fontSize: '0.72rem', display: 'flex', gap: '6px', alignItems: 'center' }} onClick={reset}>
                  <RefreshCw size={11} /> Start over
                </button>
              </>
            )}

            {status === 'failed' && evaluation && (
              <>
                <StatusBadge tone="warn">
                  <AlertTriangle size={13} /> Verification not satisfied
                </StatusBadge>
                <ul style={{ fontSize: '0.8rem', color: 'var(--fg-primary)', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {evaluation.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <button type="button" className="neu-btn-secondary" style={{ padding: '9px 14px', fontSize: '0.78rem', width: '100%' }} onClick={reset}>
                  Try again
                </button>
              </>
            )}
          </div>
        </div>

        {/* Independent audit result */}
        {report && status === 'verified' && (
          <div className="neu-well" style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.9rem' }}>Independent audit · {report.totalDurationMs} ms</span>
              <StatusBadge tone={report.overallValid ? 'ok' : 'warn'}>{report.overallValid ? 'ALL 5 GATES PASSED' : 'INTEGRITY BREACH'}</StatusBadge>
            </div>
            {report.gates.map((g) => (
              <div key={g.gateNumber} className="neu-kv">
                <span className="neu-kv-label">
                  Gate {g.gateNumber} · {g.gateName}
                </span>
                <span className={`neu-kv-value ${g.passed ? 'neu-tone-ok' : 'neu-tone-warn'}`}>{g.passed ? `PASS (${g.latencyMs} ms)` : 'FAIL'}</span>
              </div>
            ))}
            <span style={{ fontSize: '0.72rem', color: 'var(--fg-muted)' }}>
              Confidential bytes disclosed to this site: <strong>0</strong>. Only the receipt and the flattened, non-extractable PDF were received.
            </span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.72rem', color: 'var(--fg-dim)' }}>
          <KeyRound size={12} />
          <span>Each verification issues a fresh challenge nonce bound into the proof session — a bundle cannot be replayed for a different booking.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.74rem', color: 'var(--fg-muted)', flexWrap: 'wrap' }}>
          <span>Add this to your own site:</span>
          <code className="neu-hash-pill" style={{ fontSize: '0.68rem' }}>&lt;script src="{window.location.origin}/sdk/zeroara.js"&gt;&lt;/script&gt;</code>
          <a href="/demo/index.html" target="_blank" rel="noreferrer" className="neu-pill-btn" style={{ fontSize: '0.7rem', padding: '3px 9px', textDecoration: 'none' }}>
            Open the integration playground ↗
          </a>
        </div>
      </div>

      <Drawer open={showReceipt} title="Cryptographic receipt (audit package)" onClose={() => setShowReceipt(false)}>
        {result && (
          <>
            <KV label="Master audit seal" value={formatChunkedHash(result.pkg.masterAuditSeal.sealHex)} />
            <pre className="neu-code-block" style={{ maxHeight: '52vh', overflow: 'auto', fontSize: '0.7rem' }}>
              {JSON.stringify(result.pkg, null, 2)}
            </pre>
          </>
        )}
      </Drawer>
    </div>
  );
}
