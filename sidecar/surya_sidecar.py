#!/usr/bin/env python3
"""
Zeroara — local Surya OCR sidecar.

Runs Surya (PyTorch) on 127.0.0.1 ONLY. The browser POSTs a rendered document
image and receives text lines with bounding boxes. Nothing is written to disk,
nothing is logged about document contents, and the server never talks to the
network except for the one-time Hugging Face model download on first run.

Usage:  python sidecar/surya_sidecar.py            # binds 127.0.0.1:8765
        python sidecar/surya_sidecar.py --port 9000
Endpoints:
  GET  /health -> {"ok": true, "model_loaded": bool, "engine": "surya-ocr <ver>"}
  POST /ocr    -> body: raw image bytes (image/png|jpeg|webp)
               -> {"width","height","lines":[{"text","bbox":[x0,y0,x1,y1],"confidence"}]}
"""
import argparse, io, json, re, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from PIL import Image

HOST = "127.0.0.1"
ALLOWED_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")
MAX_BODY = 40 * 1024 * 1024  # 40 MB

_predictor = None
_predictor_lock = threading.Lock()
_engine_version = "unknown"
_ready = False
_ready_error = None


def get_predictor():
    """Pure-PyTorch Surya (0.14 line): text detection + recognition models run
    in-process. Loaded once; weights are cached locally after the first run."""
    global _predictor, _engine_version
    with _predictor_lock:
        if _predictor is None:
            try:
                from importlib.metadata import version
                _engine_version = version("surya-ocr")
            except Exception:
                pass
            # Surya v2 uses a VLM inference manager plus vLLM/llama.cpp and a
            # different response schema. Silently attempting the v1 calls
            # produces confusing 500s, so keep this local-only sidecar pinned
            # to its documented pure-PyTorch v1 contract.
            try:
                if int(_engine_version.split(".", 1)[0]) >= 2:
                    raise RuntimeError(
                        "Surya v2 is incompatible with this local v1 sidecar; "
                        "install surya-ocr>=0.14,<0.15 or deploy a dedicated v2 adapter"
                    )
            except ValueError:
                pass
            from surya.detection import DetectionPredictor
            from surya.recognition import RecognitionPredictor
            _predictor = (DetectionPredictor(), RecognitionPredictor())
        return _predictor


def poly_to_bbox(poly):
    xs = [float(p[0]) for p in poly]
    ys = [float(p[1]) for p in poly]
    return [min(xs), min(ys), max(xs), max(ys)]


def _box_of(obj):
    bbox = getattr(obj, "bbox", None)
    if not bbox:
        poly = getattr(obj, "polygon", None)
        bbox = poly_to_bbox(poly) if poly else None
    return [float(v) for v in bbox] if bbox else None


def run_ocr(img: Image.Image) -> dict:
    det, rec = get_predictor()
    # Word-level boxes when the installed version supports them (return_words);
    # otherwise line-level boxes (the client splits lines proportionally).
    try:
        page = rec([img], det_predictor=det, return_words=True)[0]
    except TypeError:
        page = rec([img], det_predictor=det)[0]
    lines = []
    for tl in getattr(page, "text_lines", []) or []:
        text = (getattr(tl, "text", "") or "").strip()
        bbox = _box_of(tl)
        if not text or not bbox:
            continue
        conf = getattr(tl, "confidence", None)
        entry = {
            "text": text,
            "bbox": bbox,
            "confidence": (float(conf) if conf is not None else None),
        }
        words = []
        for w in (getattr(tl, "words", None) or []):
            wt = (getattr(w, "text", "") or "").strip()
            wb = _box_of(w)
            if wt and wb:
                wc = getattr(w, "confidence", None)
                words.append({"text": wt, "bbox": wb, "confidence": (float(wc) if wc is not None else None)})
        if words:
            entry["words"] = words
        lines.append(entry)
    # Deterministic reading order: top-to-bottom, then left-to-right.
    lines.sort(key=lambda l: (round(l["bbox"][1] / 12.0), l["bbox"][0]))
    return {"width": img.width, "height": img.height, "lines": lines}


class Handler(BaseHTTPRequestHandler):
    server_version = "ZeroaraSuryaSidecar/1.0"

    # Privacy: never log request bodies or OCR text.
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin and ALLOWED_ORIGIN.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")

    def _json(self, code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/health"):
            self._json(200, {
                "ok": True,
                "model_loaded": _ready,
                "engine": f"surya-ocr {_engine_version}",
                "error": _ready_error,
            })
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/ocr"):
            self._json(404, {"ok": False, "error": "not found"})
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            n = 0
        if n <= 0 or n > MAX_BODY:
            self._json(413 if n > MAX_BODY else 400, {"ok": False, "error": "bad body size"})
            return
        raw = self.rfile.read(n)
        try:
            img = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception:
            self._json(400, {"ok": False, "error": "undecodable image"})
            return
        t0 = time.time()
        try:
            out = run_ocr(img)
        except Exception as e:  # surface, but never include document text
            self._json(500, {"ok": False, "error": f"ocr failed: {type(e).__name__}"})
            return
        global _ready, _ready_error
        _ready, _ready_error = True, None
        out["ok"] = True
        out["latency_ms"] = int((time.time() - t0) * 1000)
        self._json(200, out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-warm", action="store_true", help="skip loading the model at startup")
    args = ap.parse_args()

    if not args.no_warm:
        def warm():
            global _ready, _ready_error
            t = time.time()
            try:
                # A real (tiny) inference proves the whole chain (detection +
                # recognition weights loaded). Only then do we report ready.
                from PIL import ImageDraw
                probe = Image.new("RGB", (320, 80), "white")
                ImageDraw.Draw(probe).text((10, 25), "READY 1234", fill="black")
                run_ocr(probe)
                _ready, _ready_error = True, None
                sys.stderr.write(f"[sidecar] model ready in {time.time()-t:.1f}s\n")
            except Exception as e:
                _ready, _ready_error = False, f"{type(e).__name__}: {e}"
                sys.stderr.write(f"[sidecar] model load failed: {e}\n")
        threading.Thread(target=warm, daemon=True).start()

    srv = ThreadingHTTPServer((HOST, args.port), Handler)
    sys.stderr.write(f"[sidecar] Zeroara Surya OCR sidecar listening on http://{HOST}:{args.port}  (local only)\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
