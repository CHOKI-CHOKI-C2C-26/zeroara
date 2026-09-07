/**
 * End-to-end: Online verifier <-> offline Zeroara app (Phase 4 test).
 *
 *   playground (relying party) -> POST /api/verify/init -> zeroara:// deep link
 *   -> (no desktop handler in headless Chromium) -> web fallback overlay
 *   -> request flow: review -> real file -> local pipeline -> consent -> authorize
 *   -> POST callbackUrl -> API verifies proof/seal/nonce -> status VERIFIED
 *   -> playground shows Verified.
 *
 * Prerequisites: `npm run dev` (1420), `npm run verifier` (8787), Playwright.
 *   node tests/e2e/desktop-flow.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ZEROARA = process.env.ZEROARA_WEB || 'http://localhost:1420';
const API = process.env.VERIFIER_API || 'http://localhost:8787';
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/Aadhaar_SPECIMEN_sample.png');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let failures = 0;
const check = (cond, msg) => { log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

async function runFlow({ value, action }) {
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_UNKNOWN_URL_SCHEME|zeroara:\/\//.test(m.text())) log('[console.error]', m.text().slice(0, 140)); });
  await page.goto(`${ZEROARA}/demo/index.html`, { waitUntil: 'networkidle' });
  await page.click('[data-preset="aegis"]');
  await page.selectOption('#mode', 'desktop');
  await page.fill('#api', API);
  await page.fill('#value', String(value));
  await page.click('#verify');

  // The SDK created a session, tried zeroara://, and opened the web fallback.
  const frame = page.frameLocator('[data-zeroara="overlay"] iframe');
  await frame.getByText('External verification request').waitFor({ timeout: 30000 });
  const status = await page.locator('#status').innerText();
  check(/Session req_/.test(status), `playground shows a pending session (${status.split('\n')[1]?.slice(0, 40)}…)`);
  const sessionId = status.match(/req_[0-9a-f]+/)?.[0];
  const claimText = await frame.locator('text=/Age ≥ \\d+ years/').first().innerText();
  check(claimText.includes(`Age ≥ ${value}`), `app shows the requested claim: ${claimText}`);
  check(await frame.getByText('Aegis Rentals · localhost:8787').count() > 0, 'app shows requester and verifier host from the callback URL');

  if (action === 'decline') {
    await frame.getByRole('button', { name: 'Decline', exact: true }).click();
    // DECLINED reaches the API (and zeroara:cancel reaches the SDK); either way the overlay is torn down.
    await page.waitForFunction(() => /DECLINED|CANCELLED/.test(document.getElementById('status').innerText), null, { timeout: 20000 });
    await page.waitForTimeout(500);
    const rec = await (await fetch(`${API}/api/verify/status/${sessionId}`)).json();
    check(rec.status === 'DECLINED', `API recorded DECLINED for ${sessionId}`);
    await page.close();
    return rec;
  }

  await frame.getByRole('button', { name: 'Continue', exact: true }).click();
  await frame.getByText('Provide your aadhaar card').waitFor();
  check((await frame.locator('button:visible', { hasText: 'Load specimen' }).count()) === 0, 'request flow offers no sample generator (real file only)');
  await frame.locator('input[data-request-file="ingest"]').setInputFiles(FIXTURE);
  await frame.getByText('Processing on this device').waitFor({ timeout: 10000 });
  await frame.getByText('Review what leaves this device').waitFor({ timeout: 120000 });
  const consent = await frame.locator('.neu-card:visible').last().innerText();
  const expectVerified = value <= 28; // specimen DOB 15/08/1998
  check(consent.includes(expectVerified ? 'proven' : 'not satisfied'), `consent screen shows the outcome (${expectVerified ? 'proven' : 'not satisfied'})`);
  check(!/15\/08\/1998|0123 4567 8901/.test(consent), 'consent screen shows no raw values');
  if (expectVerified) {
    check(consent.includes('Include the redacted PDF'), 'consent offers the redacted PDF because the request asked for it');
    check(consent.includes('Stays on this device'), 'consent lists what stays on the device');
  }
  await frame.getByRole('button', { name: expectVerified ? /Authorize & send/ : /Send “not satisfied”/ }).click();

  // The app POSTs to callbackUrl; the API verifies; the SDK sees the final
  // status and tears the web fallback down, like it closes a popup.
  await page.waitForFunction(() => /Verified by the verifier API|✖/.test(document.getElementById('status').innerText), null, { timeout: 60000 });
  await page.waitForTimeout(500);
  check((await page.locator('[data-zeroara="overlay"]').count()) === 0, 'SDK closed the web fallback after the result was recorded');
  const finalStatus = await page.locator('#status').innerText();
  const requestId = (await page.locator('#r-id').innerText()).trim();
  const rec = await (await fetch(`${API}/api/verify/status/${requestId}`)).json();
  if (expectVerified) {
    check(finalStatus.includes('Verified by the verifier API'), 'playground shows Verified');
    check(rec.status === 'VERIFIED', `API status VERIFIED for ${requestId}`);
    check(rec.verification?.proofVerified === true && rec.verification?.sealValid === true, `API verified the Groth16 proof (${rec.verification?.proofVerifyMs} ms) and recomputed the seal`);
    check(rec.redactedPdfAvailable === true, 'API stored the redacted PDF the user chose to include');
    const pdf = await fetch(rec.redactedPdfUrl);
    check(pdf.ok && pdf.headers.get('content-type') === 'application/pdf', 'redacted PDF is retrievable by the relying party');
    // Replay protection: a second callback for the same session is refused.
    const replay = await fetch(`${API}/api/verify/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, nonce: rec.nonce ?? 'x', status: 'VERIFIED' }) });
    check(replay.status === 409, `replayed callback refused with 409 (got ${replay.status})`);
  } else {
    check(rec.status === 'FAILED', `API status FAILED for ${requestId}`);
    check(finalStatus.includes('✖'), 'playground shows not verified');
  }
  await page.close();
  return rec;
}

try {
  log('--- 1. Age ≥ 18 with the specimen (age 28): expect VERIFIED');
  await runFlow({ value: 18, action: 'send' });
  log('--- 2. Age ≥ 40 with the same document: expect FAILED, nothing revealed');
  await runFlow({ value: 40, action: 'send' });
  log('--- 3. Decline at the review screen: expect DECLINED');
  await runFlow({ value: 18, action: 'decline' });

  log('--- 4. API guards');
  const init = await (await fetch(`${API}/api/verify/init`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document: 'aadhaar', claim: { op: '>=', value: 18 }, requester: 'Test' }) })).json();
  check(init.ok && init.deepLink.startsWith('zeroara://verify?request=') && init.callbackUrl.endsWith('/api/verify/callback'), 'init returns deep link + callback');
  const wrongNonce = await fetch(`${API}/api/verify/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: init.requestId, nonce: '0xdeadbeef', status: 'VERIFIED' }) });
  check(wrongNonce.status === 400, `wrong nonce refused with 400 (got ${wrongNonce.status})`);
  const bad = await (await fetch(`${API}/api/verify/init`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document: 'college_id', claim: { op: '>=', value: 18 } }) })).json();
  check(bad.ok === false, 'a numeric claim on a seal-only document type is rejected at init');
} catch (err) {
  failures++;
  log('FAILED:', err.message.split('\n')[0]);
} finally {
  await browser.close();
}
log(failures ? `${failures} check(s) failed` : 'ALL CHECKS PASSED');
process.exitCode = failures ? 1 : 0;
