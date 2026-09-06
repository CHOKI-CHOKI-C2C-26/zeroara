import { useState, useRef, useEffect, type ReactNode } from 'react';
import './App.css';
import {
  sha256Hex,
  formatChunkedHash,
  generateSamplePdfBytes,
  generateSampleAadhaarPng,
  extractDocumentSpatial,
  classifyForScenario,
  checkSuryaHealth,
  PdfPasswordRequiredError,
  type SuryaHealth,
  createFlattenedRedactedPdf,
  downloadFile,
  generateIncomeThresholdProof,
  verifyIncomeProof,
  computeMasterAuditSeal,
  type ExtractedSpatialToken,
  type ClassifiedTarget,
  type TargetAction,
  type RedactionResult,
  type Groth16ProofResult,
  type MasterSealResult,
  type ZeroaraAuditPackage,
  type SessionContext,
} from './core/zeroara';
import {
  UploadCloud,
  FileText,
  Copy,
  Check,
  RefreshCw,
  Building2,
  ShieldCheck,
  WifiOff,
  CheckCircle2,
  Crosshair,
  ArrowLeft,
  ArrowRight,
  Trash2,
  SlidersHorizontal,
  Flame,
  Download,
  Eye,
  EyeOff,
  Lock,
  Cpu,
  Fingerprint,
  AlertTriangle,
  Binary,
  ExternalLink,
  Globe,
  LayoutDashboard,
  ScanLine,
  Loader2,
  KeyRound,
  Info,
} from 'lucide-react';
import { Accordion, Drawer, Select, StatusBadge, KV, HashBlock, ChecklistItem } from './components/ui';
import { VerifierDemoSite, type VerifierRequest, type VerifierResult } from './components/VerifierDemoSite';
import {
  VerifierPortalView,
  HardwareEnclaveView,
  TransportProtocolView,
} from './layers';
import { SCENARIOS, getScenario, isProofBacked } from './core/scenarios';

export interface IngestedDoc {
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  hashHex: string;
  chunkedHash: string;
  timestamp: string;
  isSample: boolean;
  rawBytes?: Uint8Array;
  fileObj?: File;
}

export interface EnterpriseSpec {
  documentCategory: string; // scenario id (e.g. 'aadhaar', 'salary_slip')
  requesterName: string;
  purpose: string;
  targetField: string;
  predicate: string;
  thresholdValue: number;
  currency: string; // currency / unit; '' for non-numeric scenarios
  challengeNonce: string;
  requiredRedactionFields: string[];
}

export interface OcrTelemetrySummary {
  latencyMs: number;
  tokenCount: number;
  engineName: string;
  targetsFound: number;
}

export type StageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
// MVP surface: stages 7-8 (enclave/transport) are scaffolds and hidden from the stepper.
export const MAX_STAGE: StageNumber = 6;

export const STAGE_CONFIG: Record<StageNumber, { title: string; subtitle: string; telemetryTitle: string }> = {
  1: {
    title: 'Document Ingest & SHA-256 Preimage Digest',
    subtitle: 'Loads raw file into private browser RAM isolate and anchors immutable 256-bit root hash.',
    telemetryTitle: 'Stage 1: Preimage Cryptographic Telemetry',
  },
  2: {
    title: 'Spatial OCR & Target Geometry Extraction',
    subtitle: 'Parses exact pixel coordinates [x, y, w, h] to classify sensitive PII zones and witness targets.',
    telemetryTitle: 'Stage 2: OCR Spatial Geometry Telemetry',
  },
  3: {
    title: 'Physical Pixel Burning & Stream Stripping',
    subtitle: 'Overwrites visual pixels with solid #000000 and purges underlying PDF text stream objects.',
    telemetryTitle: 'Stage 3: Redaction Sanitization Audit',
  },
  4: {
    title: 'Client-Side Groth16 Zero-Knowledge Prover',
    subtitle: 'Executes bilinear pairing constraints over BN128 curve in zero knowledge with 0 private bytes leaked.',
    telemetryTitle: 'Stage 4: Groth16 zk-SNARK Telemetry',
  },
  5: {
    title: 'Quad-Factor Master Audit Seal Generation',
    subtitle: 'Bonds Preimage Digest, Bounding Geometry, Poseidon Commitment, and SNARK Proof into an unforgeable seal.',
    telemetryTitle: 'Stage 5: Master Audit Seal Telemetry',
  },
  6: {
    title: 'Standalone Enterprise Verifier Portal',
    subtitle: 'External compliance auditor evaluating 5 mathematical verification gates with built-in attack simulator.',
    telemetryTitle: 'Stage 6: Enterprise Verifier Suite',
  },
  7: {
    title: 'Hardware Enclave & TPM 2.0 Attestation',
    subtitle: 'Hardware security module: physical TPM 2.0 & Apple Secure Enclave root key attestation with POSIX mlock.',
    telemetryTitle: 'Stage 7: Hardware Enclave Blueprint',
  },
  8: {
    title: 'Web-to-Desktop Transport Protocol',
    subtitle: 'zeroara:// deep linking and local loopback IPC for sovereign cross-domain web attestation.',
    telemetryTitle: 'Stage 8: Transport Protocol Specification',
  },
};

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function resolveUploadMimeType(file: File): string | null {
  if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
    return file.type;
  }

  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_MIME_BY_EXTENSION[extension] ?? (extension === 'pdf' ? 'application/pdf' : null);
}

// One-click verification requirements per document type (single-select in Stage 1).
const REQUIREMENT_PRESETS: Record<string, { label: string; threshold: number; unit: string }[]> = {
  aadhaar: [
    { label: 'Age ≥ 18 years', threshold: 18, unit: 'years' },
    { label: 'Age ≥ 21 years', threshold: 21, unit: 'years' },
  ],
  income_accredited: [
    { label: 'Net income ≥ USD 100,000', threshold: 100000, unit: 'USD' },
    { label: 'Net income ≥ USD 150,000', threshold: 150000, unit: 'USD' },
    { label: 'Net income ≥ USD 80,000', threshold: 80000, unit: 'USD' },
  ],
  salary_slip: [
    { label: 'Net pay ≥ INR 50,000', threshold: 50000, unit: 'INR' },
    { label: 'Net pay ≥ INR 1,00,000', threshold: 100000, unit: 'INR' },
  ],
  bank_statement: [
    { label: 'Balance ≥ INR 50,000', threshold: 50000, unit: 'INR' },
    { label: 'Balance ≥ INR 2,00,000', threshold: 200000, unit: 'INR' },
  ],
  tax_form: [
    { label: 'Declared income ≥ INR 2,50,000', threshold: 250000, unit: 'INR' },
    { label: 'Declared income ≥ INR 5,00,000', threshold: 500000, unit: 'INR' },
  ],
  generic_financial: [
    { label: 'Amount ≥ INR 50,000', threshold: 50000, unit: 'INR' },
    { label: 'Amount ≥ INR 1,00,000', threshold: 100000, unit: 'INR' },
  ],
};

const ACTION_LABEL: Record<TargetAction, string> = {
  PROVE_AND_BURN: 'prove + burn',
  DIRECT_BURN: 'burn',
  DETECT_ONLY: 'detect only',
};

const SMALL_LABEL = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--fg-muted)' } as const;
const LABEL_STYLE = { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--fg-muted)' } as const;

export function App() {
  const [stage, setStage] = useState<StageNumber>(1);
  const [doc, setDoc] = useState<IngestedDoc | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedRedacted, setCopiedRedacted] = useState(false);
  const [copiedProof, setCopiedProof] = useState(false);
  const [copiedSeal, setCopiedSeal] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [showHudOverlays, setShowHudOverlays] = useState(true);

  // Phase 3 Burning & Flattening State
  const [isBurning, setIsBurning] = useState(false);
  const [redactionResult, setRedactionResult] = useState<RedactionResult | null>(null);
  const [viewMode, setViewMode] = useState<'BURNED' | 'ORIGINAL'>('ORIGINAL');

  // Phase 4 ZK Prover Engine State
  const [isProving, setIsProving] = useState(false);
  const [isVerifyingAgain, setIsVerifyingAgain] = useState(false);
  const [proofResult, setProofResult] = useState<Groth16ProofResult | null>(null);
  const [proofVerified, setProofVerified] = useState<boolean | null>(null);
  const [proofVerifyLatencyMs, setProofVerifyLatencyMs] = useState<number | null>(null);
  const [proverError, setProverError] = useState<string | null>(null);
  const [invalidationMessage, setInvalidationMessage] = useState<string | null>(null);
  const [showWitnessSecret, setShowWitnessSecret] = useState(false);

  // Phase 5 Master Audit Seal & Verifier Package State
  const [isSealing, setIsSealing] = useState(false);
  const [masterSeal, setMasterSeal] = useState<MasterSealResult | null>(null);
  const [auditPackage, setAuditPackage] = useState<ZeroaraAuditPackage | null>(null);
  // Progressive disclosure + external verifier handshake
  const [activeView, setActiveView] = useState<'workspace' | 'demo'>('workspace');
  const [verifierRequest, setVerifierRequest] = useState<VerifierRequest | null>(null);
  const [verifierResult, setVerifierResult] = useState<VerifierResult | null>(null);
  const [showProofDetails, setShowProofDetails] = useState(false);
  const [customThreshold, setCustomThreshold] = useState(false);

  // Real OCR & Extraction Pipeline State
  const [detectedFields, setDetectedFields] = useState<ClassifiedTarget[]>([]);
  const [extractedTokens, setExtractedTokens] = useState<ExtractedSpatialToken[]>([]);
  const [ocrTelemetry, setOcrTelemetry] = useState<OcrTelemetrySummary | null>(null);
  const [suryaStatus, setSuryaStatus] = useState<SuryaHealth>({ online: false, ready: false });
  // Password-protected PDFs (e-Aadhaar): prompt inline, then re-run extraction.
  const [pdfPassword, setPdfPassword] = useState<string>('');
  const [pdfPasswordDraft, setPdfPasswordDraft] = useState<string>('');
  const [pdfLocked, setPdfLocked] = useState<{ incorrect: boolean } | null>(null);

  // Poll the local Surya OCR sidecar so Stage 2 can say which engine will run.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const s = await checkSuryaHealth();
      if (alive) setSuryaStatus(s);
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const pageRastersRef = useRef<Map<number, ImageData>>(new Map());

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cleanCanvasDataRef = useRef<ImageData | null>(null);

  // Document scenario + enterprise/verifier spec state
  const INITIAL_SCENARIO = getScenario('income_accredited');
  const [enterpriseSpec, setEnterpriseSpec] = useState<EnterpriseSpec>({
    documentCategory: INITIAL_SCENARIO.id,
    requesterName: INITIAL_SCENARIO.defaults.requesterName,
    purpose: INITIAL_SCENARIO.defaults.purpose,
    targetField: INITIAL_SCENARIO.fields.find((f) => f.isWitness)?.label ?? INITIAL_SCENARIO.fields[0].label,
    predicate: INITIAL_SCENARIO.defaults.predicate,
    thresholdValue: INITIAL_SCENARIO.defaults.thresholdValue,
    currency: INITIAL_SCENARIO.defaults.unit,
    challengeNonce: '0x94f8a2bc710e39b4d1c68f12a03',
    requiredRedactionFields: INITIAL_SCENARIO.fields.map((f) => f.label),
  });

  // Derived: the active scenario and whether it can drive a numeric ZK predicate.
  const scenario = getScenario(enterpriseSpec.documentCategory);
  const scenarioProofBacked = isProofBacked(scenario);

  // Switch the active document scenario: reset the verifier spec to the
  // scenario's defaults and re-rank OCR targets for the new field set.
  const applyScenario = (scenarioId: string) => {
    const next = getScenario(scenarioId);
    setEnterpriseSpec((prev) => ({
      ...prev,
      documentCategory: next.id,
      requesterName: next.defaults.requesterName,
      purpose: next.defaults.purpose,
      targetField: next.fields.find((f) => f.isWitness)?.label ?? next.fields[0].label,
      predicate: next.defaults.predicate,
      thresholdValue: next.defaults.thresholdValue,
      currency: next.defaults.unit,
      requiredRedactionFields: next.fields.map((f) => f.label),
    }));
    if (extractedTokens.length > 0) {
      const targets = classifyForScenario(extractedTokens, next, {
        thresholdValue: next.defaults.thresholdValue,
      });
      setDetectedFields(targets);
      setSelectedFieldId(targets[0]?.id ?? null);
    }
    invalidateDownstreamState('Scenario changed — re-run redaction, proof, and seal.');
  };

  // Core Document Extraction Pipeline running on mounted canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc || !doc.rawBytes) return;

    let isCancelled = false;

    const runExtraction = async () => {
      setOcrRunning(true);

      try {
        const result = await extractDocumentSpatial(
          doc,
          canvas,
          enterpriseSpec.thresholdValue,
          undefined,
          enterpriseSpec.documentCategory,
          pdfPassword || undefined
        );
        setPdfLocked(null);

        if (isCancelled) return;

        pageRastersRef.current = result.pageRasters;
        setTotalPages(result.numPages);
        setCurrentPage(1);

        // Cache the pristine rendered document raster for the first page
        const firstPageRaster = result.pageRasters.get(1);
        if (firstPageRaster) {
          cleanCanvasDataRef.current = firstPageRaster;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            canvas.width = firstPageRaster.width;
            canvas.height = firstPageRaster.height;
            ctx.putImageData(firstPageRaster, 0, 0);
          }
        }

        setExtractedTokens(result.tokens);
        setDetectedFields(result.targets);
        if (result.targets.length > 0) {
          setSelectedFieldId(result.targets[0].id);
        }

        setOcrTelemetry({
          latencyMs: result.latencyMs,
          tokenCount: result.tokens.length,
          engineName: result.engineName,
          targetsFound: result.targets.length,
        });

        // Overlay bounding boxes for page 1 if in Phase 2
        if (stage === 2 && showHudOverlays) {
          const pageFields = result.targets.filter(f => f.page === 1);
          drawBoundingBoxOverlays(canvas, pageFields, result.targets[0]?.id || null);
        }
      } catch (err) {
        if (err instanceof PdfPasswordRequiredError) {
          setPdfLocked({ incorrect: err.incorrect });
        } else {
          console.error('Document spatial processing error:', err);
        }
      } finally {
        if (!isCancelled) {
          setOcrRunning(false);
        }
      }
    };

    runExtraction();

    return () => {
      isCancelled = true;
    };
  }, [doc, pdfPassword]);

  // Synchronous blit & redraw overlays whenever Stage, HUD toggle, target selection, or page changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cleanCanvasDataRef.current) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Restore pristine document raster for current page
    ctx.putImageData(cleanCanvasDataRef.current, 0, 0);

    // Draw active bounding box overlays if in Stage 2
    if (stage === 2 && showHudOverlays && detectedFields.length > 0) {
      const pageFields = detectedFields.filter(f => f.page === currentPage);
      drawBoundingBoxOverlays(canvas, pageFields, selectedFieldId);
    }
  }, [stage, showHudOverlays, selectedFieldId, detectedFields, currentPage]);

  const renderCurrentPage = (pageNum: number) => {
    const canvas = canvasRef.current;
    const raster = pageRastersRef.current.get(pageNum);
    if (!canvas || !raster) return;

    cleanCanvasDataRef.current = raster;
    canvas.width = raster.width;
    canvas.height = raster.height;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(raster, 0, 0);
      if (stage === 2 && showHudOverlays) {
        const pageFields = detectedFields.filter(f => f.page === pageNum);
        drawBoundingBoxOverlays(canvas, pageFields, selectedFieldId);
      }
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      const next = currentPage - 1;
      setCurrentPage(next);
      renderCurrentPage(next);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      const next = currentPage + 1;
      setCurrentPage(next);
      renderCurrentPage(next);
    }
  };

  // Execute Stage 3: Physical Pixel Burning & Text Stream Stripping
  const executePixelBurn = async () => {
    const canvas = canvasRef.current;
    if (!canvas || detectedFields.length === 0) return;

    setIsBurning(true);
    try {
      // Burn every page raster (as OCR saw them); DETECT_ONLY fields are flagged, never burned.
      const result = await createFlattenedRedactedPdf(
        pageRastersRef.current,
        totalPages,
        detectedFields.filter((f) => f.action !== 'DETECT_ONLY')
      );
      setRedactionResult(result);
      setViewMode('BURNED');
      // Set to page 1 to show the first burned page in UI properly
      setCurrentPage(1);
      renderCurrentPage(1);
      setStage(3);
    } catch (err) {
      console.error('Redaction flattening error:', err);
    } finally {
      setIsBurning(false);
    }
  };

  // Invalidation handler for downstream cryptographic state
  const invalidateDownstreamState = (reason?: string) => {
    if (proofResult || masterSeal || auditPackage || proofVerified !== null) {
      setProofResult(null);
      setProofVerified(null);
      setProofVerifyLatencyMs(null);
      setMasterSeal(null);
      setAuditPackage(null);
      if (reason) {
        setInvalidationMessage(reason);
      }
    }
  };

  // Execute Stage 4: Generate Client-Side Groth16 Zero-Knowledge Proof
  const executeZkProof = async () => {
    setProverError(null);
    setInvalidationMessage(null);

    const witness = detectedFields.find(
      (f) => f.action === 'PROVE_AND_BURN' && typeof f.numericValue === 'number'
    );

    // Seal-only scenarios (identity docs) or documents with no numeric witness
    // do NOT receive a fabricated proof. Redaction is bound into the master
    // seal only; the ZK stage is skipped honestly.
    if (!scenarioProofBacked || !witness) {
      setProofResult(null);
      setProofVerified(null);
      setProofVerifyLatencyMs(null);
      setInvalidationMessage(
        scenarioProofBacked
          ? 'No numeric witness detected — proceeding seal-only (no ZK predicate proof generated).'
          : `${scenario.label} is a seal-only document category — redaction is sealed without a numeric predicate proof.`
      );
      setStage(4);
      return;
    }

    setIsProving(true);
    try {
      const sessionCtx: SessionContext = {
        documentDigest: doc?.hashHex || '0x' + '0'.repeat(64),
        requesterName: enterpriseSpec.requesterName,
        purpose: enterpriseSpec.purpose,
        thresholdValue: enterpriseSpec.thresholdValue,
        challengeNonce: enterpriseSpec.challengeNonce,
      };

      const res = await generateIncomeThresholdProof(
        witness.numericValue as number,
        enterpriseSpec.thresholdValue,
        sessionCtx
      );
      setProofResult(res);
      setProofVerified(res.verified);
      setProofVerifyLatencyMs(res.verificationLatencyMs);
      setStage(4);
    } catch (err: any) {
      console.error('Groth16 proving error:', err);
      setProverError(err?.message || 'In-browser Groth16 proof generation failed.');
      setProofResult(null);
      setProofVerified(false);
    } finally {
      setIsProving(false);
    }
  };

  // Execute Independent Phase 4 Verification
  const executeVerifyAgain = async () => {
    if (!proofResult) return;
    setIsVerifyingAgain(true);
    try {
      const verify = await verifyIncomeProof(proofResult.proof, proofResult.publicSignals);
      setProofVerified(verify.isValid);
      setProofVerifyLatencyMs(verify.latencyMs);
    } catch (err) {
      setProofVerified(false);
    } finally {
      setIsVerifyingAgain(false);
    }
  };

  // Execute Phase 5: Generate Quad-Factor Master Audit Seal & Self-Contained Package
  const executeMasterSeal = async () => {
    if (!redactionResult || !doc) return;

    setIsSealing(true);
    try {
      // DETECT_ONLY fields are flagged but not burned, so they are not bound
      // into the geometry of the seal.
      const burnedTargets = detectedFields.filter((f) => f.action !== 'DETECT_ONLY');

      const seal = await computeMasterAuditSeal(
        redactionResult.redactedHashHex,
        burnedTargets,
        proofResult?.commitment ?? '',
        proofResult?.proof ?? null
      );
      setMasterSeal(seal);

      const redactionMode: 'PROOF_BACKED' | 'SEAL_ONLY' = proofResult ? 'PROOF_BACKED' : 'SEAL_ONLY';

      const pkg: ZeroaraAuditPackage = {
        protocol: 'Zeroara Provable Redaction Protocol',
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        scenario: { id: scenario.id, label: scenario.label, category: scenario.category },
        redactionMode,
        sourceDocument: {
          fileName: doc.fileName,
          fileSizeBytes: doc.fileSizeBytes,
          mimeType: doc.mimeType,
          preimageSha256: doc.hashHex,
        },
        sanitizedDocument: {
          fileSizeBytes: redactionResult.fileSizeBytes,
          preimageSha256: redactionResult.redactedHashHex,
          burnedBoundingBoxes: burnedTargets.map((f) => ({
            id: f.id,
            label: f.label,
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            page: f.page,
          })),
          textStreamsDetected: redactionResult.textStreamCount,
        },
        redactedFields: detectedFields.map((f) => ({
          label: f.label,
          classification: f.classification,
          action: f.action,
          fieldKey: f.fieldKey,
        })),
        enterpriseRequirement: {
          requesterName: enterpriseSpec.requesterName,
          purpose: enterpriseSpec.purpose,
          documentCategory: scenario.label,
          targetField: enterpriseSpec.targetField,
          predicate: enterpriseSpec.predicate,
          thresholdValue: enterpriseSpec.thresholdValue,
          currency: enterpriseSpec.currency,
          challengeNonce: enterpriseSpec.challengeNonce,
          requiredRedactionFields: enterpriseSpec.requiredRedactionFields,
        },
        ...(proofResult
          ? {
              zeroKnowledgeProof: {
                curve: proofResult.proof.curve,
                protocol: proofResult.proof.protocol,
                publicSignals: proofResult.publicSignals,
                proof: proofResult.proof,
                poseidonCommitment: proofResult.commitment,
                blindingSalt: proofResult.blindingSalt,
                sessionBinding: proofResult.sessionBinding,
                verified: proofVerified ?? true,
                verificationLatencyMs: proofVerifyLatencyMs ?? 25,
              },
            }
          : {}),
        masterAuditSeal: seal,
      };

      setAuditPackage(pkg);
      setStage(5);
    } catch (err) {
      console.error('Master seal generation error:', err);
    } finally {
      setIsSealing(false);
    }
  };

  const handleDownloadAuditPackage = () => {
    if (!auditPackage) return;
    const jsonStr = JSON.stringify(auditPackage, null, 2);
    const bytes = new TextEncoder().encode(jsonStr);
    downloadFile(bytes, `Zeroara_Audit_Package_${Date.now()}.json`, 'application/json');
  };

  // Ingest uploaded user document
  const handleFileUpload = async (file: File) => {
    const mimeType = resolveUploadMimeType(file);
    if (!mimeType) {
      setUploadError('Choose a PDF or an image file (PNG, JPEG, WebP, GIF, BMP, or AVIF).');
      return;
    }

    setUploadError(null);
    const arrayBuffer = await file.arrayBuffer();
    const rawBytes = new Uint8Array(arrayBuffer);
    const hashHex = await sha256Hex(rawBytes);
    const chunkedHash = formatChunkedHash(hashHex);

    const newDoc: IngestedDoc = {
      fileName: file.name,
      fileSizeBytes: file.size,
      mimeType,
      hashHex,
      chunkedHash,
      timestamp: new Date().toLocaleTimeString(),
      isSample: false,
      rawBytes,
      fileObj: file,
    };

    setPdfPassword('');
    setPdfPasswordDraft('');
    setPdfLocked(null);
    setDoc(newDoc);
    setRedactionResult(null);
    invalidateDownstreamState('New document uploaded — previous proofs and seals cleared.');
    setViewMode('ORIGINAL');
    setStage(1);
  };

  // Ingest synthesized authentic sample PDF document
  const handleLoadSample = async () => {
    // Sample follows the selected scenario: a SPECIMEN Aadhaar raster for the
    // Aadhaar flow (exercises real OCR), the income certificate PDF otherwise.
    const isAadhaar = scenario.id === 'aadhaar';
    const sampleBytes = isAadhaar ? await generateSampleAadhaarPng() : await generateSamplePdfBytes();
    const hashHex = await sha256Hex(sampleBytes);
    const chunkedHash = formatChunkedHash(hashHex);
    const fileName = isAadhaar ? 'Aadhaar_SPECIMEN_sample.png' : 'Accredited_Investor_Verification_ApexLP.pdf';
    const mimeType = isAadhaar ? 'image/png' : 'application/pdf';

    const newDoc: IngestedDoc = {
      fileName,
      fileSizeBytes: sampleBytes.length,
      mimeType,
      hashHex,
      chunkedHash,
      timestamp: new Date().toLocaleTimeString(),
      isSample: true,
      rawBytes: sampleBytes,
      ...(isAadhaar
        ? { fileObj: new File([sampleBytes as unknown as BlobPart], fileName, { type: mimeType }) }
        : {}),
    };

    setPdfPassword('');
    setPdfPasswordDraft('');
    setPdfLocked(null);
    setDoc(newDoc);
    setRedactionResult(null);
    invalidateDownstreamState('Sample document loaded — previous proofs and seals cleared.');
    setViewMode('ORIGINAL');
    setStage(1);
  };

  // Support URL parameters for automated verification & presets
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view')?.toUpperCase();
    if (viewParam === 'VERIFIER') setStage(6);
    else if (viewParam === 'DEMO') setActiveView('demo');
    else if (viewParam === 'ENCLAVE') setStage(7);
    else if (viewParam === 'TRANSPORT') setStage(8);

    const stageParam = params.get('stage') || params.get('phase');
    if (stageParam) {
      const s = parseInt(stageParam, 10);
      if (s >= 1 && s <= MAX_STAGE) setStage(s as StageNumber);
    }

    if (params.get('sample') === 'true') {
      handleLoadSample().then(() => {
        if (stageParam === '2') {
          setStage(2);
        } else if (stageParam === '3') {
          setTimeout(() => {
            executePixelBurn();
          }, 600);
        }
      });
    }
  }, []);

  // Draw real spatial bounding boxes over canvas
  const drawBoundingBoxOverlays = (
    canvas: HTMLCanvasElement,
    fields: ClassifiedTarget[] = detectedFields,
    selectedId: string | null = selectedFieldId
  ) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    fields.forEach((field) => {
      const isSelected = selectedId === field.id;
      const isWitness = field.action === 'PROVE_AND_BURN';
      const mainColor = isWitness ? '#EA580C' : '#0D9488';

      ctx.save();
      // Bounding box fill
      ctx.fillStyle = isWitness ? 'rgba(234, 88, 12, 0.14)' : 'rgba(13, 148, 136, 0.14)';
      ctx.fillRect(field.x, field.y, field.width, field.height);

      // Bounding box stroke
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.setLineDash(isSelected ? [] : [4, 3]);
      ctx.strokeRect(field.x, field.y, field.width, field.height);

      // Spatial HUD Tag Badge
      ctx.setLineDash([]);
      ctx.fillStyle = mainColor;
      ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
      const tagPrefix = isWitness ? 'WITNESS CLAIM' : 'PII IDENTIFIER';
      const badgeText = `${tagPrefix} [x:${field.x}, y:${field.y}, w:${field.width}, h:${field.height}]`;
      
      const badgeY = field.y > 14 ? field.y - 4 : field.y + field.height + 10;
      ctx.fillText(badgeText, field.x, badgeY);

      ctx.restore();
    });
  };

  // Add a specific token as a redaction target
  const handleAddTokenAsTarget = (token: ExtractedSpatialToken) => {
    const newTarget: ClassifiedTarget = {
      id: `manual_${Date.now()}`,
      label: `Redaction Zone: "${token.text.slice(0, 16)}"`,
      classification: 'Manual Redaction Zone',
      extractedValue: token.text,
      x: Math.max(0, token.x - 3),
      y: Math.max(0, token.y - 2),
      width: token.width + 6,
      height: token.height + 4,
      page: token.page,
      action: 'DIRECT_BURN',
      source: 'MANUAL_USER',
    };

    setDetectedFields((prev) => [...prev, newTarget]);
    setSelectedFieldId(newTarget.id);
  };

  // Remove a target
  // Aadhaar: the photo and QR are image regions Surya cannot read as text.
  // Offer one-click suggested regions (proportional to the card) that the user
  // can keep or remove. They burn as DIRECT_BURN and bind into the seal.
  const addRegionTarget = (key: 'photo' | 'qr') => {
    const c = canvasRef.current;
    if (!c) return;
    const spec =
      key === 'photo'
        ? { label: 'Photo (face)', cls: 'Biometric Photo Region', x: 0.06, y: 0.22, w: 0.22, h: 0.42 }
        : { label: 'QR Code', cls: 'Aadhaar QR (encodes demographics)', x: 0.8, y: 0.06, w: 0.16, h: 0.3 };
    const t: ClassifiedTarget = {
      id: `manual_${key}_${Date.now()}`,
      label: spec.label,
      classification: spec.cls,
      extractedValue: '[image region]',
      x: Math.round(spec.x * c.width),
      y: Math.round(spec.y * c.height),
      width: Math.round(spec.w * c.width),
      height: Math.round(spec.h * c.height),
      page: 1,
      action: 'DIRECT_BURN',
      source: 'MANUAL_USER',
      fieldKey: key,
    };
    setDetectedFields((prev) => [...prev.filter((f) => f.fieldKey !== key), t]);
    setSelectedFieldId(t.id);
  };

  const handleRemoveTarget = (id: string) => {
    setDetectedFields((prev) => prev.filter((f) => f.id !== id));
    if (selectedFieldId === id) {
      setSelectedFieldId(null);
    }
  };

  const copyHash = () => {
    if (!doc) return;
    navigator.clipboard.writeText(doc.hashHex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyRedactedHash = () => {
    if (!redactionResult) return;
    navigator.clipboard.writeText(redactionResult.redactedHashHex);
    setCopiedRedacted(true);
    setTimeout(() => setCopiedRedacted(false), 2000);
  };

  const makeNonce = () => {
    const arr = new Uint8Array(12);
    crypto.getRandomValues(arr);
    let hex = '0x';
    arr.forEach((b) => (hex += b.toString(16).padStart(2, '0')));
    return hex;
  };

  const regenerateNonce = () => {
    setEnterpriseSpec((prev) => ({ ...prev, challengeNonce: makeNonce() }));
  };

  // Full workspace reset: document, OCR output, rasters, and every downstream artefact.
  const clearDocument = () => {
    setDoc(null);
    setDetectedFields([]);
    setExtractedTokens([]);
    setOcrTelemetry(null);
    setSelectedFieldId(null);
    setRedactionResult(null);
    setViewMode('ORIGINAL');
    setPdfPassword('');
    setPdfPasswordDraft('');
    setPdfLocked(null);
    setProofResult(null);
    setProofVerified(null);
    setProofVerifyLatencyMs(null);
    setProverError(null);
    setInvalidationMessage(null);
    setMasterSeal(null);
    setAuditPackage(null);
    setShowProofDetails(false);
    setShowWitnessSecret(false);
    pageRastersRef.current = new Map();
    cleanCanvasDataRef.current = null;
    setTotalPages(1);
    setCurrentPage(1);
    setStage(1);
  };

  // Change only the numeric requirement: re-rank targets against it and drop
  // any proof/seal that was bound to the previous threshold.
  const setThresholdValue = (threshold: number, unit?: string) => {
    setEnterpriseSpec((prev) => ({ ...prev, thresholdValue: threshold, currency: unit ?? prev.currency }));
    if (extractedTokens.length > 0) {
      const targets = classifyForScenario(extractedTokens, scenario, { thresholdValue: threshold });
      setDetectedFields(targets);
    }
    invalidateDownstreamState('Requirement changed — the proof and seal were cleared. Re-run from Stage 3.');
  };

  const applyRequirementPreset = (value: string) => {
    if (value === 'custom') {
      setCustomThreshold(true);
      return;
    }
    if (value === 'seal') return;
    const preset = (REQUIREMENT_PRESETS[scenario.id] ?? [])[Number(value)];
    if (!preset) return;
    setCustomThreshold(false);
    setThresholdValue(preset.threshold, preset.unit);
  };

  // "Verify with Zeroara" handshake: the relying party pre-configures the
  // workspace (document type, claim, fresh challenge nonce). Nothing about the
  // user or the document is known to it at this point.
  const startVerifierRequest = () => {
    const nonce = makeNonce();
    const requester = 'Aegis Rentals';
    const purpose = 'Age-gated rental booking — renter must be 18 or older';
    clearDocument();
    applyScenario('aadhaar');
    setEnterpriseSpec((prev) => ({
      ...prev,
      requesterName: requester,
      purpose,
      targetField: 'Date of Birth',
      predicate: '>= (Greater than or equal to)',
      thresholdValue: 18,
      currency: 'years',
      challengeNonce: nonce,
    }));
    setCustomThreshold(false);
    setVerifierRequest({
      id: `AR-${nonce.slice(2, 8).toUpperCase()}`,
      requester,
      purpose,
      claim: 'Age ≥ 18',
      scenarioId: 'aadhaar',
      thresholdValue: 18,
      unit: 'years',
      nonce,
      issuedAt: new Date().toISOString(),
    });
    setVerifierResult(null);
    setInvalidationMessage(null);
    setActiveView('workspace');
    setStage(1);
  };

  // Hand the bundle back: the relying party receives ONLY the flattened
  // redacted PDF and the audit package (receipt) — never the original bytes.
  const returnToVerifier = () => {
    if (!verifierRequest || !auditPackage || !redactionResult) return;
    setVerifierResult({
      pkg: auditPackage,
      pdfBytes: redactionResult.redactedPdfBytes,
      fileName: `${(doc?.fileName ?? 'document').replace(/\.[^.]+$/, '')}_REDACTED.pdf`,
      receivedAt: new Date().toISOString(),
    });
    setActiveView('demo');
  };

  const resetVerifierDemo = () => {
    setVerifierRequest(null);
    setVerifierResult(null);
  };

  const copySeal = () => {
    if (!masterSeal) return;
    navigator.clipboard.writeText(masterSeal.sealHex);
    setCopiedSeal(true);
    setTimeout(() => setCopiedSeal(false), 2000);
  };

  const copyProof = () => {
    if (!proofResult) return;
    navigator.clipboard.writeText(JSON.stringify({ proof: proofResult.proof, publicSignals: proofResult.publicSignals }, null, 2));
    setCopiedProof(true);
    setTimeout(() => setCopiedProof(false), 2000);
  };

  const selectTarget = (field: ClassifiedTarget) => {
    setSelectedFieldId(field.id);
    if (field.page !== currentPage) {
      setCurrentPage(field.page);
      renderCurrentPage(field.page);
    }
  };

  const witnessTarget = detectedFields.find((f) => f.action === 'PROVE_AND_BURN');
  const needsProof = scenarioProofBacked && !!witnessTarget;
  const burnableCount = detectedFields.filter((f) => f.action !== 'DETECT_ONLY').length;
  const requirementText = scenarioProofBacked
    ? `${enterpriseSpec.targetField} ≥ ${enterpriseSpec.thresholdValue.toLocaleString()} ${enterpriseSpec.currency}`.trim()
    : 'Seal-only redaction · no numeric claim';
  const engineLine =
    stage >= 3 && viewMode === 'BURNED'
      ? 'Flattened, non-extractable raster'
      : ocrTelemetry
        ? ocrTelemetry.engineName
        : suryaStatus.ready
          ? 'Surya OCR · local sidecar ready'
          : suryaStatus.online
            ? 'Surya OCR · warming up…'
            : 'Surya offline · Tesseract fallback';
  const presets = REQUIREMENT_PRESETS[scenario.id] ?? [];
  const presetIndex = presets.findIndex((p) => p.threshold === enterpriseSpec.thresholdValue && p.unit === enterpriseSpec.currency);
  const requirementValue = !scenarioProofBacked ? 'seal' : customThreshold || presetIndex < 0 ? 'custom' : String(presetIndex);
  const requirementOptions = scenarioProofBacked
    ? [...presets.map((p, i) => ({ value: String(i), label: p.label })), { value: 'custom', label: 'Custom threshold…' }]
    : [{ value: 'seal', label: 'Seal-only redaction (no numeric claim)' }];
  const redactedFileName = `${(doc?.fileName ?? 'document').replace(/\.[^.]+$/, '')}_REDACTED.pdf`;
  const proofLatency = proofVerifyLatencyMs ?? proofResult?.verificationLatencyMs ?? null;

  const downloadRedactedPdf = () => {
    if (!redactionResult) return;
    downloadFile(redactionResult.redactedPdfBytes, redactedFileName, 'application/pdf');
  };

  // Which checklist rows can be opened. Navigation only — never skips work.
  const reachable = (n: StageNumber): boolean => {
    switch (n) {
      case 1:
        return true;
      case 2:
        return !!doc;
      case 3:
        return !!redactionResult;
      case 4:
        return !!redactionResult && (!!proofResult || !needsProof || stage >= 4);
      case 5:
        return !!masterSeal;
      case 6:
        return !!auditPackage;
      default:
        return false;
    }
  };

  const checklist: { n: StageNumber; title: string; state: 'done' | 'active' | 'pending'; detail: string }[] = [
    {
      n: 1,
      title: 'Ingest',
      state: doc ? 'done' : stage === 1 ? 'active' : 'pending',
      detail: doc ? `${doc.fileName} · ${(doc.fileSizeBytes / 1024).toFixed(0)} KB · SHA-256 anchored` : 'Upload a document or load a specimen',
    },
    {
      n: 2,
      title: 'Detect & classify',
      state: ocrRunning ? 'active' : detectedFields.length > 0 ? 'done' : stage === 2 ? 'active' : 'pending',
      detail: ocrRunning
        ? 'Reading the document locally…'
        : detectedFields.length > 0
          ? `${detectedFields.length} targets · ${burnableCount} to burn`
          : doc
            ? 'No targets detected yet'
            : 'Runs automatically after ingest',
    },
    {
      n: 3,
      title: 'Burn & flatten',
      state: redactionResult ? 'done' : isBurning || stage === 3 ? 'active' : 'pending',
      detail: redactionResult
        ? `${redactionResult.burnedZonesCount} zones burned · ${redactionResult.textStreamCount} text streams purged`
        : 'Solid-black pixel redaction, non-extractable PDF',
    },
    {
      n: 4,
      title: needsProof ? 'Prove in zero knowledge' : 'Prove (seal-only)',
      state: needsProof
        ? proofResult && proofVerified
          ? 'done'
          : isProving || stage === 4
            ? 'active'
            : 'pending'
        : masterSeal || stage >= 4
          ? 'done'
          : 'pending',
      detail: needsProof
        ? proofResult
          ? proofVerified
            ? `Proof validated · ${proofLatency ?? 0} ms`
            : 'Proof did not verify'
          : requirementText
        : 'No numeric claim for this document type',
    },
    {
      n: 5,
      title: 'Seal & bundle',
      state: masterSeal ? 'done' : isSealing || stage === 5 ? 'active' : 'pending',
      detail: masterSeal ? `Seal ${masterSeal.sealHex.slice(0, 14)}… · audit package ready` : 'Binds raster hash, geometry, commitment and proof',
    },
    {
      n: 6,
      title: verifierRequest ? `Hand back to ${verifierRequest.requester}` : 'Verify independently',
      state: verifierResult ? 'done' : stage === 6 ? 'active' : 'pending',
      detail: verifierRequest
        ? verifierResult
          ? 'Bundle delivered · 0 bytes of PII'
          : 'Return the proof-backed bundle to the requester'
        : auditPackage
          ? 'Run the 5-gate verifier portal'
          : 'Available after sealing',
    },
  ];

  type Action = { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean };
  const primaryAction: Action | null = (() => {
    switch (stage) {
      case 1:
        return doc
          ? { label: ocrRunning ? 'Reading document…' : 'Review detected targets', icon: <Crosshair size={16} />, onClick: () => setStage(2), disabled: ocrRunning }
          : null;
      case 2:
        return {
          label: isBurning ? 'Burning pixels…' : 'Burn & flatten',
          icon: <Flame size={16} />,
          onClick: executePixelBurn,
          disabled: isBurning || ocrRunning || burnableCount === 0,
        };
      case 3:
        return needsProof
          ? { label: isProving ? 'Generating proof…' : 'Generate zero-knowledge proof', icon: <Cpu size={16} />, onClick: executeZkProof, disabled: isProving }
          : { label: 'Continue · seal-only', icon: <ArrowRight size={16} />, onClick: executeZkProof };
      case 4:
        return needsProof && !proofResult
          ? { label: isProving ? 'Generating proof…' : 'Generate zero-knowledge proof', icon: <Cpu size={16} />, onClick: executeZkProof, disabled: isProving }
          : {
              label: isSealing ? 'Sealing…' : 'Seal & bundle',
              icon: <Fingerprint size={16} />,
              onClick: executeMasterSeal,
              disabled: isSealing || !redactionResult || (needsProof && !proofVerified),
            };
      case 5:
        return verifierRequest
          ? { label: `Return to ${verifierRequest.requester} with proof`, icon: <ExternalLink size={16} />, onClick: returnToVerifier, disabled: !auditPackage }
          : { label: 'Verify in the auditor portal', icon: <ShieldCheck size={16} />, onClick: () => setStage(6), disabled: !auditPackage };
      default:
        return null;
    }
  })();

  const secondaryActions: Action[] = [];
  if (redactionResult && stage >= 3) secondaryActions.push({ label: 'Download redacted PDF', icon: <Download size={14} />, onClick: downloadRedactedPdf });
  if (masterSeal && stage >= 5)
    secondaryActions.push({ label: copiedSeal ? 'Seal copied' : 'Copy audit seal', icon: copiedSeal ? <Check size={14} /> : <Copy size={14} />, onClick: copySeal });
  if (auditPackage && stage >= 5) secondaryActions.push({ label: 'Download audit package', icon: <FileText size={14} />, onClick: handleDownloadAuditPackage });
  if (auditPackage && stage === 5 && verifierRequest) secondaryActions.push({ label: 'Verify in the auditor portal', icon: <ShieldCheck size={14} />, onClick: () => setStage(6) });
  if (auditPackage && verifierRequest && stage < 5)
    secondaryActions.push({ label: `Return to ${verifierRequest.requester}`, icon: <ExternalLink size={14} />, onClick: returnToVerifier });

  return (
    <div className="app-shell">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
        accept="application/pdf,image/*,.pdf"
        style={{ display: 'none' }}
      />

      <main className="main-viewport" style={{ padding: '20px 32px 40px 32px' }}>
        <div className="view-container" style={{ maxWidth: '1360px', gap: '20px' }}>
          {/* Top bar: brand, egress monitor, view switch, document action */}
          <div className="neu-card" style={{ padding: '14px 24px', borderRadius: '24px', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <img
                src="/logo.png"
                alt="Zeroara Logo"
                style={{ width: '34px', height: '34px', objectFit: 'contain', display: 'block', filter: 'drop-shadow(0 2px 4px rgba(234, 88, 12, 0.3))' }}
              />
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.25rem', letterSpacing: '-0.02em', color: 'var(--fg-primary)' }}>ZEROARA</span>
              <span className="neu-severed-pill">
                <WifiOff size={13} style={{ display: 'inline', marginRight: '4px', verticalAlign: '-1px' }} />
                {suryaStatus.online ? 'EGRESS: 0 KB · OCR ON 127.0.0.1' : 'EGRESS: 0 KB · SEVERED'}
              </span>
            </div>

            <div className="neu-nav-track" role="tablist" aria-label="Views">
              <button
                type="button"
                role="tab"
                aria-selected={activeView === 'workspace'}
                className={`neu-nav-btn ${activeView === 'workspace' ? 'active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                onClick={() => setActiveView('workspace')}
              >
                <LayoutDashboard size={14} />
                <span>Workspace</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeView === 'demo'}
                className={`neu-nav-btn ${activeView === 'demo' ? 'active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                onClick={() => setActiveView('demo')}
              >
                <Globe size={14} />
                <span>Verifier demo</span>
                {verifierRequest && !verifierResult && (
                  <span className="neu-hash-pill" style={{ fontSize: '0.6rem', color: 'var(--accent)' }}>
                    pending
                  </span>
                )}
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {doc ? (
                <button type="button" className="neu-btn-secondary" style={{ fontSize: '0.82rem', padding: '8px 16px', gap: '6px' }} onClick={clearDocument}>
                  <RefreshCw size={13} />
                  <span>Clear document</span>
                </button>
              ) : (
                <button type="button" className="neu-btn-primary" style={{ fontSize: '0.84rem', padding: '9px 18px' }} onClick={handleLoadSample}>
                  {scenario.id === 'aadhaar' ? 'Load specimen Aadhaar' : 'Load sample document'}
                </button>
              )}
            </div>
          </div>

          {/* Third-party verifier demo ("Verify with Zeroara") */}
          {activeView === 'demo' && (
            <VerifierDemoSite
              request={verifierRequest}
              result={verifierResult}
              onStart={startVerifierRequest}
              onOpenZeroara={() => setActiveView('workspace')}
              onReset={resetVerifierDemo}
            />
          )}

          {/* Workspace stays mounted (canvas + rasters survive view switches) */}
          <div style={{ display: activeView === 'workspace' ? 'contents' : 'none' }}>
            {/* Stage header */}
            <div className="neu-card" style={{ padding: '16px 24px', borderRadius: '24px', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                  <div className="neu-check-icon" style={{ width: '42px', height: '42px', color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '0.9rem' }}>
                    {stage}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.05rem', color: 'var(--fg-primary)' }}>{STAGE_CONFIG[stage].title}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--fg-muted)' }}>{STAGE_CONFIG[stage].subtitle}</div>
                  </div>
                </div>
                {verifierRequest && (
                  <span className="neu-claim-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <KeyRound size={12} />
                    Request from {verifierRequest.requester} · {verifierRequest.claim}
                  </span>
                )}
              </div>
              <div className="neu-progress-track">
                <div className="neu-progress-fill" style={{ width: `${(stage / MAX_STAGE) * 100}%` }} />
              </div>
            </div>

            {stage <= 5 && (
              <div className="workspace-grid">
                {/* Left viewport: document canvas, bounding boxes, burn layer */}
                <div className="neu-card" style={{ padding: '22px', gap: '14px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.95rem', color: 'var(--fg-primary)' }}>Document</span>
                    {doc && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        {stage === 2 && (
                          <button
                            type="button"
                            className={`neu-pill-btn ${showHudOverlays ? 'active' : ''}`}
                            style={{ fontSize: '0.72rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}
                            onClick={() => setShowHudOverlays((v) => !v)}
                          >
                            {showHudOverlays ? <Eye size={12} /> : <EyeOff size={12} />}
                            <span>Bounding boxes</span>
                          </button>
                        )}
                        {stage >= 3 && redactionResult && (
                          <>
                            <button
                              type="button"
                              className={`neu-pill-btn ${viewMode === 'BURNED' ? 'active' : ''}`}
                              style={{ fontSize: '0.72rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}
                              onClick={() => setViewMode('BURNED')}
                            >
                              <Flame size={12} style={{ color: 'var(--accent)' }} />
                              <span>Burned</span>
                            </button>
                            <button
                              type="button"
                              className={`neu-pill-btn ${viewMode === 'ORIGINAL' ? 'active' : ''}`}
                              style={{ fontSize: '0.72rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}
                              onClick={() => setViewMode('ORIGINAL')}
                            >
                              <Eye size={12} />
                              <span>Original</span>
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Drag & drop upload zone */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      if (e.dataTransfer.files?.[0]) handleFileUpload(e.dataTransfer.files[0]);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`neu-dropzone ${isDragging ? 'dragging' : ''}`}
                    style={{ display: doc ? 'none' : 'flex' }}
                  >
                    <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-extruded)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                      <UploadCloud size={32} />
                    </div>
                    <div>
                      <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 800 }}>
                        {verifierRequest ? 'Drop the front of your Aadhaar card here' : 'Drop your document here, or click to browse'}
                      </h4>
                      <p style={{ fontSize: '0.84rem', color: 'var(--fg-muted)', marginTop: '6px', maxWidth: '380px' }}>
                        PDF or image (PNG, JPEG, WebP, GIF, BMP, AVIF). Read entirely on this machine — in the browser or on a local sidecar at 127.0.0.1.{' '}
                        <strong>Nothing leaves your device.</strong>
                      </p>
                      {uploadError && (
                        <p role="alert" style={{ fontSize: '0.78rem', color: '#B91C1C', marginTop: '8px', maxWidth: '420px' }}>
                          {uploadError}
                        </p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        type="button"
                        className="neu-btn-primary"
                        style={{ fontSize: '0.84rem', padding: '10px 20px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                      >
                        Browse files
                      </button>
                      <button
                        type="button"
                        className="neu-btn-secondary"
                        style={{ fontSize: '0.84rem', padding: '10px 18px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLoadSample();
                        }}
                      >
                        {scenario.id === 'aadhaar' ? 'Load specimen Aadhaar' : 'Load sample document'}
                      </button>
                    </div>
                  </div>

                  {/* In-memory document canvas */}
                  <div style={{ display: doc ? 'flex' : 'none', flexDirection: 'column', gap: '12px', alignItems: 'center', width: '100%' }}>
                    <div
                      style={{
                        position: 'relative',
                        width: '100%',
                        backgroundColor: 'var(--bg-surface)',
                        boxShadow: 'var(--shadow-inset)',
                        borderRadius: '20px',
                        padding: '16px',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        minHeight: '440px',
                        overflow: 'auto',
                      }}
                    >
                      <canvas
                        ref={canvasRef}
                        style={{
                          maxWidth: '100%',
                          height: 'auto',
                          borderRadius: '12px',
                          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                          display: stage >= 3 && viewMode === 'BURNED' && redactionResult ? 'none' : 'block',
                        }}
                      />
                      {stage >= 3 && viewMode === 'BURNED' && redactionResult && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                          <img
                            src={redactionResult.flattenedPngDataUrl}
                            alt="Burned and flattened document raster"
                            style={{ maxWidth: '100%', height: 'auto', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', display: 'block' }}
                          />
                          {totalPages > 1 && (
                            <span style={{ fontSize: '0.74rem', color: 'var(--fg-muted)', fontWeight: 600 }}>
                              Page 1 of {totalPages} shown · all pages are in the downloadable PDF
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)' }}>
                    <span>{engineLine}</span>
                    {totalPages > 1 && stage < 3 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button type="button" className="neu-pill-btn" onClick={handlePrevPage} disabled={currentPage === 1} style={{ padding: '4px 10px', fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <ArrowLeft size={12} /> Prev
                        </button>
                        <span style={{ fontWeight: 700, color: 'var(--fg-primary)' }}>
                          Page {currentPage} / {totalPages}
                        </span>
                        <button type="button" className="neu-pill-btn" onClick={handleNextPage} disabled={currentPage === totalPages} style={{ padding: '4px 10px', fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          Next <ArrowRight size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right viewport: verification checklist & primary actions */}
                <div className="neu-card" style={{ padding: '22px', gap: '14px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.95rem', color: 'var(--fg-primary)' }}>
                      <ShieldCheck size={18} style={{ color: masterSeal ? 'var(--accent-secondary)' : 'var(--accent)' }} />
                      Verification checklist
                    </span>
                    <span className="neu-claim-badge">{requirementText}</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {checklist.map((item) => (
                      <ChecklistItem
                        key={item.n}
                        index={item.n}
                        title={item.title}
                        detail={item.detail}
                        state={item.state}
                        current={stage === item.n}
                        disabled={!reachable(item.n)}
                        onClick={() => (item.n === 6 && verifierRequest ? returnToVerifier() : setStage(item.n))}
                      />
                    ))}
                  </div>

                  {primaryAction && (
                    <button
                      type="button"
                      className="neu-btn-primary"
                      style={{ padding: '13px 18px', fontSize: '0.9rem', gap: '10px', width: '100%', justifyContent: 'center' }}
                      onClick={primaryAction.onClick}
                      disabled={primaryAction.disabled}
                    >
                      {primaryAction.icon}
                      <span>{primaryAction.label}</span>
                    </button>
                  )}

                  {secondaryActions.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {secondaryActions.map((a) => (
                        <button key={a.label} type="button" className="neu-btn-secondary" style={{ padding: '8px 12px', fontSize: '0.76rem', gap: '6px' }} onClick={a.onClick}>
                          {a.icon}
                          <span>{a.label}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {invalidationMessage && (
                    <div className="neu-well-deep" style={{ padding: '10px 12px', fontSize: '0.74rem', color: 'var(--fg-muted)', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                      <Info size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                      <span>{invalidationMessage}</span>
                    </div>
                  )}
                  {proverError && (
                    <div className="neu-well-deep" style={{ padding: '10px 12px', fontSize: '0.74rem', color: 'var(--accent-rose)', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                      <span>{proverError}</span>
                    </div>
                  )}

                  {/* Stage detail — one focused panel per step, everything else folded away */}
                  <div className="neu-well" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {stage === 1 && (
                      <>
                        {verifierRequest && (
                          <div className="neu-verified-well" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.82rem', color: 'var(--accent-secondary)' }}>
                              Configured by {verifierRequest.requester}
                            </span>
                            <span style={{ fontSize: '0.76rem', color: 'var(--fg-muted)' }}>
                              {verifierRequest.purpose}. Upload your Aadhaar — the claim, document type and challenge nonce are locked to this request.
                            </span>
                          </div>
                        )}
                        <Select
                          label="Document type"
                          value={scenario.id}
                          options={SCENARIOS.map((s) => ({ value: s.id, label: s.label }))}
                          onChange={(id) => {
                            setCustomThreshold(false);
                            applyScenario(id);
                          }}
                          disabled={!!verifierRequest}
                        />
                        <Select label="Verification requirement" value={requirementValue} options={requirementOptions} onChange={applyRequirementPreset} disabled={!!verifierRequest} />
                        {scenarioProofBacked && requirementValue === 'custom' && !verifierRequest && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '8px' }}>
                            <input
                              className="neu-input"
                              type="number"
                              min={0}
                              value={enterpriseSpec.thresholdValue}
                              onChange={(e) => setThresholdValue(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                              aria-label="Threshold value"
                            />
                            <input
                              className="neu-input"
                              value={enterpriseSpec.currency}
                              onChange={(e) => setEnterpriseSpec((prev) => ({ ...prev, currency: e.target.value }))}
                              aria-label="Unit"
                            />
                          </div>
                        )}
                        <Accordion title="Verifier details" summary={enterpriseSpec.requesterName} icon={<Building2 size={14} />}>
                          <label style={LABEL_STYLE}>
                            Requester
                            <input className="neu-input" value={enterpriseSpec.requesterName} disabled={!!verifierRequest} onChange={(e) => setEnterpriseSpec((prev) => ({ ...prev, requesterName: e.target.value }))} />
                          </label>
                          <label style={LABEL_STYLE}>
                            Purpose
                            <input className="neu-input" value={enterpriseSpec.purpose} disabled={!!verifierRequest} onChange={(e) => setEnterpriseSpec((prev) => ({ ...prev, purpose: e.target.value }))} />
                          </label>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={SMALL_LABEL}>Challenge nonce</span>
                              {!verifierRequest && (
                                <button type="button" className="neu-pill-btn" style={{ fontSize: '0.68rem', padding: '3px 9px', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={regenerateNonce}>
                                  <RefreshCw size={11} /> New nonce
                                </button>
                              )}
                            </div>
                            <HashBlock value={enterpriseSpec.challengeNonce} small />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <span style={SMALL_LABEL}>Fields to redact</span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {enterpriseSpec.requiredRedactionFields.map((f) => (
                                <span key={f} className="neu-hash-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  {f}
                                  {!verifierRequest && (
                                    <button
                                      type="button"
                                      aria-label={`Remove ${f}`}
                                      onClick={() => setEnterpriseSpec((prev) => ({ ...prev, requiredRedactionFields: prev.requiredRedactionFields.filter((x) => x !== f) }))}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--fg-muted)' }}
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                        </Accordion>
                        {doc && (
                          <Accordion title="Document fingerprint" summary={`${(doc.fileSizeBytes / 1024).toFixed(1)} KB`} icon={<Fingerprint size={14} />} defaultOpen>
                            <KV label="File" value={doc.fileName} mono={false} />
                            <KV label="Type" value={doc.mimeType} />
                            <KV label="Ingested" value={doc.timestamp} />
                            <HashBlock value={doc.chunkedHash} onCopy={copyHash} copied={copied} small />
                          </Accordion>
                        )}
                      </>
                    )}

                    {stage === 2 && (
                      <>
                        {pdfLocked && (
                          <div className="neu-well-deep" style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.82rem', color: 'var(--fg-primary)' }}>
                              <Lock size={14} /> This PDF is password-protected
                            </span>
                            <span style={{ fontSize: '0.74rem', color: 'var(--fg-muted)' }}>
                              e-Aadhaar PDFs open with the first four letters of your name in CAPITALS followed by your birth year, e.g. RAHU1998. The password never leaves this device.
                            </span>
                            <form
                              style={{ display: 'flex', gap: '8px' }}
                              onSubmit={(e) => {
                                e.preventDefault();
                                setPdfPassword(pdfPasswordDraft);
                              }}
                            >
                              <input className="neu-input" type="password" value={pdfPasswordDraft} onChange={(e) => setPdfPasswordDraft(e.target.value)} placeholder="PDF password" aria-label="PDF password" />
                              <button type="submit" className="neu-btn-primary" style={{ padding: '8px 14px', fontSize: '0.78rem' }}>
                                Unlock
                              </button>
                            </form>
                            {pdfLocked.incorrect && <span style={{ fontSize: '0.74rem', color: 'var(--accent-rose)' }}>That password did not open the file. Try again.</span>}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                          {ocrRunning ? (
                            <StatusBadge tone="active">
                              <Loader2 size={13} className="spin" /> Reading document…
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone={detectedFields.length > 0 ? 'ok' : 'warn'}>
                              {detectedFields.length > 0 ? `${detectedFields.length} targets detected` : 'No targets detected'}
                            </StatusBadge>
                          )}
                          {scenario.id === 'aadhaar' && !ocrRunning && doc && (
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button type="button" className="neu-pill-btn" style={{ fontSize: '0.7rem', padding: '3px 9px' }} onClick={() => addRegionTarget('photo')}>
                                + Photo region
                              </button>
                              <button type="button" className="neu-pill-btn" style={{ fontSize: '0.7rem', padding: '3px 9px' }} onClick={() => addRegionTarget('qr')}>
                                + QR region
                              </button>
                            </div>
                          )}
                        </div>
                        {!ocrRunning && doc && !pdfLocked && detectedFields.length === 0 && (
                          <span style={{ fontSize: '0.76rem', color: 'var(--fg-muted)' }}>
                            Nothing was recognised. Try a sharper, well-lit photo of the front of the card, or open the token index below to mark targets by hand.
                          </span>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '340px', overflowY: 'auto', paddingRight: '2px' }}>
                          {detectedFields.map((field) => {
                            const tone = field.action === 'PROVE_AND_BURN' ? 'active' : field.action === 'DIRECT_BURN' ? 'warn' : 'muted';
                            const Icon = field.action === 'PROVE_AND_BURN' ? Cpu : field.action === 'DIRECT_BURN' ? Flame : Eye;
                            const selected = selectedFieldId === field.id;
                            return (
                              <div
                                key={field.id}
                                role="button"
                                tabIndex={0}
                                className={`neu-check-item ${selected ? 'current' : ''}`}
                                onClick={() => selectTarget(field)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    selectTarget(field);
                                  }
                                }}
                              >
                                <span className={`neu-check-icon neu-tone-${tone}`}>
                                  <Icon size={14} />
                                </span>
                                <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.8rem', color: 'var(--fg-primary)' }}>{field.label}</span>
                                    <span className="neu-hash-pill" style={{ fontSize: '0.62rem' }}>
                                      {ACTION_LABEL[field.action]}
                                    </span>
                                    {totalPages > 1 && (
                                      <span className="neu-hash-pill" style={{ fontSize: '0.62rem' }}>
                                        p.{field.page}
                                      </span>
                                    )}
                                  </span>
                                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {field.extractedValue}
                                    {typeof field.satisfiesThreshold === 'boolean' && (
                                      <span className={field.satisfiesThreshold ? 'neu-tone-ok' : 'neu-tone-warn'}> · {field.satisfiesThreshold ? 'meets requirement' : 'below requirement'}</span>
                                    )}
                                    {typeof field.confidence === 'number' && ` · ${Math.round(field.confidence)}%`}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  aria-label={`Remove ${field.label}`}
                                  className="neu-pill-btn"
                                  style={{ padding: '4px 7px', display: 'flex' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveTarget(field.id);
                                  }}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <Accordion title="OCR details" summary={ocrTelemetry ? `${ocrTelemetry.latencyMs} ms` : undefined} icon={<ScanLine size={14} />}>
                          <KV label="Engine" value={ocrTelemetry?.engineName ?? engineLine} mono={false} />
                          <KV label="Tokens" value={ocrTelemetry?.tokenCount ?? 0} />
                          <KV label="Targets" value={ocrTelemetry?.targetsFound ?? 0} />
                          <KV label="Pages" value={totalPages} />
                          <KV label="Latency" value={ocrTelemetry ? `${ocrTelemetry.latencyMs} ms` : '—'} />
                        </Accordion>
                        <Accordion title="Token index" summary={`${extractedTokens.length} tokens`} icon={<SlidersHorizontal size={14} />}>
                          <span style={{ fontSize: '0.72rem', color: 'var(--fg-muted)' }}>Click any token to mark it as a redaction target.</span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', maxHeight: '200px', overflowY: 'auto' }}>
                            {extractedTokens.map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                className="neu-pill-btn"
                                style={{ fontSize: '0.68rem', padding: '3px 8px' }}
                                onClick={() => handleAddTokenAsTarget(t)}
                                title={`page ${t.page} · ${Math.round(t.confidence ?? 0)}%`}
                              >
                                {t.text}
                              </button>
                            ))}
                          </div>
                        </Accordion>
                      </>
                    )}

                    {stage === 3 &&
                      (redactionResult ? (
                        <>
                          <StatusBadge tone="ok">
                            <CheckCircle2 size={13} /> Burned & flattened
                          </StatusBadge>
                          <KV label="Zones burned" value={redactionResult.burnedZonesCount} />
                          <KV label="Text streams purged" value={redactionResult.textStreamCount} />
                          <KV label="Pages" value={redactionResult.pageCount} />
                          <KV label="Output size" value={`${(redactionResult.fileSizeBytes / 1024).toFixed(1)} KB`} />
                          <KV label="Burn time" value={`${redactionResult.durationMs} ms`} />
                          <Accordion title="Sanitisation details" icon={<Fingerprint size={14} />}>
                            <span style={SMALL_LABEL}>H(Doc_redacted) · SHA-256 of the flattened PDF</span>
                            <HashBlock value={redactionResult.chunkedHash} onCopy={copyRedactedHash} copied={copiedRedacted} small />
                            <KV label="Root bond" value={`${doc?.hashHex.slice(0, 10) ?? '—'}… → ${redactionResult.redactedHashHex.slice(0, 10)}…`} />
                            <span style={{ fontSize: '0.72rem', color: 'var(--fg-muted)' }}>
                              Every page is re-encoded as a raster image: no text layer, fonts or metadata survive, so nothing under a black box can be recovered.
                            </span>
                          </Accordion>
                        </>
                      ) : (
                        <StatusBadge tone="muted">Not burned yet</StatusBadge>
                      ))}

                    {stage === 4 &&
                      (needsProof && witnessTarget ? (
                        <>
                          {proofResult ? (
                            proofVerified ? (
                              <StatusBadge tone="ok">
                                <CheckCircle2 size={13} /> Proof Validated ({proofLatency ?? 0} ms)
                              </StatusBadge>
                            ) : proofVerified === false ? (
                              <StatusBadge tone="warn">
                                <AlertTriangle size={13} /> Proof did not verify
                              </StatusBadge>
                            ) : (
                              <StatusBadge tone="active">
                                <Loader2 size={13} className="spin" /> Verifying…
                              </StatusBadge>
                            )
                          ) : (
                            <StatusBadge tone={isProving ? 'active' : 'muted'}>
                              {isProving ? (
                                <>
                                  <Loader2 size={13} className="spin" /> Generating Groth16 proof…
                                </>
                              ) : (
                                'Proof not generated yet'
                              )}
                            </StatusBadge>
                          )}
                          <KV label="Claim" value={requirementText} />
                          <KV
                            label="Witness (private)"
                            value={
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                {showWitnessSecret ? witnessTarget.extractedValue : '•••••••• never leaves this device'}
                                <button
                                  type="button"
                                  className="neu-pill-btn"
                                  style={{ padding: '2px 6px', display: 'flex' }}
                                  onClick={() => setShowWitnessSecret((v) => !v)}
                                  aria-label={showWitnessSecret ? 'Hide witness' : 'Reveal witness'}
                                >
                                  {showWitnessSecret ? <EyeOff size={11} /> : <Eye size={11} />}
                                </button>
                              </span>
                            }
                          />
                          <KV
                            label="Predicate"
                            value={
                              <span className={witnessTarget.satisfiesThreshold ? 'neu-tone-ok' : 'neu-tone-warn'}>
                                {witnessTarget.satisfiesThreshold ? 'TRUE · meets requirement' : 'FALSE · cannot be proven'}
                              </span>
                            }
                          />
                          <KV label="Bound to" value={`doc ${doc?.hashHex.slice(0, 10) ?? '—'}… · nonce ${enterpriseSpec.challengeNonce.slice(0, 10)}…`} />
                          {proofResult && (
                            <button
                              type="button"
                              className="neu-btn-secondary"
                              style={{ padding: '10px 14px', fontSize: '0.8rem', gap: '8px', justifyContent: 'center' }}
                              onClick={() => setShowProofDetails(true)}
                            >
                              <Binary size={15} />
                              <span>View Cryptographic Proof Details</span>
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <StatusBadge tone="muted">Seal-only</StatusBadge>
                          <span style={{ fontSize: '0.76rem', color: 'var(--fg-muted)' }}>
                            {scenarioProofBacked
                              ? 'No numeric witness was detected on this document, so no predicate proof is generated. The redaction is still bound into the master audit seal.'
                              : `${scenario.label} carries no numeric claim. Redaction is bound into the master audit seal without a zero-knowledge proof.`}
                          </span>
                        </>
                      ))}

                    {stage === 5 &&
                      (masterSeal ? (
                        <>
                          <StatusBadge tone="ok">
                            <Fingerprint size={13} /> Master audit seal anchored
                          </StatusBadge>
                          <HashBlock value={formatChunkedHash(masterSeal.sealHex)} onCopy={copySeal} copied={copiedSeal} />
                          <Accordion title="Seal factors" summary={auditPackage?.redactionMode === 'PROOF_BACKED' ? 'proof-backed' : 'seal-only'} icon={<Binary size={14} />}>
                            <KV label="H(Doc_redacted)" value={`${masterSeal.docRedactedHash.slice(0, 18)}…`} />
                            <KV label="Geometry" value={`${masterSeal.bboxSummary.slice(0, 18)}…`} />
                            <KV label="Commitment C" value={masterSeal.commitment ? `${masterSeal.commitment.slice(0, 18)}…` : 'none (seal-only)'} />
                            <KV label="Proof digest" value={masterSeal.proofDigest ? `${masterSeal.proofDigest.slice(0, 18)}…` : 'none (seal-only)'} />
                          </Accordion>
                          <span style={{ fontSize: '0.74rem', color: 'var(--fg-muted)' }}>
                            {verifierRequest
                              ? `Hand the bundle back to ${verifierRequest.requester}: it receives the redacted PDF and this receipt, never the original.`
                              : 'Download the audit package and verify it independently in the auditor portal.'}
                          </span>
                        </>
                      ) : (
                        <StatusBadge tone="muted">Not sealed yet</StatusBadge>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {/* Stage 6: Standalone Enterprise Verifier Portal */}
            {stage === 6 && <VerifierPortalView initialPackage={auditPackage} onNavigateToStage={(s) => setStage(s as StageNumber)} />}

            {/* Stage 7 / 8: scaffolds reachable via ?view= only */}
            {stage === 7 && <HardwareEnclaveView onNavigateToStage={(s) => setStage(s as StageNumber)} />}
            {stage === 8 && <TransportProtocolView onNavigateToStage={(s) => setStage(s as StageNumber)} />}
          </div>
        </div>
      </main>

      {/* Raw cryptographic telemetry lives here, out of the main flow */}
      <Drawer open={showProofDetails && !!proofResult} title="Cryptographic proof details" onClose={() => setShowProofDetails(false)}>
        {proofResult && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              <StatusBadge tone={proofVerified ? 'ok' : proofVerified === false ? 'warn' : 'muted'}>
                {proofVerified ? (
                  <>
                    <CheckCircle2 size={13} /> Proof Validated ({proofLatency ?? 0} ms)
                  </>
                ) : proofVerified === false ? (
                  'Proof did not verify'
                ) : (
                  'Unverified'
                )}
              </StatusBadge>
              <span className="neu-hash-pill">
                {proofResult.protocol} · {proofResult.curve}
              </span>
              <span className="neu-hash-pill">proved in {proofResult.durationMs} ms</span>
              <span className="neu-hash-pill">{proofResult.generatedAt}</span>
            </div>
            <div>
              <span style={SMALL_LABEL}>Poseidon commitment C = Poseidon(witness, salt)</span>
              <HashBlock value={proofResult.commitment} small />
            </div>
            <div>
              <span style={SMALL_LABEL}>Session binding (document digest ‖ requester ‖ purpose ‖ threshold ‖ nonce)</span>
              <HashBlock value={proofResult.sessionBinding} small />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={SMALL_LABEL}>Blinding salt (secret)</span>
                <button type="button" className="neu-pill-btn" style={{ fontSize: '0.68rem', padding: '3px 9px', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => setShowWitnessSecret((v) => !v)}>
                  {showWitnessSecret ? <EyeOff size={11} /> : <Eye size={11} />} {showWitnessSecret ? 'Hide' : 'Reveal'}
                </button>
              </div>
              <HashBlock value={showWitnessSecret ? proofResult.blindingSalt : '•'.repeat(48)} small />
            </div>
            <div>
              <span style={SMALL_LABEL}>Proof π · Groth16 points (πA, πB, πC)</span>
              <pre className="neu-code-block" style={{ maxHeight: '220px', overflow: 'auto', fontSize: '0.68rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(proofResult.proof, null, 2)}
              </pre>
            </div>
            <div>
              <span style={SMALL_LABEL}>Public signals ({proofResult.publicSignals.length})</span>
              <pre className="neu-code-block" style={{ maxHeight: '120px', overflow: 'auto', fontSize: '0.68rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(proofResult.publicSignals, null, 2)}
              </pre>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <button type="button" className="neu-btn-secondary" style={{ padding: '8px 12px', fontSize: '0.76rem', gap: '6px' }} onClick={copyProof}>
                {copiedProof ? <Check size={13} /> : <Copy size={13} />}
                <span>{copiedProof ? 'Proof copied' : 'Copy proof JSON'}</span>
              </button>
              <button type="button" className="neu-btn-secondary" style={{ padding: '8px 12px', fontSize: '0.76rem', gap: '6px' }} onClick={executeVerifyAgain} disabled={isVerifyingAgain}>
                {isVerifyingAgain ? <Loader2 size={13} className="spin" /> : <ShieldCheck size={13} />}
                <span>Verify again</span>
              </button>
              <button
                type="button"
                className="neu-btn-secondary"
                style={{ padding: '8px 12px', fontSize: '0.76rem', gap: '6px' }}
                onClick={() => {
                  setShowProofDetails(false);
                  executeZkProof();
                }}
                disabled={isProving}
              >
                <RefreshCw size={13} />
                <span>Re-generate proof</span>
              </button>
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
}

export default App;
