import { useEffect, useState } from 'react';
import { ArrowRight, Copy, Check, KeyRound, ScanLine, Flame, Cpu, Fingerprint, ExternalLink } from 'lucide-react';
import { navigate } from './router';

/* Landing page: intro word, hero with two actions, how it works, integration. */

let introPlayed = false; // play the intro once per page load, not on every route change

const STEPS: { icon: React.ReactNode; title: string; text: string }[] = [
  { icon: <KeyRound size={15} />, title: 'Ask', text: 'Your site states the claim — say, Age ≥ 18 — with a one-time nonce.' },
  { icon: <ScanLine size={15} />, title: 'Read locally', text: 'Zeroara opens on the user’s device and reads the document there. Nothing is uploaded.' },
  { icon: <Flame size={15} />, title: 'Burn', text: 'Every sensitive field is blacked out in the pixels. The PDF is flattened; no text layer survives.' },
  { icon: <Cpu size={15} />, title: 'Prove', text: 'A Groth16 zero-knowledge proof shows the claim holds without revealing the value.' },
  { icon: <Fingerprint size={15} />, title: 'Seal & return', text: 'One seal binds document, boxes, commitment and proof. Your site gets the outcome, the proof, the seal and a redacted PDF.' },
];

const DOCUMENTS: { id: string; claim: string | null }[] = [
  { id: 'aadhaar', claim: 'age' },
  { id: 'income_accredited', claim: 'income' },
  { id: 'salary_slip', claim: 'net pay' },
  { id: 'bank_statement', claim: 'balance' },
  { id: 'tax_form', claim: 'declared income' },
  { id: 'generic_financial', claim: 'amount' },
  { id: 'pan', claim: null },
  { id: 'college_id', claim: null },
  { id: 'generic_id', claim: null },
];

const SPECIMENS: { file: string; label: string }[] = [
  { file: 'Aadhaar_SPECIMEN_sample.png', label: 'Aadhaar card' },
  { file: 'PAN_Card_SPECIMEN_sample.png', label: 'PAN card' },
  { file: 'College_ID_SPECIMEN_sample.png', label: 'College ID' },
  { file: 'Identity_Card_SPECIMEN_sample.png', label: 'Generic ID' },
  { file: 'Bank_Statement_SPECIMEN_sample.pdf', label: 'Bank statement' },
  { file: 'Salary_Slip_SPECIMEN_sample.pdf', label: 'Salary slip' },
  { file: 'Form16_SPECIMEN_sample.pdf', label: 'Tax form (Form 16)' },
  { file: 'Invoice_SPECIMEN_sample.pdf', label: 'Invoice (generic financial)' },
  { file: 'Accredited_Investor_Verification_ApexLP.pdf', label: 'Income certificate' },
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

  useEffect(() => {
    if (intro !== 'playing') return;
    introPlayed = true;
    const t = window.setTimeout(() => setIntro('done'), 2300);
    return () => window.clearTimeout(t);
  }, [intro]);

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
            <img src="/logo.png" alt="" style={{ width: '30px', height: '30px', objectFit: 'contain', filter: 'drop-shadow(0 2px 4px rgba(234, 88, 12, 0.3))' }} />
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
        <section className="landing-hero">
          <span className="neu-badge">Provable redaction · zero-knowledge</span>
          <h1>
            Prove the fact.
            <br />
            Keep the document.
          </h1>
          <p>
            Zeroara lets your website confirm a condition about an ID or financial document — age, income, balance — without ever receiving it. Everything happens on the user’s device.
          </p>
          <div className="landing-actions">
            <button type="button" className="neu-btn-primary" onClick={scrollToIntegrate}>
              Add Zeroara to my website
            </button>
            <button type="button" className="neu-btn-secondary" onClick={openApp}>
              Product demo <ArrowRight size={16} />
            </button>
          </div>
          <span className="neu-hash-pill landing-note">0 bytes of document data leave the device</span>
        </section>

        {/* How it works */}
        <section id="how" className="landing-section">
          <h2>How it works</h2>
          <div className="landing-steps">
            {STEPS.map((s, i) => (
              <div key={s.title} className="neu-card landing-step">
                <span className="neu-check-icon neu-tone-active">{s.icon}</span>
                <span className="landing-step-n">0{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
          <div className="landing-pills">
            <span className="neu-claim-badge neu-tone-ok">You receive · the outcome, the proof, the seal, a redacted PDF</span>
            <span className="neu-claim-badge neu-tone-muted">You never receive · the document, its values, who the person is</span>
          </div>
        </section>

        {/* Integrate */}
        <section id="integrate" className="landing-section">
          <h2>Add Zeroara to your website</h2>
          <p className="landing-lead">Three steps. One script, no backend.</p>

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

          <div className="landing-docs">
            <span className="landing-docs-label">Document types</span>
            <div className="landing-pills">
              {DOCUMENTS.map((d) => (
                <span key={d.id} className="neu-hash-pill">
                  {d.id}
                  {d.claim ? ` · ${d.claim} ≥ n` : ' · seal-only'}
                </span>
              ))}
            </div>
          </div>

          <div className="landing-docs">
            <span className="landing-docs-label">Specimen documents for testing</span>
            <p className="landing-well" style={{ padding: 0, margin: 0, background: 'none', boxShadow: 'none', fontSize: '0.84rem', color: 'var(--fg-muted)' }}>
              Synthetic, clearly marked, one per document type. Use them as the “real file” when trying the flow from your own site.
            </p>
            <div className="landing-pills">
              {SPECIMENS.map((f) => (
                <a key={f.file} className="neu-hash-pill" href={`/specimens/${f.file}`} download style={{ textDecoration: 'none' }}>
                  {f.label}
                </a>
              ))}
            </div>
          </div>

          <div className="landing-links">
            <a className="neu-btn-secondary" href="/demo/index.html" target="_blank" rel="noreferrer">
              Playground <ExternalLink size={14} />
            </a>
            <a className="neu-btn-secondary" href="/sdk/zeroara.d.ts" target="_blank" rel="noreferrer">
              SDK types <ExternalLink size={14} />
            </a>
            <a className="neu-btn-secondary" href="https://github.com/CHOKI-CHOKI-C2C-26/zeroara/blob/main/docs/INTEGRATION.md" target="_blank" rel="noreferrer">
              Documentation <ExternalLink size={14} />
            </a>
          </div>
        </section>

        <footer className="landing-footer">
          <span>Zeroara · provable redaction protocol</span>
          <button type="button" onClick={openApp}>
            Open the app <ArrowRight size={12} />
          </button>
        </footer>
      </div>
      </div>
    </>
  );
}
