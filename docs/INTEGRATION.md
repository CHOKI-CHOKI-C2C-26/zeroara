# Integrating Zeroara into your website

Zeroara lets any website ask a user to **prove a condition about a document without ever seeing the document**. Your site receives two things: a flattened, redacted PDF (black boxes burned into the pixels, no text layer) and a cryptographic receipt (the *audit package*). The original bytes, the private value and the person's identity never leave the user's device.

## 1. Quick start (browser SDK)

```html
<script src="https://zeroara.vercel.app/sdk/zeroara.js"></script>
<button id="verify">Verify with Zeroara</button>
<script>
  document.getElementById('verify').onclick = async () => {
    const result = await Zeroara.verify({
      document: 'aadhaar',                                        // which document the user holds
      claim: { field: 'Age', op: '>=', value: 18, unit: 'years' }, // what must be true
      requester: 'Aegis Rentals',                                 // shown to the user
      purpose: 'Renters must be 18 or older',                     // shown to the user
    });

    if (result.ok) {
      // result.bundle           – the receipt (JSON). Store it.
      // result.redactedPdfBytes – Uint8Array of the redacted PDF. Store it if you need a document on file.
    } else {
      console.warn(result.checks.reasons);
    }
  };
</script>
```

Call `verify` from a click handler so the browser allows the popup. If the popup is blocked, the SDK falls back to an overlay `<iframe>` inside your page (`mode: 'auto'`, the default). Force one or the other with `mode: 'popup'` or `mode: 'iframe'`.

Try it live: `https://zeroara.vercel.app/demo/index.html` (a plain HTML page that uses nothing but `zeroara.js`).

## 2. API

### `Zeroara.verify(options) → Promise<Result>`

| option | type | notes |
| --- | --- | --- |
| `document` | string | Scenario id, see §4. Required. |
| `claim` | `{ field?, op: '>=', value: number, unit? }` | Condition to prove. Only `>=` is supported. Omit for seal-only documents. |
| `requester` | string | Your name, shown to the user and bound into the proof session. |
| `purpose` | string | Why you need it, shown to the user. |
| `mode` | `'auto' \| 'popup' \| 'iframe'` | How Zeroara opens. Default `'auto'`. |
| `container` | HTMLElement | Host element for the overlay in iframe mode. |
| `origin` | string | Zeroara origin. Defaults to where `zeroara.js` was loaded from. |
| `nonce` | string | Challenge nonce. Generated randomly if omitted (recommended). |
| `timeoutMs` | number | Reject if the user takes longer. |

`Result`:

| field | meaning |
| --- | --- |
| `ok` | `true` when the receipt satisfies the request (see `check`). |
| `checks.reasons` | Plain-English reasons when `ok` is false. |
| `bundle` | The audit package: source fingerprint, burned boxes, requirement, optional Groth16 proof, master seal. |
| `redactedPdfBytes` / `redactedPdfBase64` | The flattened redacted PDF. |
| `fileName`, `requestId`, `deliveredAt`, `origin` | Bookkeeping. |

The promise rejects with `err.code` = `CANCELLED` (user cancelled), `CLOSED` (window closed), `POPUP_BLOCKED`, `TIMEOUT` or `BAD_REQUEST`.

### `Zeroara.check(result, request) → { ok, reasons }`

The acceptance policy `verify` applies automatically. It rejects a bundle whose document type differs from the request, whose challenge nonce differs (replay), that has no verified zero-knowledge proof when a claim was requested, or whose proven threshold is below the requested value.

### `Zeroara.audit(bundle) → Promise<Report>`

Re-runs the five cryptographic checks (document fingerprint, box geometry, commitment anchor, Groth16 pairing check, master-seal recomputation) using Zeroara's verifier code in a hidden frame in the user's browser. Use it when you want an independent second opinion before accepting a bundle, or run the same checks server-side with the package's public data.

## 3. The wire protocol (for non-JS integrations)

Everything the SDK does is `window.postMessage` plus one URL parameter, so any stack can integrate.

1. Open `https://zeroara.vercel.app/?request=<base64url(JSON)>` in a popup or iframe. The JSON is:

   ```json
   {
     "version": 1,
     "requestId": "8f2c1a9d3b",
     "requester": "Aegis Rentals",
     "purpose": "Renters must be 18 or older",
     "document": "aadhaar",
     "claim": { "field": "Age", "op": ">=", "value": 18, "unit": "years" },
     "nonce": "0x…random hex…",
     "replyOrigin": "https://your-site.example"
   }
   ```

2. Zeroara posts `{ type: 'zeroara:ready', version: 1 }` to its opener/parent. Reply with `{ type: 'zeroara:request', version: 1, request }` (same JSON). This step authenticates your origin: Zeroara answers **only** the origin that sent this message. Without it, `replyOrigin` from the URL is used.

3. When the user finishes, Zeroara posts to that origin:

   ```json
   { "type": "zeroara:result", "version": 1, "requestId": "…", "bundle": { …audit package… }, "redactedPdfBase64": "…", "fileName": "…_REDACTED.pdf", "deliveredAt": "…" }
   ```

   or `{ type: 'zeroara:cancel', requestId }` if they cancel.

4. Optional independent audit: open `https://zeroara.vercel.app/?audit=1` in a hidden iframe, wait for `zeroara:ready`, post `{ type: 'zeroara:audit', requestId, bundle }`, receive `{ type: 'zeroara:audit-result', requestId, report }`.

## 4. Document types and claims

| `document` | what it is | proof-backed claim |
| --- | --- | --- |
| `aadhaar` | Aadhaar card (photo, e-Aadhaar PDF, masked) | Age in years from the date of birth |
| `income_accredited` | Income / accredited-investor certificate | Trailing income (USD) |
| `salary_slip` | Salary slip | Net pay (INR) |
| `bank_statement` | Bank statement | Balance (INR) |
| `tax_form` | Tax form | Declared income (INR) |
| `generic_financial` | Any financial document | Largest labelled amount |
| `pan`, `college_id`, `generic_id` | Identity documents | none: redaction is sealed only |

A claim is always `field ≥ value`. Zeroara's Groth16 circuit proves `witness ≥ threshold` over a Poseidon commitment, bound to a session digest of your requester name, purpose, threshold and nonce, so a proof made for one request cannot be replayed for another.

## 5. What you can and cannot learn

You receive the redacted PDF and the receipt. From them you can verify the claim, the burned geometry and the seal. You cannot recover the burned text, the exact value or the person's identity: the PDF is a flat raster with no text layer, and the proof reveals only "the condition holds".

## 6. Running it locally

```sh
npm run dev            # Zeroara on http://localhost:1420
open http://localhost:1420/demo/index.html   # the playground uses /sdk/zeroara.js from the same origin
```

For the best OCR on Aadhaar photos start the local Surya sidecar (`sidecar/run.sh`); the app falls back to in-browser Tesseract otherwise.
