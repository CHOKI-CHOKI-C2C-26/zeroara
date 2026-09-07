# Local Tesseract language assets

These files are served only from `/tesseract/` and are never requested from a
CDN. They keep browser OCR fully on-device.

| file | use | source |
| --- | --- | --- |
| `eng.traineddata.gz` | default English OCR | existing project asset |
| `hin.traineddata.gz` | Hindi alongside English for Aadhaar OCR | [official Tesseract `tessdata_fast`](https://github.com/tesseract-ocr/tessdata_fast) |

`hin.traineddata.gz` was fetched from the official `tessdata_fast`
`main/hin.traineddata` model on 2026-09-07 (SHA-256
`4c73ffc59d497c186b19d1e90f5d721d678ea6b2e277b719bee4e2af12271825`), then
gzip-compressed for Tesseract.js.

Only integer LSTM models work here. `eng.traineddata.gz` is the integer
`tessdata` model and `tessdata_fast` models are integer too, but the float
`tessdata_best` models abort inside the Tesseract.js Wasm core
(`missing function: DotProductSSE`), which killed OCR for every Aadhaar run.
The application loads Hindi only for the Aadhaar scenario and falls back to
English if the file is unavailable or unusable.
