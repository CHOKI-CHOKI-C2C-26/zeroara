/**
 * Every Stage-1 document type: load its specimen, check the detected fields
 * and the witness, then burn -> prove (proof-backed) -> seal.
 *   node tests/e2e/specimens.mjs            (Zeroara dev server on :1420)
 *   ONLY=pan,college_id node tests/e2e/specimens.mjs
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARTIFACTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.artifacts');

const ZEROARA = process.env.ZEROARA_WEB || 'http://localhost:1420';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let failures = 0;
const check = (c, m) => { log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };

const EXPECT = {
  aadhaar: { label: 'Aadhaar Card', fields: ['Aadhaar Number', 'Date of Birth', 'Full Name', 'Gender', 'Photo (face)'], witness: 'Date of Birth', proof: true },
  pan: { label: 'PAN Card', fields: ['PAN', 'Full Name', "Father's Name", 'Date / Year of Birth'], proof: false },
  college_id: { label: 'College / Student ID', fields: ['Student Name', 'Roll Number', 'Registration Number', 'Department / Branch', 'Batch / Year', 'Date / Year of Birth'], proof: false },
  bank_statement: { label: 'Bank Statement', fields: ['Account Number', 'IFSC Code', 'Customer ID', 'Full Name', 'Closing Balance'], witness: 'Closing Balance', value: '2,84,300', proof: true },
  salary_slip: { label: 'Salary Slip', fields: ['PAN / Tax ID', 'UAN', 'Bank Account Number', 'Employee ID', 'Full Name', 'Employer', 'Net Pay'], witness: 'Net Pay', value: '62,450', proof: true },
  tax_form: { label: 'Tax Form', fields: ['PAN', 'Employer TAN', 'Full Name', 'Address', 'Total Income'], witness: 'Total Income', value: '7,20,000', proof: true },
  income_accredited: { label: 'Accredited Investor / Income', fields: ['Social Security Number', '2-Year Trailing Income'], witness: '2-Year Trailing Income', value: '145,000', proof: true },
  generic_id: { label: 'Generic Identity Document', fields: ['Document / ID Number', 'Full Name', 'Date / Year of Birth', 'Address', 'Phone Number', 'Email Address'], proof: false },
  generic_financial: { label: 'Generic Financial Document', fields: ['Account Number', 'Routing / IFSC', 'Email Address', 'Total Amount'], witness: 'Total Amount', value: '75,000', proof: true },
};
const only = process.env.ONLY ? process.env.ONLY.split(',') : Object.keys(EXPECT);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|127\.0\.0\.1:8765/.test(m.text())) log('[console.error]', m.text().slice(0, 140)); });
await page.goto(`${ZEROARA}/app`, { waitUntil: 'networkidle' });
const engine = await page.locator('.main-viewport').innerText().then((t) => (/Surya/.test(t) && !/offline/.test(t) ? 'surya' : 'tesseract')).catch(() => '?');
log('engine line:', engine);

for (const id of only) {
  const exp = EXPECT[id];
  log(`--- ${id} (${exp.label})`);
  try {
    if (await page.getByRole('button', { name: 'Clear document', exact: true }).count()) {
      await page.getByRole('button', { name: 'Clear document', exact: true }).click();
      await page.waitForTimeout(300);
    }
    await page.getByLabel('Document type').selectOption(id);
    await page.getByRole('button', { name: `Load specimen: ${exp.label}`, exact: true }).first().click();
    await page.locator('[data-tour="step-2"]').filter({ hasText: /\d+ targets/ }).waitFor({ timeout: 120000 });
    await page.getByRole('button', { name: 'Review detected targets', exact: true }).click();
    await page.locator('[data-tour="targets"] .neu-check-item').first().waitFor({ timeout: 10000 });
    const items = await page.locator('[data-tour="targets"] .neu-check-item').allInnerTexts();
    const flat = items.map((t) => t.replace(/\s+/g, ' ')).join(' | ');
    log('targets:', items.map((t) => t.split('\n').slice(0, 2).map((x) => x.trim()).join(' = ').slice(0, 70)).join(' · '));
    for (const f of exp.fields) check(items.some((t) => t.split('\n')[0].trim().startsWith(f)), `${id}: detects "${f}"`);
    if (exp.witness) {
      const w = items.find((t) => t.split('\n')[0].trim().startsWith(exp.witness));
      check(!!w && /meets requirement/.test(w), `${id}: witness "${exp.witness}" meets the default requirement`);
      if (exp.value) check(!!w && w.includes(exp.value), `${id}: witness value contains ${exp.value}`);
    }
    check(!/SPECIMEN|specimen/.test(flat.replace(/SPECIMEN PERSON|Specimen Person|Specimen Student|SPECIMEN TECHNOLOGIES|Specimen Technologies|RAMESH SPECIMEN|specimen\.person/g, '')), `${id}: watermark text not mistaken for a field`);

    await page.getByRole('button', { name: 'Burn & flatten', exact: true }).click();
    await page.locator('[data-tour="step-3"]').filter({ hasText: /zones/ }).waitFor({ timeout: 60000 });
    if (exp.proof) {
      await page.getByRole('button', { name: 'Generate zero-knowledge proof', exact: true }).click();
      await page.locator('.neu-claim-badge').filter({ hasText: /Proof Validated/ }).first().waitFor({ timeout: 120000 });
      check(true, `${id}: Groth16 proof validated`);
    } else {
      await page.getByRole('button', { name: 'Continue · seal-only', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Seal & bundle', exact: true }).click();
    await page.locator('.neu-claim-badge').filter({ hasText: /Master audit seal anchored/ }).first().waitFor({ timeout: 30000 });
    check(true, `${id}: sealed (${exp.proof ? 'proof-backed' : 'seal-only'})`);
  } catch (err) {
    failures++;
    log(`FAIL ${id}: ${err.message.split('\n')[0]}`);
    await mkdir(ARTIFACTS, { recursive: true }).catch(() => {});
    await page.screenshot({ path: `${ARTIFACTS}/specimen-${id}-failure.png` }).catch(() => {});
  }
}
await browser.close();
log(failures ? `${failures} check(s) failed` : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
