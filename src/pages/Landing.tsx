import { useEffect, useState, useRef } from 'react';
import { ArrowRight, Copy, Check, Terminal, FileText, X } from 'lucide-react';
import { navigate } from './router';

/* Landing page: intro word, hero with Spline interactive element, educational protocol breakdown, integration. */

let introPlayed = false; // play the intro once per page load, not on every route change

const MASTER_PROMPT = `Integrate Zeroara into this website. Zeroara is a 100% client-side provable document redaction and zero-knowledge verification engine that verifies claims without receiving or exposing raw documents.

### 1. Script Tag Inclusion
Add the Zeroara client SDK to your page or layout:
<script src="https://zeroara.vercel.app/sdk/zeroara.js"></script>

If loading dynamically in a React / Next.js component:
\`\`\`javascript
await new Promise((resolve, reject) => {
  if (window.Zeroara) return resolve();
  const script = document.createElement('script');
  script.src = 'https://zeroara.vercel.app/sdk/zeroara.js';
  script.async = true;
  script.onload = resolve;
  script.onerror = reject;
  document.head.appendChild(script);
});
\`\`\`

### 2. Request Verification
Call Zeroara.verify() from a user action (e.g. clicking a verification button):
\`\`\`javascript
const result = await window.Zeroara.verify({
  document: 'aadhaar',                                         // 'aadhaar' | 'income_accredited' | 'salary_slip' | 'bank_statement' | 'tax_form'
  claim: { field: 'Age', op: '>=', value: 18, unit: 'years' }, // what must hold
  requester: 'Your Company Name',                               // shown to the user
  purpose: 'Age verification for account activation',
});

if (result.ok) {
  // Cryptographic audit package (receipt):
  const auditBundle = result.bundle;
  
  // Flattened, burned PDF bytes (Uint8Array) with all PII permanently purged:
  const redactedPdfBytes = result.redactedPdfBytes;

  // Persist the proof & seal to your database or session:
  await saveVerification({
    requestId: auditBundle.enterpriseRequirement.requestId,
    nonce: auditBundle.enterpriseRequirement.challengeNonce,
    proof: auditBundle.zeroKnowledgeProof,
    masterSeal: auditBundle.masterAuditSeal,
    redactedDocSha256: auditBundle.redactedDocumentDigestSha256,
  });
} else {
  console.warn('Verification incomplete or rejected:', result.error);
}
\`\`\`

### 3. Client-Side Cryptographic Audit (Trust, then verify)
Independently verify the audit package without server calls:
\`\`\`javascript
const report = await window.Zeroara.audit(result.bundle);
if (report.overallValid) {
  // All checks passed: Nonce match, Document digest, Geometry commitment, Groth16 ZK proof, Master Audit Seal
  console.log('Zero-knowledge verification confirmed.');
}
\`\`\`

### 4. Drop-In UI Mount (Alternative)
To render a pre-styled "Verify with Zeroara" trigger button:
\`\`\`javascript
window.Zeroara.mount('#verify-btn-container', {
  document: 'aadhaar',
  claim: { field: 'Age', op: '>=', value: 18, unit: 'years' },
  requester: 'Your Company Name',
  purpose: 'Age verification',
  onResult: (result) => {
    if (result.ok) handleVerified(result.bundle);
  },
});
\`\`\`

### Security Rules:
- Zero unredacted document data ever leaves the user's browser memory.
- Always check that result.bundle.enterpriseRequirement.challengeNonce matches your session challenge to prevent replay attacks.`;

interface ProtocolStage {
  step: string;
  title: string;
  description: string;
  math: string;
}

const PROTOCOL_STAGES: ProtocolStage[] = [
  {
    step: 'STAGE 01',
    title: 'Challenge Formulation & Nonce Commitment',
    description:
      'The relying party specifies the inequality predicate P and issues an ephemeral, cryptographically secure random nonce to prevent replay attacks.',
    math: 'Session Context = (r, RequesterID, v_threshold, τ)   where r ∈ {0, 1}²⁵⁶',
  },
  {
    step: 'STAGE 02',
    title: 'Client-Side Ingest & Preimage Digest',
    description:
      'The raw document bytes D are processed strictly in client-side memory. A SHA-256 root digest binds the original unaltered state before any redaction or extraction occurs.',
    math: 'H_orig = SHA-256(Preimage) = SHA-256(D)   [0 network bytes transmitted]',
  },
  {
    step: 'STAGE 03',
    title: 'Physical Pixel Burning & Text Stream Stripping',
    description:
      'Target bounding boxes are permanently overwritten with black pixels in the raster matrix. All vector operators, text glyph layers, and metadata dictionaries are flattened and purged.',
    math: 'I_redacted(x, y) = 0 if (x, y) ∈ ⋃ B_i, else I_orig(x, y)\nH_redacted = SHA-256(Flatten(I_redacted))',
  },
  {
    step: 'STAGE 04',
    title: 'Groth16 Zero-Knowledge Predicate Prover',
    description:
      'An arithmetic R1CS circuit over the BN254 / alt_bn128 curve evaluates the private scalar witness without disclosing it, yielding a succinct 3-element cryptographic proof.',
    math: 'Circuit: { w - v_threshold - Δ = 0, Δ ∈ [0, 2ᵏ - 1] }\nProof π = (A ∈ 𝔾₁, B ∈ 𝔾₂, C ∈ 𝔾₁)\ne(A, B) = e(α, β) · e(x · γ, δ) · e(C, δ)',
  },
  {
    step: 'STAGE 05',
    title: 'Quad-Factor Master Audit Seal',
    description:
      'A deterministic master hash binds the original document preimage, redacted document, bounding box geometry, ZK proof, and session nonce into a single tamper-evident seal.',
    math: 'σ_seal = SHA-256(H_orig ∥ H_redacted ∥ H_boxes ∥ H_proof ∥ r)',
  },
];

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="landing-code">
      <span className="landing-code-lang">{lang}</span>
      <pre className="neu-code-block landing-pre">{code}</pre>
      <button
        type="button"
        className="neu-pill-btn landing-copy"
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
        aria-label="Copy"
      >
        {copied ? <Check size={12} className="neu-tone-ok" /> : <Copy size={12} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}

export function Landing() {
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [intro, setIntro] = useState<'playing' | 'done'>(introPlayed || reduceMotion ? 'done' : 'playing');
  const splineRef = useRef<HTMLIFrameElement>(null);

  const focusSpline = () => {
    try {
      if (document.activeElement !== splineRef.current) {
        splineRef.current?.focus({ preventScroll: true });
        splineRef.current?.contentWindow?.focus();
      }
    } catch {}
  };

  useEffect(() => {
    if (intro !== 'playing') return;
    introPlayed = true;
    const t = window.setTimeout(() => setIntro('done'), 2300);
    return () => window.clearTimeout(t);
  }, [intro]);

  useEffect(() => {
    if (intro === 'done') {
      const t = setTimeout(focusSpline, 300);
      return () => clearTimeout(t);
    }
  }, [intro]);

  // Proximity auto-focus: when cursor approaches or enters the Spline area, focus automatically
  useEffect(() => {
    const handleProximity = (e: MouseEvent) => {
      if (!splineRef.current) return;
      const rect = splineRef.current.getBoundingClientRect();
      if (
        e.clientX >= rect.left - 80 &&
        e.clientX <= rect.right + 80 &&
        e.clientY >= rect.top - 80 &&
        e.clientY <= rect.bottom + 80
      ) {
        focusSpline();
      }
    };
    window.addEventListener('mousemove', handleProximity, { passive: true });
    return () => window.removeEventListener('mousemove', handleProximity);
  }, []);

  const [showPromptModal, setShowPromptModal] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  const copyMasterPrompt = () => {
    navigator.clipboard.writeText(MASTER_PROMPT);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 1600);
  };

  useEffect(() => {
    if (!showPromptModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowPromptModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPromptModal]);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://zeroara.vercel.app';
  const scrollToIntegrate = () => document.getElementById('integrate')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  const openApp = () => navigate('/app');

  const scriptSnippet = `<script src="${origin}/sdk/zeroara.js"></script>`;
  const verifySnippet = `const result = await Zeroara.verify({
  document: 'aadhaar',                                          // what the user holds
  claim: { field: 'Age', op: '>=', value: 18, unit: 'years' },  // what must be true
  requester: 'Your company',                                    // shown to the user
  purpose: 'Why you need it',
});

if (result.ok) {
  result.bundle;            // the receipt — store it
  result.redactedPdfBytes;  // the black-boxed PDF — keep it if you must
}`;
  const auditSnippet = `const report = await Zeroara.audit(result.bundle); // five cryptographic checks, in the browser
report.overallValid;                                 // true when nothing was altered`;
  const mountSnippet = `Zeroara.mount('#verify', {
  document: 'aadhaar',
  claim: { field: 'Age', op: '>=', value: 18, unit: 'years' },
  requester: 'Your company',
  onResult: (r) => console.log(r.ok),
});`;
  const desktopSnippet = `Zeroara.verify({ mode: 'desktop', api: '${origin}', document: 'aadhaar', claim: { op: '>=', value: 18 } });`;

  return (
    <>
      {intro === 'playing' && (
        <div className="intro-overlay" aria-hidden="true">
          <div className="intro-word">ZEROARA</div>
        </div>
      )}

      <div className="landing-viewport">
        <div className={`landing-shell ${intro === 'done' ? 'landing-enter' : 'landing-hidden'}`}>
          {/* Top bar */}
          <header className="landing-top">
            <div className="landing-brand">
              <img src="/logo.png" alt="" style={{ width: '30px', height: '30px', objectFit: 'contain' }} />
              <span>ZEROARA</span>
            </div>
            <nav className="landing-nav">
              <a href="#how">How it works</a>
              <a href="#integrate">Integrate</a>
              <button type="button" onClick={openApp}>
                Product demo <ArrowRight size={13} />
              </button>
            </nav>
          </header>

          {/* Hero */}
          <section className="landing-hero" onMouseMove={focusSpline}>
            <div className="landing-hero-content">
              <h1>
                Prove the fact.
                <br />
                Keep the document.
              </h1>
              <div className="landing-actions">
                <button type="button" className="neu-btn-primary" onClick={scrollToIntegrate}>
                  Add Zeroara to my website
                </button>
                <button type="button" className="neu-btn-secondary" onClick={openApp}>
                  Product demo <ArrowRight size={16} />
                </button>
              </div>
            </div>

            <div
              className="landing-hero-spline"
              aria-label="Interactive 3D radial pattern"
              onMouseEnter={focusSpline}
              onMouseMove={focusSpline}
            >
              <div className="landing-spline-inner">
                <iframe
                  ref={splineRef}
                  src="https://app.spline.design/file/67176acc-91e0-4626-a013-f2826707ec90?view=preview"
                  frameBorder="0"
                  title="Interactive 3D Scene"
                  allow="autoplay; fullscreen"
                  loading="eager"
                />
              </div>
              {/* White-ish illumination tint */}
              <div className="landing-spline-tint" aria-hidden="true" />
              {/* Feathered gradient vignette overlay melting edges into page background */}
              <div className="landing-spline-vignette" aria-hidden="true" />
              {/* Top-right corner cover ensuring no buttons can show */}
              <div className="landing-spline-corner-cover" aria-hidden="true" />
            </div>
          </section>

          {/* How it works */}
          <section id="how" className="landing-section">
            <h2>How it works</h2>
            <p className="landing-lead">Cryptographic protocol specification and verification lifecycle.</p>

            <div className="landing-edu-flow">
              {PROTOCOL_STAGES.map((s) => (
                <div key={s.step} className="landing-edu-phase">
                  <div className="landing-edu-meta">
                    <span className="landing-edu-num">{s.step}</span>
                    <h3 className="landing-edu-title">{s.title}</h3>
                  </div>
                  <div className="landing-edu-body">
                    <p>{s.description}</p>
                    <pre className="landing-edu-math">{s.math}</pre>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Integrate */}
          <section id="integrate" className="landing-section">
            <h2>Add Zeroara to your website</h2>
            <p className="landing-lead">Three steps. One script, no backend.</p>

            <div className="landing-agent-box">
              <div className="landing-agent-copy-group">
                <span className="landing-agent-badge">
                  <Terminal size={13} />
                  <span>Coding Agent Integration</span>
                </span>
                <p className="landing-agent-desc">
                  Building with Cursor, Claude Code, Windsurf, or Copilot? Use this master prompt to let your coding agent wire Zeroara into your codebase in one turn.
                </p>
              </div>
              <div className="landing-agent-btns">
                <button
                  type="button"
                  className="neu-btn-secondary landing-agent-btn"
                  onClick={() => setShowPromptModal(true)}
                >
                  <FileText size={14} />
                  <span>View prompt</span>
                </button>
                <button
                  type="button"
                  className="neu-btn-primary landing-agent-btn"
                  onClick={copyMasterPrompt}
                >
                  {promptCopied ? <Check size={14} className="neu-tone-ok" /> : <Copy size={14} />}
                  <span>{promptCopied ? 'Copied' : 'Copy prompt'}</span>
                </button>
              </div>
            </div>

            <ol className="landing-howto">
              <li>
                <div className="landing-howto-head">
                  <span className="neu-check-icon neu-tone-active">1</span>
                  <h3>Load the SDK</h3>
                </div>
                <CodeBlock lang="html" code={scriptSnippet} />
              </li>
              <li>
                <div className="landing-howto-head">
                  <span className="neu-check-icon neu-tone-active">2</span>
                  <h3>Ask for the claim</h3>
                </div>
                <p>Call it from a click. Zeroara opens for the user, and the promise resolves with the receipt once they authorize the release.</p>
                <CodeBlock lang="js" code={verifySnippet} />
              </li>
              <li>
                <div className="landing-howto-head">
                  <span className="neu-check-icon neu-tone-active">3</span>
                  <h3>Trust, then verify</h3>
                </div>
                <p>The SDK already checks the nonce, the document type, the proof and the threshold. Re-run the five checks yourself whenever you like.</p>
                <CodeBlock lang="js" code={auditSnippet} />
              </li>
            </ol>

            <div className="landing-grid2">
              <div className="neu-well landing-well">
                <h3>Drop-in button</h3>
                <p>Renders “Verify with Zeroara” with a status line and a fallback link.</p>
                <CodeBlock lang="js" code={mountSnippet} />
              </div>
              <div className="neu-well landing-well">
                <h3>Desktop app &amp; verifier API</h3>
                <p>
                  For an installed Zeroara app: your server creates a session, the OS opens <code>zeroara://</code>, and the app posts the proof to your callback. This deployment serves the API at <code>/api/verify/*</code>.
                </p>
                <CodeBlock lang="js" code={desktopSnippet} />
              </div>
            </div>
          </section>
        </div>
      </div>

      {showPromptModal && (
        <div
          className="landing-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Coding Agent Master Integration Prompt"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPromptModal(false);
          }}
        >
          <div className="neu-card landing-modal-box">
            <div className="landing-modal-head">
              <div className="landing-modal-title">
                <Terminal size={17} />
                <h3>Coding Agent Master Prompt</h3>
              </div>
              <div className="landing-modal-actions">
                <button
                  type="button"
                  className="neu-btn-primary landing-modal-copy"
                  onClick={copyMasterPrompt}
                >
                  {promptCopied ? <Check size={13} className="neu-tone-ok" /> : <Copy size={13} />}
                  <span>{promptCopied ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  className="neu-pill-btn landing-modal-close"
                  onClick={() => setShowPromptModal(false)}
                  aria-label="Close"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
            <p className="landing-modal-desc">
              Feed this complete specification into Cursor, Windsurf, Claude Code, or Copilot. It gives the model the exact SDK contract, typing, error handling, and proof verification methods.
            </p>
            <pre className="neu-code-block landing-modal-pre">{MASTER_PROMPT}</pre>
          </div>
        </div>
      )}
    </>
  );
}
