import React, { useState } from 'react';
import { Radio, ExternalLink } from 'lucide-react';
import { buildZeroaraDeepLink } from './transportEngine';

interface TransportProtocolViewProps {
  onBackToStudio?: () => void;
  onNavigateToStage?: (stage: number) => void;
}

export const TransportProtocolView: React.FC<TransportProtocolViewProps> = ({
  onNavigateToStage,
}) => {
  const [simulatedOrigin, setSimulatedOrigin] = useState('https://apex-lending.io');
  const [threshold, setThreshold] = useState(150000);
  const [generatedUri, setGeneratedUri] = useState('');

  const handleGenerateUri = () => {
    const nonce = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(24))).map((b) => b.toString(16).padStart(2, '0')).join('');
    setGeneratedUri(
      buildZeroaraDeepLink({
        version: 1,
        requestId: 'req_' + Array.from(crypto.getRandomValues(new Uint8Array(6))).map((b) => b.toString(16).padStart(2, '0')).join(''),
        requester: 'Apex Lending & Capital Markets',
        purpose: 'Accredited-investor onboarding',
        document: 'income_accredited',
        claim: { field: 'Annual income', op: '>=', value: threshold, unit: 'USD' },
        nonce,
        issuedAt: new Date().toISOString(),
        callbackUrl: `${simulatedOrigin}/api/verify/callback`,
        wantRedactedPdf: true,
      })
    );
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Blank Section Placeholder Card */}
      <div className="neu-card" style={{ padding: '40px 32px', borderRadius: '28px', alignItems: 'center', textAlign: 'center', gap: '20px' }}>
        <div
          style={{
            width: '72px',
            height: '72px',
            borderRadius: '50%',
            backgroundColor: 'var(--bg-surface)',
            boxShadow: 'var(--shadow-extruded)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent)',
          }}
        >
          <Radio size={38} />
        </div>

        <div style={{ maxWidth: '560px' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 800, color: 'var(--fg-primary)' }}>
            Web-to-Desktop Transport Protocol Scaffolded
          </h3>
          <p style={{ fontSize: '0.86rem', color: 'var(--fg-muted)', lineHeight: '1.6', marginTop: '8px' }}>
            This layer defines how external websites (KYC portals, exchanges, loan application forms) invoke the local Zeroara desktop app without ever handling raw documents. Target milestone: <strong>v0.4</strong>.
          </p>
        </div>

        {/* Interactive Handshake URI Simulator */}
        <div className="neu-well" style={{ maxWidth: '860px', width: '100%', padding: '20px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--fg-primary)' }}>
              Simulate External Website Verification Request
            </span>
            <span className="neu-claim-badge">PROTOCOL SPECIFICATION</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '0.74rem', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                Requester Website Domain
              </label>
              <input
                type="text"
                className="neu-input"
                value={simulatedOrigin}
                onChange={(e) => setSimulatedOrigin(e.target.value)}
                style={{ padding: '8px 12px', fontSize: '0.8rem' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.74rem', color: 'var(--fg-muted)', display: 'block', marginBottom: '4px' }}>
                Required Threshold ($ USD)
              </label>
              <input
                type="number"
                className="neu-input"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                style={{ padding: '8px 12px', fontSize: '0.8rem' }}
              />
            </div>
          </div>

          <button
            type="button"
            className="neu-btn-primary"
            style={{ fontSize: '0.82rem', padding: '10px 16px', gap: '6px', alignSelf: 'flex-start' }}
            onClick={handleGenerateUri}
          >
            <ExternalLink size={13} />
            <span>Generate zeroara:// Deep-Link URI</span>
          </button>

          {generatedUri && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                Synthesized Deep-Link Scheme:
              </span>
              <div className="neu-code-block" style={{ fontSize: '0.74rem', maxHeight: '100px', overflowY: 'auto' }}>
                {generatedUri}
              </div>
            </div>
          )}
        </div>

        {onNavigateToStage && (
          <button
            type="button"
            className="neu-btn-secondary"
            style={{ fontSize: '0.82rem', padding: '10px 18px', gap: '6px', alignSelf: 'center', marginTop: '6px' }}
            onClick={() => onNavigateToStage(1)}
          >
            <span>← Return to Stage 1: Document Ingestion</span>
          </button>
        )}
      </div>
    </div>
  );
};
