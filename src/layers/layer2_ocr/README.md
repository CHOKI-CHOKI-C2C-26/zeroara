# Layer 2: OCR Spatial Extraction & Geometry Detection

## 📋 Module Overview
Layer 2 parses visual and vector document layouts into an unforgeable coordinate map `[x, y, w, h]`. It extracts text tokens, groups them into visual lines, combines fragmented words into unified phrases (SSN, Email, Currency), and classifies targets for downstream redaction and zero-knowledge proof witness evaluation.

---

## 👤 Ownership & Responsibility
- **Assigned Owner**: **Tanay Pathak**
- **Role**: Spatial Vision & Optical Character Recognition Specialist
- **Handoff Note**: Integrated in commit `46b1e4c` with automatic Tesseract LSTM Wasm fallback for scanned PDFs, 2.0x supersampling, and context-aware financial witness selection.

---

## ⚙️ Key Invariants & Rules
1. **Hybrid Execution**: Digital PDFs extract exact vectors via `pdfjs-dist`. Scanned/raster documents fall back to local `tesseract.js` LSTM WASM.
2. **Top-Left Normalized Coordinate Space**: Bounding boxes must use canvas pixel coordinates relative to the top-left origin.
3. **Multi-Token Grouping**: Contiguous tokens (e.g. `USD` + `145,000` or split SSNs) must be merged into a single union bounding box with 4px safety padding.
4. **Zero Cloud Leaks**: Tesseract language data (`eng.traineddata.gz`, plus the Aadhaar-only `hin.traineddata.gz`) and WASM binaries must load strictly from `public/tesseract/`.

---

## 📥 Inputs & 📤 Outputs
- **Input**: Ingested document (`rawBytes` or `File`), target HTML canvas, and enterprise predicate threshold.
- **Output**: `DocumentExtractionResult` containing token stream, classified redaction targets, mean confidence, and render dimensions.

---

## 🤖 Instructions for AI Agents
- Maintain the 2200px dimension ceiling (`OCR_MAX_WIDTH`) to prevent WebAssembly memory heap crashes during supersampling.
- Do not bypass `classifyExtractedTargets()`: witness candidates must have `action: 'PROVE_AND_BURN'` to route to Layer 4.
- Aadhaar uses local `eng+hin` Tesseract recognition and sparse-text page segmentation. If its optional Hindi asset cannot load, it intentionally falls back to the established English path instead of failing the document flow.
