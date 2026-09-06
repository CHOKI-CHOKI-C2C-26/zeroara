import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, UploadCloud, FileCheck, CheckCircle2, XCircle, Download, ArrowLeft, Loader2, Copy, Check, FlaskConical, Layers } from 'lucide-react';
import type { ZeroaraAuditPackage } from '../layer5_seal/types';
import type { VerifierAuditReport, TamperMode } from './types';
import { runEnterpriseAudit, createTamperedPackage } from './verifierEngine';
import { Accordion, KV, StatusBadge } from '../../components/ui';

interface VerifierPortalViewProps {
  initialPackage?: ZeroaraAuditPackage | null;
  onNavigateToStudio?: () => void;
  onNavigateToStage?: (stage: number) => void;
}

/* The five cryptographic gates, explained in plain English. The engine still
   reports the technical expected/actual values; they live in an accordion. */
const CHECKS: Record<number, { title: string; pass: (hasPdf: boolean, sealOnly: boolean) => string; fail: string }> = {
  1: {
    title: 'The redacted document matches its fingerprint',
    pass: (hasPdf) =>
      hasPdf
        ? 'The PDF you added hashes to exactly the fingerprint recorded in the package.'
        : 'The recorded fingerprint is intact. Add the redacted PDF to check it against the actual file.',
    fail: 'The PDF you added is not the file that was sealed.',
  },
  2: {
    title: 'The black boxes are recorded correctly',
    pass: () => 'Every redaction zone has a valid position and size inside the page.',
    fail: 'A redaction zone has an impossible position or size.',
  },
  3: {
    title: 'The hidden value is locked in',
    pass: (_p, sealOnly) =>
      sealOnly ? 'Not needed: this document type carries no hidden numeric value.' : 'A commitment pins the private value so it cannot be swapped after the fact.',
    fail: 'The commitment to the private value is missing or malformed.',
  },
  4: {
    title: 'The zero-knowledge proof checks out',
    pass: (_p, sealOnly) =>
      sealOnly
        ? 'Not needed: no numeric claim was made for this document.'
        : 'The proof verifies against the public verification key, so the claim is true without revealing the value.',
    fail: 'The proof does not verify. It was altered, forged, or the claim is false.',
  },
  5: {
    title: 'The master seal recomputes exactly',
    pass: () => 'Fingerprint, boxes, commitment and proof recombine into the recorded seal, so none of them was changed.',
    fail: 'Recomputing the seal gives a different value: something in the package was changed.',
  },
};

const TAMPER_OPTIONS: { mode: TamperMode; label: string }[] = [
  { mode: 'GEOMETRY_SHIFT', label: 'Move a black box by 1 px' },
  { mode: 'PROOF_MUTATION', label: 'Change one number in the proof' },
  { mode: 'COMMITMENT_FORGERY', label: 'Forge the commitment' },
  { mode: 'DOCUMENT_HASH_CORRUPTION', label: 'Change the document fingerprint' },
];

export const VerifierPortalView: React.FC<VerifierPortalViewProps> = ({ initialPackage, onNavigateToStage }) => {
  const [pkg, setPkg] = useState<ZeroaraAuditPackage | null>(initialPackage ?? null);
  const [report, setReport] = useState<VerifierAuditReport | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [tamper, setTamper] = useState<TamperMode>('NONE');
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pdfBytesRef = useRef<Uint8Array | undefined>(undefined);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const audit = async (target: ZeroaraAuditPackage) => {
    setAuditing(true);
    try {
      setReport(await runEnterpriseAudit(target, pdfBytesRef.current));
    } finally {
      setAuditing(false);
    }
  };

  useEffect(() => {
    if (initialPackage) {
      setPkg(initialPackage);
      setTamper('NONE');
      void audit(initialPackage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPackage]);

  const loadJson = async (file: File) => {
    setLoadError(null);
    try {
      const parsed = JSON.parse(await file.text()) as ZeroaraAuditPackage;
      if (!parsed?.masterAuditSeal?.sealHex || !parsed?.sanitizedDocument) {
        setLoadError('That file is not a Zeroara audit package.');
        return;
      }
      setPkg(parsed);
      setTamper('NONE');
      void audit(parsed);
    } catch {
      setLoadError('Could not read that file as JSON.');
    }
  };

  const loadPdf = async (file: File) => {
    pdfBytesRef.current = new Uint8Array(await file.arrayBuffer());
    setPdfName(file.name);
    if (pkg) void audit(tamper === 'NONE' ? pkg : createTamperedPackage(pkg, tamper));
  };

  const applyTamper = (mode: TamperMode) => {
    if (!pkg) return;
    setTamper(mode);
    void audit(mode === 'NONE' ? pkg : createTamperedPackage(pkg, mode));
  };

  const downloadReceipt = () => {
    if (!report || !pkg) return;
    const receipt = {
      title: 'Zeroara verification receipt',
      verifiedAt: report.auditTimestamp,
      genuine: report.overallValid,
      package: report.packageMetadata,
      checks: report.gates,
      confidentialBytesDisclosed: 0,
      verifier: 'Zeroara in-browser verifier (no server involved)',
    };
    const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Zeroara_Verification_Receipt_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const sealOnly = !!pkg && (pkg.redactionMode === 'SEAL_ONLY' || !pkg.zeroKnowledgeProof);
  const claimText = pkg
    ? sealOnly
      ? 'No numeric claim — only the redaction is sealed'
      : `${pkg.enterpriseRequirement.targetField} is at least ${pkg.enterpriseRequirement.thresholdValue.toLocaleString()} ${pkg.enterpriseRequirement.currency}`.trim()
    : '';
  const failed = report ? report.gates.filter((g) => !g.passed).map((g) => g.gateNumber) : [];
  const verdict = !report
    ? null
    : report.overallValid
      ? {
          ok: true,
          title: sealOnly ? 'Genuine. The redaction is sealed.' : 'Genuine, and the claim holds.',
          sub: sealOnly ? 'Nothing in this package changed since it was sealed. No numeric claim was made.' : `${claimText}. Proven without revealing the value.`,
        }
      : {
          ok: false,
          title: 'Rejected. This package was altered or forged.',
          sub: `Check${failed.length > 1 ? 's' : ''} ${failed.join(' and ')} failed. Nothing it says can be trusted.`,
        };
  const tamperLabel = TAMPER_OPTIONS.find((t) => t.mode === tamper)?.label;

  return (
    <div className="workspace-grid">
      <input type="file" ref={jsonInputRef} accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && loadJson(e.target.files[0])} />
      <input type="file" ref={pdfInputRef} accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && loadPdf(e.target.files[0])} />

      {/* Left: what is being verified */}
      <div className="neu-card pane" style={{ padding: '18px', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.95rem', color: 'var(--fg-primary)' }}>
            <Layers size={17} style={{ color: 'var(--accent)' }} />
            What is being verified
          </span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button type="button" className="neu-pill-btn" style={{ fontSize: '0.7rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => jsonInputRef.current?.click()}>
              <UploadCloud size={12} /> {pkg ? 'Load another package' : 'Load a package (.json)'}
            </button>
            {pkg && (
              <button type="button" className="neu-pill-btn" style={{ fontSize: '0.7rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => pdfInputRef.current?.click()}>
                <FileCheck size={12} /> {pdfName ? 'Replace the redacted PDF' : 'Add the redacted PDF'}
              </button>
            )}
          </div>
        </div>
        <p style={{ fontSize: '0.76rem', color: 'var(--fg-muted)' }}>
          This page checks a Zeroara audit package on its own. It never needs the original document or the private value, only the receipt and, optionally, the redacted PDF.
        </p>
        {loadError && <span style={{ fontSize: '0.76rem', color: 'var(--accent-rose)' }}>{loadError}</span>}

        <div className="pane-scroll" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {!pkg ? (
            <div className="neu-dropzone fill" onClick={() => jsonInputRef.current?.click()} style={{ minHeight: '240px' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-extruded)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                <UploadCloud size={26} />
              </div>
              <div>
                <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 800 }}>Load an audit package</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--fg-muted)', marginTop: '6px', maxWidth: '360px' }}>
                  The .json receipt Zeroara produces at the seal step. Finish a document in the workspace and it appears here automatically.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="neu-well" style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <KV label="Requested by" value={pkg.enterpriseRequirement.requesterName} mono={false} />
                <KV label="Purpose" value={pkg.enterpriseRequirement.purpose} mono={false} />
                <KV label="Document" value={pkg.scenario?.label ?? pkg.enterpriseRequirement.documentCategory ?? '—'} mono={false} />
                <KV label="Claim" value={claimText} mono={false} />
                <KV label="How it was proven" value={sealOnly ? 'Redaction sealed, no proof' : 'Zero-knowledge proof + seal'} mono={false} />
                <KV label="Black boxes" value={`${pkg.sanitizedDocument.burnedBoundingBoxes.length} zones`} />
                <KV label="Redacted file" value={pdfName ?? `${pkg.sourceDocument.fileName} (not attached)`} mono={false} />
              </div>

              <div className="neu-well" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--fg-muted)' }}>Master audit seal</span>
                  <button
                    type="button"
                    className="neu-pill-btn"
                    style={{ fontSize: '0.68rem', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    onClick={() => {
                      navigator.clipboard.writeText(pkg.masterAuditSeal.sealHex);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? <Check size={11} className="neu-tone-ok" /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="neu-code-block" style={{ fontSize: '0.7rem' }}>{pkg.masterAuditSeal.sealHex}</div>
              </div>

              <div className="neu-well" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 800, color: 'var(--fg-primary)' }}>
                  <FlaskConical size={14} style={{ color: 'var(--accent)' }} /> Try to break it
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--fg-muted)' }}>Change one thing in the package and watch the checks catch it. The original is never modified.</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {TAMPER_OPTIONS.map((t) => (
                    <button key={t.mode} type="button" className={`neu-pill-btn ${tamper === t.mode ? 'active' : ''}`} style={{ fontSize: '0.7rem', padding: '4px 10px' }} onClick={() => applyTamper(t.mode)}>
                      {t.label}
                    </button>
                  ))}
                  {tamper !== 'NONE' && (
                    <button type="button" className="neu-pill-btn" style={{ fontSize: '0.7rem', padding: '4px 10px', color: 'var(--accent-secondary)' }} onClick={() => applyTamper('NONE')}>
                      Restore the original
                    </button>
                  )}
                </div>
                {tamper !== 'NONE' && report && (
                  <span style={{ fontSize: '0.74rem', color: failed.length ? 'var(--accent-rose)' : 'var(--fg-muted)' }}>
                    {tamperLabel}: {failed.length ? `check${failed.length > 1 ? 's' : ''} ${failed.join(' and ')} now fail.` : 'no check failed.'}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right: the result */}
      <div className="neu-card pane" style={{ padding: '18px', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.95rem', color: 'var(--fg-primary)' }}>
            <ShieldCheck size={17} style={{ color: report?.overallValid ? 'var(--accent-secondary)' : 'var(--accent)' }} />
            Result
          </span>
          {report && <span className="neu-hash-pill">checked in {report.totalDurationMs} ms</span>}
        </div>

        <div className="pane-scroll" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {auditing ? (
            <StatusBadge tone="active">
              <Loader2 size={13} className="spin" /> Running the five checks…
            </StatusBadge>
          ) : !report || !verdict ? (
            <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted)' }}>Load a package to see the result.</span>
          ) : (
            <>
              <div className={verdict.ok ? 'neu-verified-well' : 'neu-well-deep'} style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                {verdict.ok ? <CheckCircle2 size={26} style={{ color: 'var(--accent-secondary)', flexShrink: 0 }} /> : <XCircle size={26} style={{ color: 'var(--accent-rose)', flexShrink: 0 }} />}
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.95rem', color: verdict.ok ? 'var(--accent-secondary)' : 'var(--accent-rose)' }}>{verdict.title}</div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--fg-muted)' }}>{verdict.sub}</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {report.gates.map((g) => {
                  const copy = CHECKS[g.gateNumber];
                  return (
                    <div key={g.gateNumber} className="neu-check-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                      <span className={`neu-check-icon ${g.passed ? 'neu-tone-ok' : 'neu-tone-warn'}`} style={{ width: '26px', height: '26px' }}>
                        {g.passed ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.8rem', color: 'var(--fg-primary)' }}>
                          {g.gateNumber}. {copy?.title ?? g.gateName}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--fg-muted)' }}>{g.passed ? copy?.pass(!!pdfName, sealOnly) ?? g.details : copy?.fail ?? g.details}</span>
                      </span>
                      <span className={`neu-hash-pill ${g.passed ? 'neu-tone-ok' : 'neu-tone-warn'}`} style={{ fontSize: '0.64rem', flexShrink: 0 }}>
                        {g.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                  );
                })}
              </div>

              <span style={{ fontSize: '0.72rem', color: 'var(--fg-muted)' }}>
                What this verifier never saw: the original document, the private value, or who the person is. <strong>0 bytes</strong> of confidential data.
              </span>

              <Accordion title="Technical details" summary="expected vs actual">
                {report.gates.map((g) => (
                  <div key={g.gateNumber} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--fg-primary)' }}>
                      Gate {g.gateNumber} · {g.gateName} · {g.latencyMs} ms
                    </span>
                    <KV label="Expected" value={g.expectedValue} />
                    <KV label="Actual" value={g.actualValue} />
                  </div>
                ))}
              </Accordion>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button type="button" className="neu-btn-primary" style={{ padding: '10px 14px', fontSize: '0.8rem', gap: '8px' }} onClick={downloadReceipt}>
                  <Download size={14} /> <span>Download verification receipt</span>
                </button>
                {onNavigateToStage && (
                  <button type="button" className="neu-btn-secondary" style={{ padding: '10px 14px', fontSize: '0.8rem', gap: '8px' }} onClick={() => onNavigateToStage(5)}>
                    <ArrowLeft size={14} /> <span>Back to the workspace</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
