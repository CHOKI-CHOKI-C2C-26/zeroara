# End-to-end checks

Playwright scripts that drive real browsers against the running dev servers. They are not part of `npm run build`.

```sh
npm run dev          # Zeroara web app on :1420
npm run verifier     # reference verifier API on :8787
npm i -D playwright@1.49.1 && npx playwright install chromium
node tests/e2e/desktop-flow.mjs    # online verifier <-> app: VERIFIED, FAILED, DECLINED, replay + nonce guards
node tests/e2e/browser-flow.mjs    # popup transport from an external site (NEODRIVE on :5173, or SITE=<url>)
```

`tests/fixtures/aadhaar_specimen.png` is the synthetic SPECIMEN card (DOB 15/08/1998) used as the "real file" in the request flow. Without a desktop app installed, the desktop suite exercises the web fallback; the API path (init → callback → status) is identical.
