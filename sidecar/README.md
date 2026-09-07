# Zeroara Surya OCR sidecar (local-only, pure PyTorch)

Stage 2 OCR uses [Surya](https://github.com/VikParuchuri/surya) running **on your machine**
at `127.0.0.1:8765` as plain Python/PyTorch models (no Ollama, no llama.cpp, no model
server). The browser sends the rendered document image to it; nothing leaves the device.
If the sidecar isn't running, Zeroara falls back to in-browser Tesseract.

```bash
python3 -m venv .surya && source .surya/bin/activate
pip install "surya-ocr>=0.14,<0.15"     # the pure-PyTorch Surya v1 line
./sidecar/run.sh                         # first run downloads the det/rec models once
```
Health check: `curl http://127.0.0.1:8765/health` → `"model_loaded": true` once a real warm-up inference has succeeded.

This sidecar deliberately targets Surya v1. Current Surya v2 has a new VLM
inference manager, requires a vLLM or llama.cpp backend, and returns a
different block-oriented schema. It is not an in-place upgrade; the sidecar
will report a clear compatibility error instead of silently degrading OCR if
v2 is installed. The browser fallback remains fully local and now uses
English + Hindi Tesseract recognition for the Aadhaar scenario.
