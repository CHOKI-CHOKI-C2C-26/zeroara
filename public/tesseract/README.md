# Local Tesseract language assets

These files are served only from `/tesseract/` and are never requested from a
CDN. They keep browser OCR fully on-device.

| file | use | source |
| --- | --- | --- |
| `eng.traineddata.gz` | default English OCR | existing project asset |
| `hin.traineddata.gz` | Hindi alongside English for Aadhaar OCR | [official Tesseract `tessdata_best`](https://github.com/tesseract-ocr/tessdata_best) |

`hin.traineddata.gz` was fetched from the official `main/hin.traineddata`
model on 2026-09-07, then gzip-compressed for Tesseract.js. Its SHA-256 is:

```
fe08f63ff567be7c0df8200beb8006b49d9b5a20961aa261470e2106be5c0e40
```

The `tessdata_best` models are the accuracy-oriented official LSTM models;
they trade more memory and latency for recognition quality. The application
loads Hindi only for the Aadhaar scenario and falls back to English if the
optional file is unavailable.
