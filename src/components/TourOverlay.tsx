import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, X } from 'lucide-react';

/* Guided walkthrough for the verifier demo.
 *
 * Pure overlay: it never changes app behaviour. Each step spotlights one
 * element (found by its data-tour attribute), dims and blurs everything else,
 * and shows a single readable line saying what to do (DO) or what to look at
 * (SEE). Action steps advance on their own as soon as the app state shows the
 * action happened; observation steps advance with Next. */

export interface TourSnapshot {
  view: 'workspace' | 'demo';
  stage: number;
  hasRequest: boolean;
  hasDoc: boolean;
  ocrRunning: boolean;
  /** Local OCR/extraction failed for the loaded document. */
  ocrFailed: boolean;
  targets: number;
  hasRedaction: boolean;
  proofVerified: boolean;
  hasSeal: boolean;
  hasResult: boolean;
}

type DomProbe = (id: string) => boolean;

export interface TourStep {
  id: string;
  /** data-tour id of the element to spotlight. */
  target: string;
  view: 'demo' | 'workspace';
  /** Workspace stage the target lives in (used to steer the user back). */
  stage?: number;
  kind: 'do' | 'see';
  text: string;
  /** When present, the step completes on its own once this is true. */
  done?: (s: TourSnapshot, dom: DomProbe) => boolean;
  /** When present and true, the step cannot complete; `failText` replaces the text. */
  failed?: (s: TourSnapshot) => boolean;
  failText?: string;
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'cta', target: 'demo-cta', view: 'demo', kind: 'do', text: 'Click “Verify with Zeroara” — the site wants proof you are 18+ without ever seeing your ID.', done: (s) => s.hasRequest },
  { id: 'request', target: 'request-badge', view: 'workspace', kind: 'see', text: 'Zeroara opened with the site’s request: Age ≥ 18, Aadhaar card, and a one-time challenge nonce.' },
  { id: 'load', target: 'dropzone', view: 'workspace', stage: 1, kind: 'do', text: 'Load the specimen Aadhaar (or drop the front of your own card) — it is read on this device only.', done: (s) => s.hasDoc },
  { id: 'ocr', target: 'step-2', view: 'workspace', kind: 'see', text: 'Zeroara is reading the card locally — no upload, no server, just OCR inside your browser.', done: (s) => s.hasDoc && !s.ocrRunning && s.targets > 0, failed: (s) => s.hasDoc && !s.ocrRunning && s.ocrFailed, failText: 'Zeroara could not read this document. Press “Clear document” at the top and load the specimen Aadhaar again.' },
  { id: 'review', target: 'primary-action', view: 'workspace', stage: 1, kind: 'do', text: 'Click “Review detected targets” to see what Zeroara found on the card.', done: (s) => s.stage >= 2 },
  { id: 'boxes', target: 'canvas', view: 'workspace', stage: 2, kind: 'see', text: 'The boxes mark the exact pixels that will be blacked out: number, date of birth, name, gender, photo.' },
  { id: 'targets', target: 'targets', view: 'workspace', stage: 2, kind: 'see', text: 'Each target is classified: the date of birth is the private witness for the age proof, the rest is burned.' },
  { id: 'burn', target: 'primary-action', view: 'workspace', stage: 2, kind: 'do', text: 'Click “Burn & flatten” — every box becomes solid black and the PDF loses its text layer.', done: (s) => s.hasRedaction },
  { id: 'burned', target: 'canvas', view: 'workspace', stage: 3, kind: 'see', text: 'The burned card: nothing under a box can be recovered, because the pixels themselves were replaced.' },
  { id: 'prove', target: 'primary-action', view: 'workspace', stage: 3, kind: 'do', text: 'Click “Generate zero-knowledge proof” — it proves Age ≥ 18 from the birth date without revealing it.', done: (s) => s.proofVerified },
  { id: 'proof', target: 'proof-badge', view: 'workspace', stage: 4, kind: 'see', text: 'Proof Validated: a Groth16 proof checked in milliseconds — the birth date never left this device.' },
  { id: 'proof-details', target: 'proof-details', view: 'workspace', stage: 4, kind: 'see', text: 'The raw cryptography sits behind this button: commitment, session binding and the proof points.' },
  { id: 'seal', target: 'primary-action', view: 'workspace', stage: 4, kind: 'do', text: 'Click “Seal & bundle” — one master seal binds the redacted PDF, the boxes, the commitment and the proof.', done: (s) => s.hasSeal },
  { id: 'sealed', target: 'seal', view: 'workspace', stage: 5, kind: 'see', text: 'This is the master audit seal — change anything in the bundle and it will no longer recompute.' },
  { id: 'return', target: 'primary-action', view: 'workspace', stage: 5, kind: 'do', text: 'Click “Return to Aegis Rentals with proof” — only the redacted PDF and the receipt go back, never the original.', done: (s) => s.hasResult },
  { id: 'verified', target: 'demo-panel', view: 'demo', kind: 'see', text: 'Aegis Rentals sees “Identity & Age (18+) Verified” — and received 0 bytes of sensitive data.' },
  { id: 'audit', target: 'demo-audit', view: 'demo', kind: 'do', text: 'Click “Run independent 5-gate audit” — the site re-checks the proof and the seal by itself.', done: (_s, dom) => dom('demo-audit-result') },
  { id: 'audited', target: 'demo-audit-result', view: 'demo', kind: 'see', text: 'All five checks pass — fingerprint, boxes, commitment, proof and seal — without the original document.' },
];

const domHas: DomProbe = (id) => !!document.querySelector(`[data-tour="${id}"]`);
const PAD = 8;
const GAP = 14;
const MARGIN = 12;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Effective {
  target: string;
  kind: 'do' | 'see';
  text: string;
  interstitial: boolean;
  failed?: boolean;
}

/** Steer the user back when they are on a different view or stage. */
function resolveEffective(step: TourStep, s: TourSnapshot): Effective {
  if (s.view !== step.view) {
    return step.view === 'workspace'
      ? { target: 'nav-workspace', kind: 'do', text: 'Open the Workspace tab to continue inside Zeroara.', interstitial: true }
      : { target: 'nav-demo', kind: 'do', text: 'Open the Verifier demo tab to go back to Aegis Rentals.', interstitial: true };
  }
  if (step.view === 'workspace' && step.stage !== undefined && s.stage !== step.stage) {
    return { target: `step-${step.stage}`, kind: 'do', text: `Click step 0${step.stage} in the strip to return to this point.`, interstitial: true };
  }
  if (step.failed && step.failText && step.failed(s)) {
    return { target: step.target, kind: step.kind, text: step.failText, interstitial: false, failed: true };
  }
  return { target: step.target, kind: step.kind, text: step.text, interstitial: false };
}

function placeCard(box: Box | null, size: { w: number; h: number }, vw: number, vh: number) {
  const w = Math.min(480, vw - 24);
  const h = size.h;
  const clampL = (l: number) => Math.min(Math.max(MARGIN, l), Math.max(MARGIN, vw - w - MARGIN));
  const clampT = (t: number) => Math.min(Math.max(MARGIN, t), Math.max(MARGIN, vh - h - MARGIN));
  if (!box) return { top: clampT(vh / 2 - h / 2), left: clampL(vw / 2 - w / 2) };
  const cx = box.left + box.width / 2 - w / 2;
  const cy = box.top + box.height / 2 - h / 2;
  if (box.top + box.height + GAP + h <= vh - MARGIN) return { top: box.top + box.height + GAP, left: clampL(cx) };
  if (box.top - GAP - h >= MARGIN) return { top: box.top - GAP - h, left: clampL(cx) };
  if (box.left + box.width + GAP + w <= vw - MARGIN) return { top: clampT(cy), left: box.left + box.width + GAP };
  if (box.left - GAP - w >= MARGIN) return { top: clampT(cy), left: box.left - GAP - w };
  return { top: clampT(vh - h - MARGIN), left: clampL(cx) };
}

export function TourOverlay({
  run,
  paused = false,
  snapshot,
  onExit,
}: {
  /** 0 = off; any positive number starts (or restarts) the walkthrough. */
  run: number;
  /** Hide the overlay while another modal owns the screen. */
  paused?: boolean;
  snapshot: TourSnapshot;
  onExit: () => void;
}) {
  const active = run > 0;
  const [idx, setIdx] = useState(0);
  const [hold, setHold] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const [tick, setTick] = useState(0);
  const [cardSize, setCardSize] = useState({ w: 480, h: 150 });
  const cardRef = useRef<HTMLDivElement>(null);
  const scrolledKeyRef = useRef('');

  // (Re)start from the first step.
  useEffect(() => {
    if (run > 0) {
      setIdx(0);
      setHold(false);
      setBox(null);
      scrolledKeyRef.current = '';
    }
  }, [run]);

  // Re-measure and re-evaluate a few times a second while active.
  useEffect(() => {
    if (!active || paused) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 150);
    return () => window.clearInterval(id);
  }, [active, paused]);

  const finished = idx >= TOUR_STEPS.length;
  const step = TOUR_STEPS[Math.min(idx, TOUR_STEPS.length - 1)];
  const eff = resolveEffective(step, snapshot);
  const isLast = idx === TOUR_STEPS.length - 1;
  const satisfied = !!step.done && step.done(snapshot, domHas);

  // Move on, skipping every step whose condition is already satisfied.
  const advance = useCallback(() => {
    setHold(false);
    setIdx((i) => {
      let n = i + 1;
      while (n < TOUR_STEPS.length) {
        const d = TOUR_STEPS[n].done;
        if (d && d(snapshot, domHas)) n++;
        else break;
      }
      return n;
    });
  }, [snapshot]);

  const back = useCallback(() => {
    setHold(true);
    setIdx((i) => Math.max(0, i - 1));
  }, []);

  const skipStep = useCallback(() => {
    setHold(true);
    setIdx((i) => i + 1);
  }, []);

  useEffect(() => {
    if (active && finished) onExit();
  }, [active, finished, onExit]);

  // The request was cancelled mid-way: start over from the site's button.
  useEffect(() => {
    if (!active || paused) return;
    if (idx >= 1 && idx < 15 && !snapshot.hasRequest) {
      setIdx(0);
      setHold(false);
    }
  }, [active, paused, idx, snapshot.hasRequest]);

  // Auto-advance when the current step's condition becomes true. The condition
  // is about app state, so it counts even while the user is on a detour.
  useEffect(() => {
    if (!active || paused || hold || finished) return;
    if (satisfied) advance();
  }, [active, paused, hold, finished, satisfied, advance, tick]);

  // Measure the spotlight target.
  useLayoutEffect(() => {
    if (!active || paused) return;
    const el = document.querySelector(`[data-tour="${eff.target}"]`) as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    if (!el || !r || r.width === 0 || r.height === 0) {
      setBox((b) => (b === null ? b : null));
      return;
    }
    const key = `${idx}:${eff.target}`;
    if (scrolledKeyRef.current !== key) {
      scrolledKeyRef.current = key;
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    const next = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
    setBox((b) =>
      b && Math.abs(b.top - next.top) < 0.5 && Math.abs(b.left - next.left) < 0.5 && Math.abs(b.width - next.width) < 0.5 && Math.abs(b.height - next.height) < 0.5 ? b : next
    );
  }, [active, paused, eff.target, idx, tick]);

  // Measure the card so it can be placed without overlapping the spotlight.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCardSize((c) => (Math.abs(c.w - r.width) < 1 && Math.abs(c.h - r.height) < 1 ? c : { w: r.width, h: r.height }));
  });

  const waiting = eff.kind === 'do' || !!step.done;
  const showNext = !waiting || (hold && satisfied);

  useEffect(() => {
    if (!active || paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
      else if ((e.key === 'ArrowRight' || e.key === 'Enter') && showNext) {
        if (isLast) onExit();
        else advance();
      } else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, paused, showNext, isLast, advance, back, onExit]);

  if (!active || paused || finished) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pos = placeCard(box, cardSize, vw, vh);

  return (
    <>
      {box ? (
        <>
          <div className="tour-dim" style={{ top: 0, left: 0, right: 0, height: Math.max(0, box.top) }} />
          <div className="tour-dim" style={{ top: Math.max(0, box.top + box.height), left: 0, right: 0, bottom: 0 }} />
          <div className="tour-dim" style={{ top: Math.max(0, box.top), left: 0, width: Math.max(0, box.left), height: Math.max(0, box.height) }} />
          <div className="tour-dim" style={{ top: Math.max(0, box.top), left: Math.max(0, box.left + box.width), right: 0, height: Math.max(0, box.height) }} />
          <div className="tour-ring" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />
        </>
      ) : (
        <div className="tour-dim" style={{ inset: 0 }} />
      )}

      <div ref={cardRef} className="tour-card" role="dialog" aria-live="polite" aria-label="Guided walkthrough" style={{ top: pos.top, left: pos.left, width: Math.min(480, vw - 24) }}>
        <div className="tour-card-top">
          <span className={`tour-chip ${eff.kind}`}>{eff.kind === 'do' ? 'DO' : 'SEE'}</span>
          <span className="tour-progress">
            Step {Math.min(idx + 1, TOUR_STEPS.length)} of {TOUR_STEPS.length}
            {eff.interstitial ? ' · detour' : ''}
          </span>
          <button type="button" className="neu-pill-btn" style={{ padding: '4px 8px', display: 'flex' }} onClick={onExit} aria-label="End the walkthrough">
            <X size={13} />
          </button>
        </div>
        <p className="tour-text">{eff.text}</p>
        <div className="tour-actions">
          <button type="button" className="neu-pill-btn" style={{ fontSize: '0.72rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={back} disabled={idx === 0}>
            <ArrowLeft size={12} /> Back
          </button>
          {showNext ? (
            isLast ? (
              <button type="button" className="neu-btn-primary" style={{ padding: '8px 14px', fontSize: '0.8rem', gap: '6px' }} onClick={onExit}>
                Finish
              </button>
            ) : (
              <button type="button" className="neu-btn-primary" style={{ padding: '8px 14px', fontSize: '0.8rem', gap: '6px' }} onClick={advance}>
                Next <ArrowRight size={13} />
              </button>
            )
          ) : (
            <span className="tour-waiting">
              {eff.failed ? <span className="tour-dot" /> : eff.kind === 'see' ? <Loader2 size={13} className="spin" /> : <span className="tour-dot" />}
              {eff.failed ? 'Could not continue' : eff.kind === 'see' ? 'Working…' : 'Waiting for you…'}
            </span>
          )}
          {!showNext && !isLast && (
            <button type="button" className="tour-link" onClick={skipStep}>
              Skip this step
            </button>
          )}
          <button type="button" className="tour-link" style={{ marginLeft: 'auto' }} onClick={onExit}>
            End walkthrough
          </button>
        </div>
      </div>
    </>
  );
}
