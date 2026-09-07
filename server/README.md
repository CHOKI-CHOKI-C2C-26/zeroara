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

Sessions live for 15 minutes (`SESSION_TTL_MS`) and are kept an hour longer for polling. Nothing confidential is ever received: no original document, no date of birth, no ID number, no OCR text, no blinding salt. The verification key is embedded (`server/lib/verification-key.mjs`, generated from `public/zk/verification_key.json`).

## Deployed on Vercel (same domain as the app)

The same core runs as serverless functions in `api/verify/*` when the zeroara project is deployed on Vercel, so `https://zeroara.vercel.app/api/verify/init` etc. exist without any extra hosting. Serverless functions cannot keep sessions in memory, so a store is required:

1. In the Vercel project: **Storage → Marketplace → Upstash Redis** (free tier is enough). Connect it to the project.
2. Make sure the environment variables `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN`) are present for Production and Preview.
3. Redeploy. `POST https://zeroara.vercel.app/api/verify/init` answers `201`; without the store it answers `503` with a message saying what is missing.

Server-sent events are not available on serverless; `/api/verify/events/:id` answers `501` and the SDK polls `/status` instead. Redacted PDFs up to 700 KB are stored for the relying party (`GET /api/verify/redacted/:id`).

Architecture: `server/lib/verifier-core.mjs` (protocol logic, memory + Upstash stores) · `server/verifier-api.mjs` (standalone Node server with SSE) · `server/lib/vercel.mjs` + `api/verify/*.js` (Vercel functions).
