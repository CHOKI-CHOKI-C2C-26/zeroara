/**
 * Real-world student ID with no field labels on the front (photo, name,
 * registration code only). Checks (a) document-type auto-detection switches
 * from the default income scenario, (b) every field is found under College ID.
 *   node tests/e2e/unlabelled-card.mjs      (Zeroara dev server on :1420)
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/unlabelled_student_id.pdf');
const ZEROARA = process.env.ZEROARA_WEB || 'http://localhost:1420';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let failures = 0;
const check = (c, m) => { log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error' && !/127\.0\.0\.1:8765/.test(m.text())) log('[console.error]', m.text().slice(0, 140)); });

const upload = async (scenarioId) => {
  await page.goto(`${ZEROARA}/app`, { waitUntil: 'networkidle' });
  await page.getByLabel('Document type').selectOption(scenarioId);
  await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);
  await page.locator('[data-tour="step-2"]').filter({ hasText: /\d+ targets/ }).waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: 'Review detected targets', exact: true }).click();
  await page.locator('[data-tour="targets"] .neu-check-item').first().waitFor({ timeout: 10000 });
  const items = await page.locator('[data-tour="targets"] .neu-check-item').allInnerTexts();
  const targets = await page.evaluate(() => window.__zeroaraDev?.lastTargets ?? []);
  const tokens = await page.evaluate(() => window.__zeroaraDev?.lastTokens ?? []);
  return { items, targets, tokens, text: await page.locator('.main-viewport').innerText() };
};

const expectFields = (items, targets, tokens) => {
  const has = (label, value) => items.some((t) => t.split('\n')[0].trim().startsWith(label) && (!value || t.includes(value)));
  check(has('Student Name', 'Aarav Specimen'), 'name found without a label ("Aarav Specimen")');
  check(has('Registration / Roll Number', '25BYB0259'), 'registration code found without a label ("25BYB0259")');
  check(has('Photo (face)'), 'photo inferred on a centred layout');
  check(has('Date / Year of Birth', '12/03/2006'), 'date of birth from the back page');
  check(has('Blood Group', 'B+'), 'blood group from the back page');
  check(has('Phone Number', '9876500000'), 'emergency contact phone from the back page');
  check(has('Parent / Guardian', 'Rohan Specimen'), 'parent name from the back page');
  check(has('Address'), 'address from the back page');
  const flat = items.join(' | ');
  check(!/Vellore Institute|VELLORE CAMPUS|HOSTELLER|Deemed/.test(flat.replace(/Vellore 632014/g, '')), 'institution text not mistaken for a field');
  check(!items.some((t) => /^Extracted Field/.test(t.trim())), 'no generic fallback fields');
  const photo = targets.find((t) => t.fieldKey === 'photo');
  check(!!photo, 'photo target present');
  if (photo) {
    // Frame = horizontal extent of the front-page text (the UGC line spans the card).
    const front = tokens.filter((t) => t.page === 1);
    const minX = Math.min(...front.map((t) => t.x)), maxX = Math.max(...front.map((t) => t.x + t.width));
    const frameW = maxX - minX, cx = (photo.x + photo.width / 2 - minX) / frameW, rw = photo.width / frameW;
    log(`photo box: x=${photo.x} y=${photo.y} w=${photo.width} h=${photo.height} (page ${photo.page}); centre ${cx.toFixed(2)} width ${rw.toFixed(2)} of text frame`);
    check(photo.page === 1 && Math.abs(cx - 0.5) < 0.1 && rw > 0.3 && rw < 0.8, 'photo box is centred on the card front');
  }
};

log('--- default scenario (income) — expect automatic switch to College ID');
{
  const { items, targets, tokens, text } = await upload('income_accredited');
  check(/Switched to College \/ Student ID/.test(text), 'Stage 2 reports the automatic switch');
  check(/College \/ Student ID/.test(text), 'scenario badge now shows College / Student ID');
  log('targets:', items.map((t) => t.split('\n').slice(0, 2).map((x) => x.trim()).join(' = ').slice(0, 60)).join(' · '));
  expectFields(items, targets, tokens);
}
log('--- College ID selected explicitly');
{
  const { items, targets, tokens, text } = await upload('college_id');
  check(!/Switched to|This looks like/.test(text), 'no suggestion when the selection already fits');
  expectFields(items, targets, tokens);
}
await browser.close();
log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
