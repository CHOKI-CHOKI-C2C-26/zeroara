import * as pdfjs from 'pdfjs-dist';
import {
  ExtractedSpatialToken,
  ClassifiedTarget,
  DocumentExtractionResult,
  OcrProgressFn,
} from './types';
import { preprocessForOcr } from './preprocess';
import {
  getScenario,
  DEFAULT_SCENARIO_ID,
  RE_CURRENCY as SCENARIO_CURRENCY,
  RE_DATE,
  RE_YEAR,
  type DocumentScenario,
} from '../../core/scenarios';

if (typeof window !== 'undefined' && (pdfjs as any)?.GlobalWorkerOptions) {
  // Wrapper worker: installs Uint8Array hex/base64 polyfills before pdf.js's own worker (see public/pdf.polyfills.mjs).
  (pdfjs as any).GlobalWorkerOptions.workerSrc = '/pdf.worker.entry.mjs';
}

// Rendering / OCR resolution controls
const DISPLAY_WIDTH = 900; // canvas + coordinate space presented to the UI
const OCR_SUPERSAMPLE = 2.0; // spec Stage 2: 2.0x viewport scale for OCR fidelity
const OCR_MAX_WIDTH = 2200; // hard cap to bound Tesseract Wasm memory
const TEXT_LAYER_MIN_TOKENS = 3; // fewer text items than this (and little text) => scanned page -> OCR
const TEXT_LAYER_MIN_CHARS = 24; // a page with this much real text is digital, not a scan

interface TesseractProfile {
  /** Local Tesseract language packs. Aadhaar commonly has both Hindi and English. */
  languages: string;
  /** Tesseract page segmentation mode; 11 is sparse text, suited to ID cards. */
  pageSegMode?: number;
}

function tesseractProfileForScenario(scenarioId?: string): TesseractProfile {
  // Do not impose Hindi-model memory/latency on every document. Aadhaar cards
  // commonly print Hindi next to English, and their scattered card layout
  // benefits from sparse-text segmentation. Other documents retain the
  // established English automatic-layout path.
  if (scenarioId === 'aadhaar') return { languages: 'eng+hin', pageSegMode: 11 };
  return { languages: 'eng' };
}

function tesseractEngineLabel(languages: string, source: 'Raster Image' | 'Scanned PDF'): string {
  const locale = languages === 'eng+hin' ? 'English + Hindi' : 'English';
  return `Tesseract LSTM · ${source} (OpenCV cleaned · ${locale})`;
}

interface RawOcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
}

// Aadhaar details may use Devanagari numerals. Normalizing them at the OCR
// boundary keeps the original pixels/geometry untouched while letting the
// existing number, Aadhaar-ID, and DOB detectors work consistently. Arabic
// numerals are included for other multilingual identity documents.
const INDIC_DIGIT_TO_ASCII: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

function normalizeOcrText(value: unknown): string {
  return String(value ?? '')
    .replace(/[०-९٠-٩]/g, (digit) => INDIC_DIGIT_TO_ASCII[digit] || digit)
    // OCR sometimes returns invisible joiners inside an otherwise valid field.
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function collectTesseractWords(data: any): RawOcrWord[] {
  const out: RawOcrWord[] = [];
  const push = (w: any) => {
    if (!w || !w.bbox) return;
    const text = normalizeOcrText(w.text);
    if (!text) return;
    out.push({
      text,
      x0: w.bbox.x0,
      y0: w.bbox.y0,
      x1: w.bbox.x1,
      y1: w.bbox.y1,
      confidence: typeof w.confidence === 'number' ? w.confidence : 0,
    });
  };

  if (Array.isArray(data?.words) && data.words.length > 0) {
    data.words.forEach(push);
    return out;
  }

  for (const block of data?.blocks || []) {
    for (const para of block?.paragraphs || []) {
      for (const line of para?.lines || []) {
        for (const w of line?.words || []) push(w);
      }
    }
  }
  return out;
}

async function runTesseract(
  image: HTMLCanvasElement,
  onProgress?: OcrProgressFn,
  profile: TesseractProfile = { languages: 'eng' }
): Promise<{ words: RawOcrWord[]; rawText: string; languages: string }> {
  const { createWorker } = await import('tesseract.js');
  const createLocalWorker = async (languages: string) =>
    createWorker(languages, 1, {
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract', // directory: tesseract.js v7 appends its own *.wasm.js core loader
      langPath: '/tesseract',
      gzip: true,
      logger: (m: any) => {
        if (onProgress && typeof m.progress === 'number') {
          onProgress(Math.round(m.progress * 100), m.status || 'recognizing');
        }
      },
    });

  const recognizeWith = async (languages: string) => {
    const worker: any = await createLocalWorker(languages);
    try {
      try {
        await worker.setParameters({
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
          tessedit_pageseg_mode: String(profile.pageSegMode ?? 3),
        });
      } catch (error) {
        // Parameter tuning is best-effort. Recognition remains available on an
        // older runtime even if it rejects a newer page-segmentation setting.
        console.warn('Tesseract parameter tuning was unavailable; using engine defaults.', error);
      }
      // tesseract.js v6+: word/line geometry is only returned when the `blocks`
      // output is requested explicitly (it is off by default).
      const ret: any = await worker.recognize(image, {}, { text: true, blocks: true });
      return {
        words: collectTesseractWords(ret.data),
        rawText: normalizeOcrText(ret.data?.text),
        languages,
      };
    } finally {
      // A failed recognition used to leave the Wasm worker alive. Always release
      // it before the user retries another photograph.
      await worker.terminate().catch(() => undefined);
    }
  };

  try {
    return await recognizeWith(profile.languages);
  } catch (error) {
    // The optional extra language pack may be missing from an older cached
    // deployment, or incompatible with the Wasm core (float "tessdata_best"
    // models abort inside the integer-only LSTM build). Either way, do not
    // fail the document pipeline: retain the established English path.
    if (profile.languages === 'eng') throw error;
    console.warn(`Tesseract language pack "${profile.languages}" unusable; using English only.`, error);
    return recognizeWith('eng');
  }
}

function mapWordsToTokens(
  words: RawOcrWord[],
  factor: number,
  prefix: string,
  pageNumber: number = 1
): ExtractedSpatialToken[] {
  return words.map((w, idx) => ({
    id: `${prefix}_${idx}_p${pageNumber}`,
    text: w.text,
    x: Math.round(w.x0 * factor),
    y: Math.round(w.y0 * factor),
    width: Math.round((w.x1 - w.x0) * factor),
    height: Math.round((w.y1 - w.y0) * factor),
    page: pageNumber,
    confidence: w.confidence,
  }));
}

function meanConfidence(tokens: ExtractedSpatialToken[]): number {
  const vals = tokens
    .map((t) => t.confidence)
    .filter((c): c is number => typeof c === 'number');
  return vals.length ? vals.reduce((s, c) => s + c, 0) / vals.length : 100;
}

type ExtractionCore = Omit<DocumentExtractionResult, 'targets' | 'latencyMs' | 'engineName'> & {
  engineLabel: string;
};

const SURYA_SIDECAR_URL = 'http://127.0.0.1:8765/ocr';
export const SURYA_HEALTH_URL = 'http://127.0.0.1:8765/health';

export interface SuryaHealth {
  online: boolean;
  ready: boolean;
  engine?: string;
  error?: string | null;
}

// Cheap liveness/readiness probe for the local Surya sidecar (1.5s timeout).
export async function checkSuryaHealth(): Promise<SuryaHealth> {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 1500);
    let r: Response;
    try {
      r = await fetch(SURYA_HEALTH_URL, { signal: c.signal });
    } finally {
      clearTimeout(t);
    }
    if (!r.ok) return { online: true, ready: false };
    const j: any = await r.json();
    return { online: true, ready: !!j?.model_loaded, engine: j?.engine, error: j?.error ?? null };
  } catch {
    return { online: false, ready: false };
  }
}

// Primary OCR path: POST the rendered image to the local Surya sidecar
// (Python/Torch on 127.0.0.1). Returns display-space tokens, or null when the
// sidecar is unreachable so callers can fall back to in-browser Tesseract.
async function ocrViaSurya(
  image: HTMLCanvasElement,
  factor: number,
  pageNumber: number = 1
): Promise<{ tokens: ExtractedSpatialToken[]; rawText: string; meanConfidence: number } | null> {
  try {
    const blob: Blob | null = await new Promise((resolve) =>
      image.toBlob((b) => resolve(b), 'image/png')
    );
    if (!blob) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    let resp: Response;
    try {
      resp = await fetch(SURYA_SIDECAR_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: blob,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) return null;

    const data: any = await resp.json();
    const lines: any[] = Array.isArray(data?.lines) ? data.lines : [];
    const norm = (c: any) => (typeof c === 'number' ? (c <= 1 ? c * 100 : c) : 100);
    const tokens: ExtractedSpatialToken[] = [];
    const pieces: string[] = [];
    let idx = 0;

    for (const line of lines) {
      const ltext = normalizeOcrText(line?.text);
      if (ltext) pieces.push(ltext);
      const lconf = norm(line?.confidence);
      const words: any[] | null =
        Array.isArray(line?.words) && line.words.length ? line.words : null;

      if (words) {
        for (const w of words) {
          const t = normalizeOcrText(w?.text);
          if (!t) continue;
          const bb = w?.bbox || line?.bbox || [0, 0, 0, 0];
          tokens.push({
            id: `surya_${idx++}_p${pageNumber}`,
            text: t,
            x: Math.round(bb[0] * factor),
            y: Math.round(bb[1] * factor),
            width: Math.round((bb[2] - bb[0]) * factor),
            height: Math.round((bb[3] - bb[1]) * factor),
            page: pageNumber,
            confidence: Math.round(norm(w?.confidence ?? lconf) * 10) / 10,
          });
        }
      } else if (ltext) {
        // No per-word boxes: split the line box proportionally by token length.
        const bb = line?.bbox || [0, 0, 0, 0];
        const parts = ltext.split(/\s+/).filter(Boolean);
        const denom = parts.reduce((s, p) => s + p.length, 0) + Math.max(0, parts.length - 1);
        const lineW = Math.max(1, bb[2] - bb[0]);
        let cx = bb[0];
        for (const p of parts) {
          const wpx = (p.length / Math.max(1, denom)) * lineW;
          tokens.push({
            id: `surya_${idx++}_p${pageNumber}`,
            text: p,
            x: Math.round(cx * factor),
            y: Math.round(bb[1] * factor),
            width: Math.round(wpx * factor),
            height: Math.round((bb[3] - bb[1]) * factor),
            page: pageNumber,
            confidence: Math.round(lconf * 10) / 10,
          });
          cx += wpx + (1 / Math.max(1, denom)) * lineW;
        }
      }
    }

    if (!tokens.length) return null;
    const mc = tokens.reduce((s, t) => s + (t.confidence || 0), 0) / tokens.length;
    return { tokens, rawText: pieces.join('\n'), meanConfidence: mc };
  } catch {
    return null;
  }
}

// Paint a (possibly deskewed/warped) cleaned raster into the visible canvas so
// OCR boxes, HUD overlays, and the pixel-burn all share one coordinate space.
function drawCleanedToDisplay(canvas: HTMLCanvasElement, src: HTMLCanvasElement) {
  canvas.width = DISPLAY_WIDTH;
  canvas.height = Math.max(1, Math.round((src.height / Math.max(1, src.width)) * DISPLAY_WIDTH));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  }
}

// A hung pdf.js promise (e.g. a wedged worker) must surface as an error, never
// stall the pipeline silently.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export class PdfPasswordRequiredError extends Error {
  incorrect: boolean;
  constructor(incorrect: boolean) {
    super(incorrect ? 'Incorrect PDF password' : 'PDF is password-protected');
    this.name = 'PdfPasswordRequiredError';
    this.incorrect = incorrect;
  }
}

async function extractPdfDocument(
  fileBytes: Uint8Array,
  canvas: HTMLCanvasElement,
  onProgress?: OcrProgressFn,
  pdfPassword?: string,
  scenarioId?: string
): Promise<ExtractionCore> {
  const loadingTask = (pdfjs as any).getDocument({
    data: fileBytes.slice(),
    standardFontDataUrl: '/standard_fonts/',
    ...(pdfPassword ? { password: pdfPassword } : {}),
  });
  let pdf: any;
  try {
    pdf = await withTimeout(loadingTask.promise, 30000, 'pdf.js getDocument');
  } catch (e: any) {
    // e-Aadhaar PDFs are usually password-protected. pdf.js: code 1 = needs
    // password, 2 = incorrect password. Surface a typed error for the UI.
    if (e?.name === 'PasswordException') throw new PdfPasswordRequiredError(e?.code === 2);
    throw e;
  }
  const numPages: number = pdf.numPages;
  if (import.meta.env.DEV) console.debug(`[ocr:dev] document loaded: ${numPages} page(s)`);
  try {

  const allTokens: ExtractedSpatialToken[] = [];
  const allTextPieces: string[] = [];
  const pageRasters = new Map<number, ImageData>();
  let usedTextLayer = false;
  let usedSurya = false;
  let usedTesseract = false;
  let tesseractLanguages = 'eng';

  // Every page is processed; the single canvas is reused and its pixels are
  // captured per page so burn/overlays operate on exactly what OCR saw.
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const pageLabel = `Page ${pageNum} of ${numPages}`;
    const base = ((pageNum - 1) / numPages) * 100;
    const span = 100 / numPages;
    onProgress?.(Math.round(base), 'Rendering page…', pageLabel);

    const page: any = await withTimeout<any>(pdf.getPage(pageNum), 20000, `pdf.js getPage(${pageNum})`);
    const unscaled = page.getViewport({ scale: 1 });
    const displayScale = DISPLAY_WIDTH / unscaled.width;
    const viewport = page.getViewport({ scale: displayScale });

    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // intent 'print': pdf.js drives display-intent rendering with requestAnimationFrame,
    // which browsers pause in background/hidden tabs — a user switching tabs mid-OCR
    // would stall extraction forever. Print intent uses timers and renders identically
    // for rasterization purposes.
    await withTimeout<void>(
      (page.render({ canvasContext: ctx, viewport, intent: 'print' } as any) as any).promise,
      30000,
      `pdf.js render(${pageNum})`
    );

    // 1) Native vector text layer (digital PDFs): exact coordinates, no OCR needed.
    const textContent: any = await withTimeout<any>(page.getTextContent(), 20000, `pdf.js getTextContent(${pageNum})`);
    const pageTokens: ExtractedSpatialToken[] = [];
    let idx = 0;
    for (const item of textContent.items as any[]) {
      const str = (item.str || '').trim();
      if (!str) continue;
      const [cx, cy] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      const h = Math.max(8, Math.round(Math.abs(item.transform[3]) * displayScale));
      const w = Math.max(6, Math.round((item.width || 0) * displayScale));
      pageTokens.push({
        id: `pdf_token_${idx++}_p${pageNum}`,
        text: str,
        x: Math.round(cx),
        y: Math.round(cy - h),
        width: w,
        height: h,
        page: pageNum,
        confidence: 100,
      });
    }

    // A digital page has a usable text layer; only genuinely empty pages (scans) go to OCR.
    const textChars = pageTokens.reduce((n, t) => n + t.text.length, 0);
    if (import.meta.env.DEV) console.debug(`[ocr:dev] page ${pageNum}: ${pageTokens.length} text items, ${textChars} chars`);
    if (pageTokens.length >= TEXT_LAYER_MIN_TOKENS || textChars >= TEXT_LAYER_MIN_CHARS) {
      usedTextLayer = true;
      allTokens.push(...pageTokens);
      allTextPieces.push(pageTokens.map((t) => t.text).join(' '));
      pageRasters.set(pageNum, ctx.getImageData(0, 0, canvas.width, canvas.height));
      continue;
    }

    // 2) Scanned page: supersample the render, then OCR it.
    onProgress?.(Math.round(base), 'Supersampling page…', pageLabel);
    const ocrScale = Math.min(displayScale * OCR_SUPERSAMPLE, OCR_MAX_WIDTH / unscaled.width);
    const ocrViewport = page.getViewport({ scale: ocrScale });
    const off = document.createElement('canvas');
    off.width = Math.round(ocrViewport.width);
    off.height = Math.round(ocrViewport.height);
    const octx = off.getContext('2d');
    if (octx) {
      await withTimeout<void>(
        (page.render({ canvasContext: octx, viewport: ocrViewport, intent: 'print' } as any) as any).promise,
        60000,
        `pdf.js hi-res render(${pageNum})`
      );
    }

    // Primary: geometric cleanup (perspective + deskew, colour preserved) → local
    // Surya sidecar. A neural recognizer reads a flat, upright page best, and its
    // boxes then align with the displayed (corrected) raster.
    const photo = await preprocessForOcr(
      off,
      (p, st) => onProgress?.(Math.round(base + (p * 0.3 * span) / 100), st, pageLabel),
      { mode: 'photo' }
    );
    const surya = await ocrViaSurya(photo, DISPLAY_WIDTH / Math.max(1, photo.width), pageNum);
    if (surya) {
      usedSurya = true;
      drawCleanedToDisplay(canvas, photo);
      allTokens.push(...surya.tokens);
      allTextPieces.push(surya.rawText);
      pageRasters.set(pageNum, ctx.getImageData(0, 0, canvas.width, canvas.height));
      continue;
    }

    // Fallback: binarizing cleanup → in-browser Tesseract.
    usedTesseract = true;
    const cleaned = await preprocessForOcr(off, (p, st) =>
      onProgress?.(Math.round(base + (p * 0.4 * span) / 100), st, pageLabel)
    );
    drawCleanedToDisplay(canvas, cleaned);
    const tesseract = await runTesseract(
      cleaned,
      (p, st) => onProgress?.(Math.round(base + ((40 + p * 0.6) * span) / 100), st, pageLabel),
      tesseractProfileForScenario(scenarioId)
    );
    tesseractLanguages = tesseract.languages;
    const { words, rawText } = tesseract;
    const factor = canvas.width / Math.max(1, cleaned.width);
    allTokens.push(...mapWordsToTokens(words, factor, 'ocr_token', pageNum));
    allTextPieces.push(rawText);
    pageRasters.set(pageNum, ctx.getImageData(0, 0, canvas.width, canvas.height));
  }

  if (import.meta.env.DEV) console.debug(`[ocr:dev] all ${numPages} pages done; tokens=${allTokens.length}`);
  // Leave page 1 on the visible canvas.
  const p1 = pageRasters.get(1);
  if (p1) {
    canvas.width = p1.width;
    canvas.height = p1.height;
    canvas.getContext('2d')?.putImageData(p1, 0, 0);
  }

  const textNote = usedTextLayer ? ' + pdf.js text layer' : '';
  const engineLabel = usedSurya
    ? `Surya OCR · Local Sidecar (127.0.0.1)${textNote}`
    : usedTesseract
      ? `${tesseractEngineLabel(tesseractLanguages, 'Scanned PDF')}${textNote}`
      : 'pdf.js Vector Text Matrix · Native Spatial';

  return {
    tokens: allTokens,
    rawText: allTextPieces.join('\n'),
    meanConfidence: meanConfidence(allTokens),
    width: p1?.width || canvas.width,
    height: p1?.height || canvas.height,
    numPages,
    usedOcrFallback: usedTesseract,
    pageRasters,
    engineLabel,
  };
  } finally {
    // Release the pdf.js document + its worker; rasters/tokens are already captured.
    try {
      if (typeof pdf?.destroy === 'function') await pdf.destroy();
      else if (typeof loadingTask?.destroy === 'function') await loadingTask.destroy();
    } catch {
      /* ignore */
    }
  }
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to decode image file'));
    };
    img.src = url;
  });
}

async function extractImageDocument(
  file: File,
  canvas: HTMLCanvasElement,
  onProgress?: OcrProgressFn,
  scenarioId?: string
): Promise<ExtractionCore> {
  const img = await loadImageElement(file);
  const naturalW = Math.max(1, img.naturalWidth);
  const naturalH = Math.max(1, img.naturalHeight);

  // High-resolution OCR source rendered straight from the source pixels.
  const ocrWidth = Math.min(OCR_MAX_WIDTH, Math.max(naturalW, DISPLAY_WIDTH * OCR_SUPERSAMPLE));
  const off = document.createElement('canvas');
  off.width = Math.round(ocrWidth);
  off.height = Math.max(1, Math.round(naturalH * (ocrWidth / naturalW)));
  const octx = off.getContext('2d');
  if (octx) {
    octx.imageSmoothingEnabled = true;
    (octx as any).imageSmoothingQuality = 'high';
    octx.drawImage(img, 0, 0, off.width, off.height);
  }

  const pageRasters = new Map<number, ImageData>();
  const snapshot = () => {
    const ctx = canvas.getContext('2d');
    if (ctx) pageRasters.set(1, ctx.getImageData(0, 0, canvas.width, canvas.height));
  };

  // Primary: geometric cleanup (perspective + deskew, colour preserved) → Surya.
  const photo = await preprocessForOcr(off, (p, st) => onProgress?.(Math.round(p * 0.3), st), { mode: 'photo' });
  const surya = await ocrViaSurya(photo, DISPLAY_WIDTH / Math.max(1, photo.width), 1);
  if (surya) {
    drawCleanedToDisplay(canvas, photo);
    snapshot();
    return {
      tokens: surya.tokens,
      rawText: surya.rawText,
      meanConfidence: surya.meanConfidence,
      width: canvas.width,
      height: canvas.height,
      numPages: 1,
      usedOcrFallback: false,
      pageRasters,
      engineLabel: 'Surya OCR · Local Sidecar (127.0.0.1)',
    };
  }

  // Fallback: binarizing cleanup (illumination/perspective/deskew) → Tesseract.
  const cleaned = await preprocessForOcr(off, (p, st) => onProgress?.(Math.round(p * 0.4), st));
  drawCleanedToDisplay(canvas, cleaned);
  snapshot();
  const tesseract = await runTesseract(
    cleaned,
    (p, st) => onProgress?.(40 + Math.round(p * 0.6), st),
    tesseractProfileForScenario(scenarioId)
  );
  const { words, rawText } = tesseract;
  const factor = canvas.width / Math.max(1, cleaned.width);
  const tokens = mapWordsToTokens(words, factor, 'ocr_token', 1);

  return {
    tokens,
    rawText,
    meanConfidence: meanConfidence(tokens),
    width: canvas.width,
    height: canvas.height,
    numPages: 1,
    usedOcrFallback: true,
    pageRasters,
    engineLabel: tesseractEngineLabel(tesseract.languages, 'Raster Image'),
  };
}

// Spatial Line Reconstruction & Multi-Token Field Classifier
const RE_SSN = /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/;
const RE_EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const RE_PHONE = /\+?\d[\d().\-\s]{8,}\d/;
const RE_CURRENCY =
  /(?:USD|US\$|\$|€|£|₹)\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?(?:\s?(?:USD|EUR|GBP|INR))?/;
const RE_INCOME_LINE = /income|salary|earnings|wage|compensation|revenue|profit/i;

interface LineMatch {
  text: string;
  tokens: ExtractedSpatialToken[];
}

function groupLines(tokens: ExtractedSpatialToken[]): ExtractedSpatialToken[][] {
  const sorted = [...tokens].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const lines: ExtractedSpatialToken[][] = [];
  for (const t of sorted) {
    const tc = t.y + t.height / 2;
    let placed: ExtractedSpatialToken[] | undefined;
    for (const line of lines) {
      if (line[0].page !== t.page) continue; // never merge rows across pages
      const rc = line.reduce((s, x) => s + (x.y + x.height / 2), 0) / line.length;
      const rh = line.reduce((s, x) => s + x.height, 0) / line.length;
      if (Math.abs(tc - rc) <= Math.max(rh, t.height) * 0.5) {
        placed = line;
        break;
      }
    }
    if (placed) placed.push(t);
    else lines.push([t]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

function matchInLine(line: ExtractedSpatialToken[], re: RegExp): LineMatch[] {
  let joined = '';
  const spans: { start: number; end: number; tok: ExtractedSpatialToken }[] = [];
  line.forEach((tok, i) => {
    if (i > 0) joined += ' ';
    const start = joined.length;
    joined += tok.text;
    spans.push({ start, end: joined.length, tok });
  });

  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const rx = new RegExp(re.source, flags);
  const matches: LineMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(joined)) !== null) {
    const s = m.index;
    const e = m.index + m[0].length;
    const toks = spans.filter((sp) => sp.end > s && sp.start < e).map((sp) => sp.tok);
    if (toks.length) matches.push({ text: m[0].trim(), tokens: toks });
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return matches;
}

// Padding scales with the glyph height: scanner-generated text layers place
// words slightly short of the printed ink, especially at the right edge.
function unionBox(tokens: ExtractedSpatialToken[], pad = 4) {
  const x0 = Math.min(...tokens.map((t) => t.x));
  const y0 = Math.min(...tokens.map((t) => t.y));
  const x1 = Math.max(...tokens.map((t) => t.x + t.width));
  const y1 = Math.max(...tokens.map((t) => t.y + t.height));
  const h = Math.max(...tokens.map((t) => t.height));
  const padL = Math.max(pad, h * 0.2);
  const padR = Math.max(pad, h * 0.5);
  const padY = Math.max(pad, h * 0.12);
  return {
    x: Math.max(0, Math.round(x0 - padL)),
    y: Math.max(0, Math.round(y0 - padY)),
    width: Math.round(x1 - x0 + padL + padR),
    height: Math.round(y1 - y0 + padY * 2),
  };
}

function tokenConfidence(tokens: ExtractedSpatialToken[]): number {
  const vals = tokens
    .map((t) => t.confidence)
    .filter((c): c is number => typeof c === 'number');
  return vals.length
    ? Math.round((vals.reduce((s, c) => s + c, 0) / vals.length) * 10) / 10
    : 100;
}

function parseAmount(text: string): number {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const n = Number(cleaned);
  return isFinite(n) ? n : 0;
}

export function classifyExtractedTargets(
  tokens: ExtractedSpatialToken[],
  thresholdValue: number
): ClassifiedTarget[] {
  const lines = groupLines(tokens);
  const claimed = new Set<string>();
  const targets: ClassifiedTarget[] = [];
  let counter = 0;

  interface CurrencyCandidate {
    tokens: ExtractedSpatialToken[];
    text: string;
    value: number;
    incomeLine: boolean;
    confidence: number;
  }
  const currencies: CurrencyCandidate[] = [];

  const isClaimed = (toks: ExtractedSpatialToken[]) => toks.some((t) => claimed.has(t.id));
  const claim = (toks: ExtractedSpatialToken[]) => toks.forEach((t) => claimed.add(t.id));

  for (const line of lines) {
    const lineText = line.map((t) => t.text).join(' ');

    for (const mt of matchInLine(line, RE_SSN)) {
      if (isClaimed(mt.tokens)) continue;
      claim(mt.tokens);
      targets.push({
        id: `field_ssn_${counter++}`,
        label: 'Social Security Number',
        classification: 'Government Identifier (Sensitive PII)',
        extractedValue: mt.text,
        ...unionBox(mt.tokens),
        page: mt.tokens[0].page,
        action: 'DIRECT_BURN',
        source: 'OCR_AUTO',
        confidence: tokenConfidence(mt.tokens),
      });
    }

    for (const mt of matchInLine(line, RE_EMAIL)) {
      if (isClaimed(mt.tokens)) continue;
      claim(mt.tokens);
      targets.push({
        id: `field_email_${counter++}`,
        label: 'Email Address',
        classification: 'Contact Identifier (PII)',
        extractedValue: mt.text,
        ...unionBox(mt.tokens),
        page: mt.tokens[0].page,
        action: 'DIRECT_BURN',
        source: 'OCR_AUTO',
        confidence: tokenConfidence(mt.tokens),
      });
    }

    for (const mt of matchInLine(line, RE_CURRENCY)) {
      if (isClaimed(mt.tokens)) continue;
      claim(mt.tokens);
      currencies.push({
        tokens: mt.tokens,
        text: mt.text,
        value: parseAmount(mt.text),
        incomeLine: RE_INCOME_LINE.test(lineText),
        confidence: tokenConfidence(mt.tokens),
      });
    }

    for (const mt of matchInLine(line, RE_PHONE)) {
      if (isClaimed(mt.tokens)) continue;
      if (mt.text.replace(/\D/g, '').length < 10) continue;
      claim(mt.tokens);
      targets.push({
        id: `field_phone_${counter++}`,
        label: 'Phone Number',
        classification: 'Contact Identifier (PII)',
        extractedValue: mt.text,
        ...unionBox(mt.tokens),
        page: mt.tokens[0].page,
        action: 'DIRECT_BURN',
        source: 'OCR_AUTO',
        confidence: tokenConfidence(mt.tokens),
      });
    }
  }

  if (currencies.length > 0) {
    let witnessIdx = currencies.findIndex((c) => c.incomeLine);
    if (witnessIdx < 0) witnessIdx = currencies.findIndex((c) => c.value >= thresholdValue);
    if (witnessIdx < 0) {
      witnessIdx = currencies.reduce(
        (best, c, i, arr) => (c.value > arr[best].value ? i : best),
        0
      );
    }

    currencies.forEach((c, i) => {
      const isWitness = i === witnessIdx;
      targets.push({
        id: `field_${isWitness ? 'witness' : 'amount'}_${counter++}`,
        label: isWitness ? '2-Year Trailing Income' : 'Financial Figure',
        classification: isWitness
          ? 'Financial Witness Claim (ZK Predicate)'
          : 'Financial Amount (Sensitive)',
        extractedValue: c.text,
        numericValue: c.value,
        satisfiesThreshold: isWitness ? c.value >= thresholdValue : undefined,
        ...unionBox(c.tokens),
        page: c.tokens[0].page,
        action: isWitness ? 'PROVE_AND_BURN' : 'DIRECT_BURN',
        source: 'OCR_AUTO',
        confidence: c.confidence,
      });
    });
  }

  if (targets.length === 0) {
    tokens
      .filter((t) => t.text.replace(/\s/g, '').length >= 4)
      .slice(0, 2)
      .forEach((t, i) =>
        targets.push({
          id: `field_generic_${i}`,
          label: `Extracted Field ${i + 1}`,
          classification: 'Sensitive Document Content',
          extractedValue: t.text,
          ...unionBox([t]),
          page: t.page,
          action: 'DIRECT_BURN',
          source: 'OCR_AUTO',
          confidence: t.confidence ?? 100,
        })
      );
  }

  targets.sort((a, b) => {
    if (a.action !== b.action) return a.action === 'PROVE_AND_BURN' ? -1 : 1;
    return a.y - b.y;
  });
  return targets;
}

// --- Scenario-aware classification -----------------------------------------

// Label-anchored value: find a label keyword on a line and take the trailing
// tokens to its right as the field value (e.g. "Name: Rahul Kumar").
function matchLabelValue(line: ExtractedSpatialToken[], labelRe: RegExp): LineMatch | null {
  let joined = '';
  const spans: { start: number; end: number; tok: ExtractedSpatialToken }[] = [];
  line.forEach((tok, i) => {
    if (i > 0) joined += ' ';
    const start = joined.length;
    joined += tok.text;
    spans.push({ start, end: joined.length, tok });
  });
  const re = new RegExp(labelRe.source, labelRe.flags.replace('g', ''));
  const m = re.exec(joined);
  if (!m) return null;
  let valueStart = m.index + m[0].length;
  // "Name of Employee: X" — a colon within a few tokens of the label ends the label.
  const colonIdx = joined.indexOf(':', valueStart);
  if (colonIdx >= 0) {
    const between = spans.filter((sp) => sp.end > valueStart && sp.start < colonIdx).length;
    if (between <= 3) valueStart = colonIdx + 1;
  }
  const valueToks = spans
    .filter((sp) => sp.end > valueStart)
    .map((sp) => sp.tok)
    .filter((t) => t.text.replace(/[:\-–—.\s]/g, '').length > 0);
  if (!valueToks.length) return null;
  const text = valueToks.map((t) => t.text).join(' ').replace(/^[:\-–—\s.]+/, '').trim();
  if (!text) return null;
  // "Father's Name" leaves just "Name", "ROLL NO VALID UPTO" leaves "VALID UPTO":
  // label words in the next column are not values.
  if (RE_LABEL_WORDS.test(text)) return null;
  return { text, tokens: valueToks };
}

// --- Age witness (Aadhaar) ---------------------------------------------------
// Aadhaar prints DOB as DD/MM/YYYY (or only a Year of Birth). Derive whole years.
function ageFromDobText(text: string, now = new Date()): number | null {
  const m = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let d = Number(m[1]);
    let mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += y >= 30 ? 1900 : 2000;
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // tolerate MM/DD
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > now.getFullYear()) return null;
    let age = now.getFullYear() - y;
    if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age -= 1;
    return age >= 0 && age <= 130 ? age : null;
  }
  return null;
}
function ageFromYearText(text: string, now = new Date()): number | null {
  const m = text.match(/\b(19\d{2}|20\d{2})\b/);
  if (!m) return null;
  const age = now.getFullYear() - Number(m[1]);
  return age >= 0 && age <= 130 ? age : null;
}
// Split a visual row into horizontally contiguous clusters (a gap wider than
// ~2.5x the token height separates the demographic column from e.g. QR speckle).
function clusterByGap(line: ExtractedSpatialToken[]): ExtractedSpatialToken[][] {
  const sorted = [...line].sort((a, b) => a.x - b.x);
  const clusters: ExtractedSpatialToken[][] = [];
  for (const t of sorted) {
    const cur = clusters[clusters.length - 1];
    if (cur) {
      const prev = cur[cur.length - 1];
      const gap = t.x - (prev.x + prev.width);
      const h = Math.max(prev.height, t.height, 8);
      if (gap <= h * 2.5) {
        cur.push(t);
        continue;
      }
    }
    clusters.push([t]);
  }
  return clusters;
}

const RE_BIRTH_LINE = /\b(?:dob|d\.o\.b|date of birth|year of birth|yob|birth)\b|(?:जन्म\s*(?:तिथि|तारीख|दिन|वर्ष)?)/i;
const RE_DEVANAGARI = /[\u0900-\u097F]/;
const RE_AADHAAR_BOILERPLATE = /government of india|unique identification|aadhaar|\bindia\b|proof of identity|citizenship|authority|\bmera\b|भारत सरकार|विशिष्ट पहचान|मेरा आधार/i;
// Institution / document boilerplate that is never a person's name or a field value.
const RE_CARD_BOILERPLATE =
  /\b(?:college|institute|institution|university|school|academy|polytechnic|campus|identity\s*card|id\s*card|student\s*(?:id|card)|library|department of|govt|government|income tax|permanent account|signature|valid|issued?|deemed|ugc|section|technology|engineering|sciences?|hosteller|day\s*scholar|scholar|principal|registrar|director|dean|holder|authori[sz]ed|emergency|contact|blood|group|male|female|return|found|please|office|phone|mobile|email|website|www)\b/i;
const RE_NON_BIRTH_DATE = /\b(?:issued?|issue date|date of issue|enrol|enrolment|print|download|valid|expiry|generated|updated)\b|(?:जारी|मुद्रण|प्रिंट|डाउनलोड|नामांकन|अपडेट)/i;
const RE_GENDER_LINE = /\b(?:MALE|FEMALE|TRANSGENDER|Male|Female|Transgender)\b|\u092a\u0941\u0930\u0941\u0937|\u092e\u0939\u093f\u0932\u093e/;
const RE_GUARDIAN_LINE = /\b(?:S\/O|D\/O|W\/O|C\/O|son of|daughter of|wife of|care of)\b|(?:पिता|माता|पति|संरक्षक|देखरेख)/i;

function nameCharacters(text: string): string {
  // Keep Latin letters and Devanagari letters/marks. This is intentionally
  // narrow: QR speckle, Devanagari digits, and numeric labels must never
  // become a name candidate.
  return text.replace(/[^A-Za-z\u0904-\u0963\u0971-\u097F]/g, '');
}

// PAN numbers on card photos: OCR confuses O/0, I/1, Z/2, S/5, B/8, G/6 and may
// split the 5-4-1 groups. Accept a 10-character run whose positions map to the
// letter/digit structure after those confusions, as long as most of it was
// read correctly (at least 3 real letters and 2 real digits).
const PAN_TO_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '4': 'A', '6': 'G' };
const PAN_TO_DIGIT: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', A: '4', G: '6', T: '7' };
const RE_PAN_LOOSE = /\b[A-Za-z0-9]{5}\s?[A-Za-z0-9]{4}\s?[A-Za-z0-9]\b/g; // OCR may lowercase letters
function panLike(raw: string): boolean {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (s.length !== 10) return false;
  if (/^[A-Z]{4}\d{5}[A-Z]$/.test(s)) return false; // an exact TAN is not a misread PAN
  let letters = 0;
  let digits = 0;
  for (let i = 0; i < 10; i++) {
    const ch = s[i];
    const wantLetter = i < 5 || i === 9;
    if (wantLetter) {
      if (/[A-Z]/.test(ch)) letters++;
      else if (!PAN_TO_LETTER[ch]) return false;
    } else if (/\d/.test(ch)) digits++;
    else if (!PAN_TO_DIGIT[ch]) return false;
  }
  return letters >= 3 && digits >= 2;
}
function matchPanTolerant(line: ExtractedSpatialToken[]): LineMatch[] {
  return matchInLine(line, RE_PAN_LOOSE).filter((m) => panLike(m.text));
}

const RE_LABEL_WORDS =
  /^(?:name|no\.?|number|id|code|date|of|valid(?:\s*(?:upto|up\s*to|till|thru|through))?|issued?(?:\s*on)?|expiry|exp\.?|dob|d\.?o\.?b\.?|date\s*of\s*birth|roll\s*no\.?|course|class|branch|dept\.?|reg\.?\s*no\.?|signature)$/i;

// Card layouts print the label on one line and the value on the next
// ("Name" / "SPECIMEN PERSON"). When a line is only the label, take the
// column-aligned cluster of the next line on the same page as the value.
function valueBelowLabel(
  lines: ExtractedSpatialToken[][],
  li: number,
  labelRe: RegExp,
  claimed: Set<string>
): LineMatch | null {
  const line = lines[li];
  // The value line is the next line with real content; OCR punctuation specks
  // ("..", "=") often form their own tiny line between a label and its value.
  let next: ExtractedSpatialToken[] | undefined;
  for (let j = li + 1; j < Math.min(lines.length, li + 4); j++) {
    const cand = lines[j];
    if (cand[0].page !== line[0].page) break;
    if (cand.some((t) => /[A-Za-z0-9]/.test(t.text))) { next = cand; break; }
  }
  if (!next) return null;
  const lineText = line.map((t) => t.text).join(' ');
  const re = new RegExp(labelRe.source, labelRe.flags.replace('g', ''));
  const m = re.exec(lineText);
  if (!m) return null;
  const restRaw = lineText.slice(m.index + m[0].length);
  const rest = restRaw.replace(/[^A-Za-z0-9]/g, '');
  const before = lineText.slice(0, m.index).replace(/[^A-Za-z0-9]/g, '');
  // More than a label: digits, or more than two extra real words ("Father's Name" is fine;
  // OCR punctuation such as "=. =, .." is not a word).
  const restWords = restRaw.trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  if (/\d/.test(restRaw) || rest.length > 16 || restWords > 2 || before.length > 12) return null;
  // Anchor the column on the label's own tokens, not on speckle elsewhere in the row.
  const labelToks = matchInLine(line, labelRe)[0]?.tokens ?? line;
  const x0 = Math.min(...labelToks.map((t) => t.x));
  const y1 = Math.max(...line.map((t) => t.y + t.height));
  const h = Math.max(...line.map((t) => t.height));
  const nextY0 = Math.min(...next.map((t) => t.y));
  if (nextY0 - y1 > h * 2.5) return null;
  // The value starts at (or just right of) the label's column and runs until the
  // first wide gap; speckle or other columns to the left are ignored.
  const right = [...next].filter((t) => t.x >= x0 - h * 2).sort((a, b) => a.x - b.x);
  const cluster: ExtractedSpatialToken[] = [];
  for (const t of right) {
    const prev = cluster[cluster.length - 1];
    if (prev && t.x - (prev.x + prev.width) > Math.max(prev.height, t.height, 8) * 2.5) break;
    cluster.push(t);
  }
  if (!cluster.length || cluster[0].x - x0 > h * 6) return null;
  const toks = cluster.filter((t) => !claimed.has(t.id) && t.text.replace(/[:\-–—.\s=|~,]/g, '').length > 0);
  if (!toks.length) return null;
  const text = toks.map((t) => t.text).join(' ').trim();
  if (!text || re.test(text) || /[:;]\s*$/.test(text)) return null; // the next line is another label
  return { text, tokens: toks };
}

// Detect and classify redaction targets for a specific document scenario.
export function classifyForScenario(
  tokens: ExtractedSpatialToken[],
  scenario: DocumentScenario,
  opts: { thresholdValue: number }
): ClassifiedTarget[] {
  const lines = groupLines(tokens);
  const claimed = new Set<string>();
  const targets: ClassifiedTarget[] = [];
  let counter = 0;

  const isClaimed = (toks: ExtractedSpatialToken[]) => toks.some((t) => claimed.has(t.id));
  const claim = (toks: ExtractedSpatialToken[]) => toks.forEach((t) => claimed.add(t.id));

  const fields = [...scenario.fields].sort((a, b) => a.priority - b.priority);
  const currencyFields = fields.filter((f) => f.detect.kind === 'currency');
  const ageField = fields.find((f) => f.detect.kind === 'age_from_dob');
  const nameAboveField = fields.find((f) => f.detect.kind === 'name_above_dob');
  const photoField = fields.find((f) => f.detect.kind === 'aadhaar_photo_layout');
  const cardPhotoField = fields.find((f) => f.detect.kind === 'card_photo_layout');
  const prominentNameField = fields.find((f) => f.detect.kind === 'name_prominent');
  const otherFields = fields.filter(
    (f) => !['currency', 'age_from_dob', 'name_above_dob', 'aadhaar_photo_layout', 'card_photo_layout', 'name_prominent'].includes(f.detect.kind)
  );
  let patternDobLineIdx = -1;

  // Pattern + label-anchored fields (identifiers, names, dates, addresses...).
  for (const field of otherFields) {
    for (const line of lines) {
      if (field.detect.kind === 'pattern') {
        // A "date of birth" field must not claim issue / validity / print dates.
        if (field.key === 'dob') {
          const here = line.map((t) => t.text).join(' ');
          const prev = lines[lines.indexOf(line) - 1];
          const above = prev && prev[0].page === line[0].page ? prev.map((t) => t.text).join(' ') : '';
          // "VALID UPTO" / "ISSUED" on this line, or as a label on the line above (card layouts).
          if (RE_NON_BIRTH_DATE.test(here) || (RE_NON_BIRTH_DATE.test(above) && !RE_BIRTH_LINE.test(above) && !RE_BIRTH_LINE.test(here))) continue;
        }
        const validate = field.detect.validate;
        const exact = matchInLine(line, field.detect.re).filter((m) => !validate || validate(m.text));
        const matches = field.key === 'pan' && exact.length === 0 ? matchPanTolerant(line) : exact;
        for (const mt of matches) {
          if (isClaimed(mt.tokens)) continue;
          claim(mt.tokens);
          if (field.key === 'dob' && patternDobLineIdx < 0) patternDobLineIdx = lines.indexOf(line);
          targets.push({
            id: `field_${field.key}_${counter++}`,
            label: field.label,
            classification: field.classification,
            extractedValue: mt.text,
            numericValue: field.numeric ? parseAmount(mt.text) : undefined,
            ...unionBox(mt.tokens),
            page: mt.tokens[0].page,
            action: field.action,
            source: 'OCR_AUTO',
            confidence: tokenConfidence(mt.tokens),
            fieldKey: field.key,
          });
        }
      } else if (field.detect.kind === 'label') {
        const li = lines.indexOf(line);
        let mv = matchLabelValue(line, field.detect.re);
        // The institution's own address ("Official Address") is not personal data.
        if (field.key === 'address' && /\b(?:official|institut|college|campus|office|university)/i.test(line.map((t) => t.text).join(' '))) continue;
        // A one- or two-character same-line "value" is speckle next to the label
        // ("Name Lo"); the real value is on the line below on card layouts.
        // Short or low-confidence same-line "values" are speckle next to the label
        // ("Name Lo", "NAME Coe"); on card layouts the real value is the line below.
        // Blood groups ("B+", "AB-") are legitimately short.
        // OCR often reads the O as "()" or "0".
        const RE_BLOOD_GROUP = /^(?:A|B|AB|O|\(\)|0)\s*[+-]?\s*(?:ve)?$/i;
        const weak = !!mv && !(field.key === 'blood' && RE_BLOOD_GROUP.test(mv.text)) && (mv.text.replace(/[^A-Za-z0-9]/g, '').length <= 3 || tokenConfidence(mv.tokens) < 45);
        if (!mv || weak) mv = valueBelowLabel(lines, li, field.detect.re, claimed) ?? (mv && !weak ? mv : mv && mv.text.replace(/[^A-Za-z0-9]/g, '').length > 3 ? mv : null);
        // A person-name field never takes institution/document boilerplate as its value.
        if (mv && ['name', 'father', 'guardian'].includes(field.key) && RE_CARD_BOILERPLATE.test(mv.text)) mv = null;
        // Postal addresses run over several lines: extend the value downwards while
        // the next line follows closely and is not another labelled field.
        if (mv && field.key === 'address') {
          let last = mv.tokens;
          for (let extra = 0; extra < 3; extra++) {
            const lastIdx = lines.findIndex((l) => l.includes(last[0]));
            const cand = lines[lastIdx + 1];
            if (!cand || cand[0].page !== last[0].page) break;
            const y1 = Math.max(...last.map((t) => t.y + t.height));
            const h = Math.max(...last.map((t) => t.height));
            const candText = cand.map((t) => t.text).join(' ');
            if (Math.min(...cand.map((t) => t.y)) - y1 > h * 1.2) break;
            if (/[:：]/.test(candText) || RE_LABEL_WORDS.test(candText) || cand.some((t) => claimed.has(t.id))) break;
            if (!/[A-Za-z0-9]{2}/.test(candText)) break;
            mv = { text: `${mv.text} ${candText}`.trim(), tokens: [...mv.tokens, ...cand] };
            last = cand;
          }
        }
        if (mv && !isClaimed(mv.tokens)) {
          claim(mv.tokens);
          targets.push({
            id: `field_${field.key}_${counter++}`,
            label: field.label,
            classification: field.classification,
            extractedValue: mv.text,
            ...unionBox(mv.tokens),
            page: mv.tokens[0].page,
            action: field.action,
            source: 'OCR_AUTO',
            confidence: tokenConfidence(mv.tokens),
            fieldKey: field.key,
          });
        }
      }
    }
  }

  // Age witness: score every date on the page — a birth-labelled line wins,
  // issue/enrolment/print dates lose, rotated edge text (tall narrow boxes) loses.
  // Burns the DOB and carries age as the numeric value for the ZK predicate.
  let dobLineIdx = -1;
  if (ageField) {
    interface DobCand { li: number; mt: LineMatch; age: number; score: number }
    const cands: DobCand[] = [];
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const lineText = line.map((t) => t.text).join(' ');
      const birthLabelled = RE_BIRTH_LINE.test(lineText);
      let mt = matchInLine(line, RE_DATE)[0];
      let age = mt ? ageFromDobText(mt.text) : null;
      if ((!mt || age === null) && birthLabelled) {
        mt = matchInLine(line, RE_YEAR)[0];
        age = mt ? ageFromYearText(mt.text) : null;
      }
      if (!mt || age === null || isClaimed(mt.tokens)) continue;
      const box = unionBox(mt.tokens, 0);
      let score = 0;
      if (birthLabelled) score += 100;
      if (RE_NON_BIRTH_DATE.test(lineText)) score -= 100;
      if (box.height > box.width * 1.3) score -= 60; // vertical / rotated text
      cands.push({ li, mt, age, score });
    }
    cands.sort((a, b) => b.score - a.score || a.li - b.li);
    const best = cands[0];
    if (best) {
      claim(best.mt.tokens);
      dobLineIdx = best.li;
      targets.push({
        id: `field_${ageField.key}_${counter++}`,
        label: ageField.label,
        classification: ageField.classification,
        extractedValue: best.mt.text,
        numericValue: best.age,
        satisfiesThreshold: best.age >= opts.thresholdValue,
        ...unionBox(best.mt.tokens),
        page: best.mt.tokens[0].page,
        action: ageField.action,
        source: 'OCR_AUTO',
        confidence: tokenConfidence(best.mt.tokens),
        fieldKey: ageField.key,
      });
    }
  }

  // Demographic-column anchor for the name/photo layout: the DOB line, else a
  // birth-labelled line, else the gender line (never depends on a correct DOB).
  const genderLineIdx = lines.findIndex((l) => RE_GENDER_LINE.test(l.map((t) => t.text).join(' ')));
  const birthLabelIdx = lines.findIndex((l) => RE_BIRTH_LINE.test(l.map((t) => t.text).join(' ')));
  const anchorIdx = dobLineIdx >= 0 ? dobLineIdx : patternDobLineIdx >= 0 ? patternDobLineIdx : birthLabelIdx >= 0 ? birthLabelIdx : genderLineIdx;
  const nameAlreadyFound = targets.some((t) => t.fieldKey === 'name');

  // Name: on Aadhaar the name sits directly above the DOB line, left-aligned
  // in the same column. It may be Hindi or Latin script. Require column
  // alignment + real letters so
  // OCR speckle elsewhere on the card can never be mistaken for a name.
  let nameLineIdx = -1;
  if (nameAboveField && anchorIdx > 0 && !nameAlreadyFound) {
    const anchorLine = lines[anchorIdx];
    const dobX0 = Math.min(...anchorLine.map((t) => t.x));
    const dobH = Math.max(...anchorLine.map((t) => t.height));
    const dobY0 = Math.min(...anchorLine.map((t) => t.y));
    for (let li = anchorIdx - 1; li >= Math.max(0, anchorIdx - 4); li--) {
      const line = lines[li];
      const lineText = line.map((t) => t.text).join(' ').trim();
      if (!lineText || RE_AADHAAR_BOILERPLATE.test(lineText) || RE_CARD_BOILERPLATE.test(lineText)) continue;
      if (RE_GUARDIAN_LINE.test(lineText)) continue; // "S/O …" is the guardian, not the holder
      if (/\b(?:name|d\.?o\.?b|birth|roll|course|class|branch|reg)\b|(?:नाम|जन्म|तिथि|वर्ष)/i.test(lineText) && nameCharacters(lineText).length <= 12) continue; // a bare label
      const letters = nameCharacters(lineText);
      if (letters.length < 3 || letters.length / lineText.replace(/\s/g, '').length < 0.7) continue;
      // Only the cluster that shares the DOB column is the name; anything to the
      // right (QR/photo speckle read as "words") is discarded from text AND box.
      const cluster = clusterByGap(line).find((c) => Math.abs(Math.min(...c.map((t) => t.x)) - dobX0) <= dobH * 3);
      if (!cluster) continue;
      const lineY1 = Math.max(...cluster.map((t) => t.y + t.height));
      if (dobY0 - lineY1 > dobH * 4) continue; // too far above to be the adjacent name line
      const toks = cluster.filter((t) => !claimed.has(t.id));
      if (!toks.length) continue;
      const clusterText = toks.map((t) => t.text).join(' ').trim();
      if (nameCharacters(clusterText).length < 3) continue;
      claim(toks);
      nameLineIdx = li;
      targets.push({
        id: `field_${nameAboveField.key}_${counter++}`,
        label: nameAboveField.label,
        classification: nameAboveField.classification,
        extractedValue: clusterText,
        ...unionBox(toks),
        page: toks[0].page,
        action: nameAboveField.action,
        source: 'OCR_AUTO',
        confidence: tokenConfidence(toks),
        fieldKey: nameAboveField.key,
      });
      break;
    }
  }

  // Photo: the Aadhaar portrait sits immediately left of the demographic column
  // and spans roughly twice the name→gender block height (portrait ~4:5).
  // Layout-inferred (no face detection) — clearly labelled, user can remove it.
  if (photoField && anchorIdx >= 0) {
    const topLine = lines[nameLineIdx >= 0 ? nameLineIdx : anchorIdx];
    const bottomLine = lines[genderLineIdx >= 0 ? genderLineIdx : anchorIdx];
    const anchorLine = lines[anchorIdx];
    const colX0 = Math.min(...anchorLine.map((t) => t.x));
    const lineH = Math.max(...anchorLine.map((t) => t.height));
    const top = Math.min(...topLine.map((t) => t.y));
    const bottom = Math.max(...bottomLine.map((t) => t.y + t.height));
    const block = bottom - top;
    if (block >= lineH) {
      // Ratios measured on a real Aadhaar front: portrait height ≈ 2.7× the
      // name→gender block, portrait ≈ 4:5, ~1.3 line-heights left of the column.
      const photoH = block * 2.7;
      const photoW = photoH * 0.8;
      const x1 = colX0 - lineH * 1.3;
      const x0 = Math.max(0, x1 - photoW);
      const y0 = Math.max(0, top - photoH * 0.15);
      if (x1 - x0 >= lineH * 2) {
        targets.push({
          id: `field_${photoField.key}_${counter++}`,
          label: photoField.label,
          classification: photoField.classification,
          extractedValue: '[image region · inferred from card layout]',
          x: Math.round(x0),
          y: Math.round(y0),
          width: Math.round(x1 - x0),
          height: Math.round(photoH),
          page: anchorLine[0].page,
          action: photoField.action,
          source: 'OCR_AUTO',
          fieldKey: photoField.key,
        });
      }
    }
  }

  // Name printed with no label at all (most student IDs): the most prominent
  // Title-Case / CAPS line of 2-4 words that is not institution boilerplate.
  if (prominentNameField && !targets.some((t) => t.fieldKey === 'name')) {
    let best: { toks: ExtractedSpatialToken[]; score: number } | null = null;
    for (const line of lines) {
      const toks = line.filter((t) => !claimed.has(t.id));
      const text = toks.map((t) => t.text).join(' ').trim();
      if (!text || /\d/.test(text) || RE_DEVANAGARI.test(text)) continue;
      const words = text.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
      const letters = text.replace(/[^A-Za-z]/g, '');
      if (words.length < 2 || words.length > 4 || letters.length < 5) continue;
      if (letters.length / text.replace(/\s/g, '').length < 0.85) continue; // mostly letters
      if (RE_CARD_BOILERPLATE.test(text) || RE_AADHAAR_BOILERPLATE.test(text) || RE_GUARDIAN_LINE.test(text) || RE_LABEL_WORDS.test(text)) continue;
      const titleCase = words.every((w) => /^[A-Z][a-z'.-]+$/.test(w));
      const allCaps = words.every((w) => /^[A-Z][A-Z'.-]+$/.test(w));
      if (!titleCase && !allCaps) continue;
      const h = Math.max(...toks.map((t) => t.height));
      const score = h * (titleCase ? 1.15 : 1);
      if (!best || score > best.score) best = { toks, score };
    }
    if (best) {
      claim(best.toks);
      targets.push({
        id: `field_${prominentNameField.key}_${counter++}`,
        label: prominentNameField.label,
        classification: prominentNameField.classification,
        extractedValue: best.toks.map((t) => t.text).join(' ').trim(),
        ...unionBox(best.toks),
        page: best.toks[0].page,
        action: prominentNameField.action,
        source: 'OCR_AUTO',
        confidence: tokenConfidence(best.toks),
        fieldKey: prominentNameField.key,
      });
    }
  }

  // Generic ID cards: the portrait sits in the empty column left of the text
  // block. Only inferred when the text block starts well inside the page.
  if (cardPhotoField && !targets.some((t) => t.fieldKey === 'photo')) {
    const pageTargets = targets.filter((t) => t.page === (targets[0]?.page ?? 1) && t.action !== 'DETECT_ONLY');
    if (pageTargets.length >= 2) {
      const pageW = Math.max(...tokens.map((t) => t.x + t.width));
      const pageH = Math.max(...tokens.map((t) => t.y + t.height));
      const colX0 = Math.min(...pageTargets.map((t) => t.x));
      const top = Math.min(...pageTargets.map((t) => t.y));
      const bottom = Math.max(...pageTargets.map((t) => t.y + t.height));
      const lineH = Math.max(12, Math.min(...pageTargets.map((t) => t.height)));
      const leftTokens = tokens.filter(
        (t) => t.page === pageTargets[0].page && t.x + t.width < colX0 - lineH && t.y > top - lineH * 2 && t.y < top + (bottom - top) * 0.6 && t.text.replace(/[^A-Za-z]/g, '').length >= 3
      );
      if (colX0 > pageW * 0.22 && leftTokens.length <= 2) {
        const x0 = Math.max(0, Math.round(lineH * 0.5));
        const x1 = Math.round(colX0 - lineH * 0.8);
        const height = Math.min(bottom - top + lineH * 2, pageH - top);
        const width = x1 - x0;
        if (width >= lineH * 2.5 && height >= lineH * 3) {
          targets.push({
            id: `field_${cardPhotoField.key}_${counter++}`,
            label: cardPhotoField.label,
            classification: cardPhotoField.classification,
            extractedValue: '[image region · inferred from card layout]',
            x: x0,
            y: Math.max(0, Math.round(top - lineH)),
            width: Math.round(Math.min(width, height * 0.9)),
            height: Math.round(height),
            page: pageTargets[0].page,
            action: cardPhotoField.action,
            source: 'OCR_AUTO',
            fieldKey: cardPhotoField.key,
          });
        }
      }
    }
  }
  // Centred layouts (photo between the header and the name): the largest
  // text-free vertical gap on the first page, at least four lines tall.
  if (cardPhotoField && !targets.some((t) => t.fieldKey === 'photo')) {
    const firstPage = Math.min(...tokens.map((t) => t.page));
    const pageLines = lines.filter((l) => l[0].page === firstPage);
    if (pageLines.length >= 3) {
      const heights = pageLines.map((l) => Math.max(...l.map((t) => t.height))).sort((a, b) => a - b);
      const medianH = heights[Math.floor(heights.length / 2)];
      const pageTokens = tokens.filter((t) => t.page === firstPage);
      const minX = Math.min(...pageTokens.map((t) => t.x));
      const maxX = Math.max(...pageTokens.map((t) => t.x + t.width));
      let bestGap = 0;
      let gapTop = 0;
      for (let i = 0; i + 1 < pageLines.length; i++) {
        const y1 = Math.max(...pageLines[i].map((t) => t.y + t.height));
        const y0 = Math.min(...pageLines[i + 1].map((t) => t.y));
        if (y0 - y1 > bestGap) {
          bestGap = y0 - y1;
          gapTop = y1;
        }
      }
      if (bestGap >= medianH * 4) {
        // The portrait fills almost the whole gap (hair often starts right under the header).
        const height = Math.round(bestGap * 0.96);
        const width = Math.round(Math.min(height * 0.85, (maxX - minX) * 0.75));
        const cx = (minX + maxX) / 2;
        targets.push({
          id: `field_${cardPhotoField.key}_${counter++}`,
          label: cardPhotoField.label,
          classification: cardPhotoField.classification,
          extractedValue: '[image region · inferred from card layout]',
          x: Math.max(0, Math.round(cx - width / 2)),
          y: Math.round(gapTop + bestGap * 0.02),
          width,
          height,
          page: firstPage,
          action: cardPhotoField.action,
          source: 'OCR_AUTO',
          fieldKey: cardPhotoField.key,
        });
      }
    }
  }

  // Currency / numeric witness selection.
  if (currencyFields.length > 0) {
    const witnessField = currencyFields.find((f) => f.isWitness);
    // Per-document label ranking (best first): "Closing balance" beats "balance",
    // "Net pay" beats "Gross salary", "Total income" beats any "income".
    const labelSets: RegExp[] =
      witnessField?.detect.kind === 'currency' && witnessField.detect.witnessLabels?.length ? witnessField.detect.witnessLabels : [RE_INCOME_LINE];
    const cands: {
      tokens: ExtractedSpatialToken[];
      text: string;
      value: number;
      rank: number;
      confidence: number;
    }[] = [];
    for (const line of lines) {
      const lineText = line.map((t) => t.text).join(' ');
      const rankOf = labelSets.findIndex((re) => re.test(lineText));
      for (const mt of matchInLine(line, SCENARIO_CURRENCY)) {
        if (isClaimed(mt.tokens)) continue;
        const value = parseAmount(mt.text);
        if (!(value > 0)) continue;
        claim(mt.tokens);
        cands.push({
          tokens: mt.tokens,
          text: mt.text,
          value,
          rank: rankOf < 0 ? Number.POSITIVE_INFINITY : rankOf,
          confidence: tokenConfidence(mt.tokens),
        });
      }
    }
    let witnessIdx = -1;
    if (witnessField && cands.length > 0) {
      const bestRank = Math.min(...cands.map((c) => c.rank));
      if (Number.isFinite(bestRank)) {
        // Among equally well-labelled amounts take the last one in reading
        // order: statements end with the closing balance, slips with net pay.
        cands.forEach((c, i) => { if (c.rank === bestRank) witnessIdx = i; });
      } else {
        witnessIdx = cands.findIndex((c) => c.value >= opts.thresholdValue);
        if (witnessIdx < 0) witnessIdx = cands.reduce((best, c, i, arr) => (c.value > arr[best].value ? i : best), 0);
      }
    }
    cands.forEach((c, i) => {
      const isW = !!witnessField && i === witnessIdx;
      if (isW && witnessField) {
        targets.push({
          id: `field_${witnessField.key}_${counter++}`,
          label: witnessField.label,
          classification: witnessField.classification,
          extractedValue: c.text,
          numericValue: c.value,
          satisfiesThreshold: c.value >= opts.thresholdValue,
          ...unionBox(c.tokens),
          page: c.tokens[0].page,
          action: 'PROVE_AND_BURN',
          source: 'OCR_AUTO',
          confidence: c.confidence,
          fieldKey: witnessField.key,
        });
      } else {
        targets.push({
          id: `field_amount_${counter++}`,
          label: 'Financial Figure',
          classification: 'Financial Amount (Sensitive)',
          extractedValue: c.text,
          numericValue: c.value,
          ...unionBox(c.tokens),
          page: c.tokens[0].page,
          action: 'DIRECT_BURN',
          source: 'OCR_AUTO',
          confidence: c.confidence,
          fieldKey: 'amount',
        });
      }
    });
  }

  // Fallback: surface substantial tokens so uploads always yield candidates.
  if (targets.length === 0) {
    tokens
      .filter((t) => t.text.replace(/\s/g, '').length >= 4)
      .slice(0, 2)
      .forEach((t, i) =>
        targets.push({
          id: `field_generic_${i}`,
          label: `Extracted Field ${i + 1}`,
          classification: 'Sensitive Document Content',
          extractedValue: t.text,
          ...unionBox([t]),
          page: t.page,
          action: 'DIRECT_BURN',
          source: 'OCR_AUTO',
          confidence: t.confidence ?? 100,
        })
      );
  }

  const rank = (a: ClassifiedTarget['action']) =>
    a === 'PROVE_AND_BURN' ? 0 : a === 'DIRECT_BURN' ? 1 : 2;
  targets.sort((a, b) => rank(a.action) - rank(b.action) || a.y - b.y);
  return targets;
}

export async function extractDocumentSpatial(
  doc: { mimeType: string; rawBytes?: Uint8Array; fileObj?: File },
  canvas: HTMLCanvasElement,
  thresholdValue: number,
  onProgress?: OcrProgressFn,
  scenarioId?: string,
  pdfPassword?: string
): Promise<DocumentExtractionResult> {
  const start = performance.now();

  let core: ExtractionCore = {
    tokens: [],
    rawText: '',
    meanConfidence: 0,
    width: canvas.width,
    height: canvas.height,
    numPages: 1,
    usedOcrFallback: false,
    pageRasters: new Map(),
    engineLabel: 'Inert · Unsupported Document Type',
  };

  if (doc.mimeType === 'application/pdf' && doc.rawBytes) {
    core = await extractPdfDocument(doc.rawBytes, canvas, onProgress, pdfPassword, scenarioId);
  } else if (doc.fileObj && doc.mimeType.startsWith('image/')) {
    core = await extractImageDocument(doc.fileObj, canvas, onProgress, scenarioId);
  }

  const scenario = getScenario(scenarioId ?? DEFAULT_SCENARIO_ID);
  const targets = classifyForScenario(core.tokens, scenario, { thresholdValue });
  if (import.meta.env.DEV) {
    // Dev-only diagnostics (stripped from production builds): never logs document text in prod.
    console.debug('[ocr:dev] lines:', groupLines(core.tokens).map((l) => l.map((t) => t.text).join(' ')));
  }
  return {
    ...core,
    targets,
    engineName: core.engineLabel,
    latencyMs: Math.max(1, Math.round(performance.now() - start)),
  };
}
