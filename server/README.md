# Zeroara reference Verifier API

The **online** half of the Online Verifier ↔ Offline Zeroara App workflow. A relying party runs this (or ports it to its own stack) to issue verification sessions and to check the results the offline app sends back.

```sh
node server/verifier-api.mjs
# PORT=8787  PUBLIC_URL=http://localhost:8787  ZEROARA_WEB=http://localhost:1420
```

| Endpoint | Purpose |
| --- | --- |
| `POST /api/verify/init` | Body `{ document, claim?, requester, purpose, wantRedactedPdf? }`. Creates a session and returns `requestId`, `nonce`, `expiresAt`, `callbackUrl`, the full wire `request`, the `deepLink` (`zeroara://verify?request=…`), a `webFallbackUrl`, `statusUrl` and `eventsUrl`. |
| `POST /api/verify/callback` | Receives the offline app's result payload (see `docs/INTEGRATION.md` §7). Verifies nonce, document type, Groth16 proof and its public signals (threshold ≥ claim, commitment), master-seal recomputation, redacted-document hash and, if attached, the PDF. Records `VERIFIED`, `FAILED` or `DECLINED`. Results are accepted once per session. |
| `GET /api/verify/status/:id` | Poll the session: `status`, `verification` summary, `reasons`, `redactedPdfUrl`. |
| `GET /api/verify/events/:id` | Server-sent events with the same view on every change. |
| `GET /api/verify/redacted/:id` | The redacted PDF when the user chose to include it. |

Sessions live in memory for 15 minutes (`SESSION_TTL_MS`). Nothing confidential is ever received: no original document, no date of birth, no ID number, no OCR text. The verification key is read from `public/zk/verification_key.json` (`VKEY_PATH`).
