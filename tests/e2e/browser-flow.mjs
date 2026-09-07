/**
 * End-to-end: browser transport (popup) from an external site through the
 * request flow. Uses the NEODRIVE demo site on :5173 if present, else the
 * Zeroara playground on :1420 in popup mode.
 *   node tests/e2e/browser-flow.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SITE = process.env.SITE || 'http://localhost:5173/';
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/Aadhaar_SPECIMEN_sample.png');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let failures = 0;
const check = (c, m) => { log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
try {
  await page.goto(SITE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'VERIFY AGE 18+ WITH ZEROARA', exact: true }).click();
  const popupPromise = context.waitForEvent('page', { timeout: 20000 });
  await page.getByRole('button', { name: 'VERIFY WITH ZEROARA', exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  await popup.getByText('External verification request').waitFor({ timeout: 20000 });
  check(await popup.getByText('NEODRIVE · localhost:5173').count() > 0, 'popup shows requester and authenticated origin');
  await popup.getByRole('button', { name: 'Continue', exact: true }).click();
  await popup.locator('input[data-request-file="ingest"]').setInputFiles(FIXTURE);
  await popup.getByText('Review what leaves this device').waitFor({ timeout: 120000 });
  await popup.getByRole('button', { name: /Authorize & send/ }).click();
  await page.getByText('STATUS: AGE 18+ PROVEN (PASS)').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  check(popup.isClosed(), 'SDK closed the popup after delivery');
  const modal = await page.locator('.fixed.inset-0').first().innerText();
  check(modal.includes('Groth16 · verified') && modal.includes('matched'), 'site received a verified proof with a matched nonce');
  await page.getByRole('button', { name: /Run independent audit/ }).click();
  await page.getByText(/GENUINE|REJECTED/).first().waitFor({ timeout: 90000 });
  check((await page.locator('text=/^PASS$/').count()) === 5, 'independent audit: 5/5 gates');
} catch (err) {
  failures++;
  log('FAILED:', err.message.split('\n')[0]);
} finally {
  await browser.close();
}
log(failures ? `${failures} check(s) failed` : 'ALL CHECKS PASSED');
process.exitCode = failures ? 1 : 0;
