import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { generateSamplePdfBytes, generateSampleAadhaarPng } from './ingestEngine';

/**
 * Synthetic SPECIMEN documents — one per scenario in the Stage 1 dropdown.
 * Deterministic, obviously fake data (identifiers that cannot be real, a
 * SPECIMEN mark on every document). Cards are rasters so the real OCR path is
 * exercised; statements, slips and forms are text-layer PDFs.
 */

export interface SpecimenFile {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}

/* ------------------------------------------------------------------ cards */

function newCard(W = 1000, H = 630) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  return { c, ctx };
}

async function toPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

function band(ctx: CanvasRenderingContext2D, W: number, color: string, left: string, right: string) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, 92);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 28px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(left, 40, 58);
  ctx.textAlign = 'right';
  ctx.fillText(right, W - 40, 58);
  ctx.textAlign = 'left';
}

function photoBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#9ca3af';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#9ca3af';
  ctx.beginPath();
  ctx.arc(x + w / 2, y + h * 0.36, w * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h * 0.92, w * 0.42, h * 0.3, 0, Math.PI, 0);
  ctx.fill();
}

function barcode(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  ctx.fillStyle = '#111827';
  let cx = x;
  while (cx < x + w) {
    const bw = 2 + Math.floor(rnd() * 5);
    if (rnd() > 0.45) ctx.fillRect(cx, y, bw, h);
    cx += bw + 2;
  }
}

function watermark(ctx: CanvasRenderingContext2D, W: number, H: number, text = 'SPECIMEN · NOT A REAL ID') {
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 9);
  ctx.fillStyle = '#EA580C';
  ctx.font = '800 84px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 0, 30);
  ctx.restore();
}

const small = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number) => {
  ctx.fillStyle = '#6b7280';
  ctx.font = '600 22px Arial, sans-serif';
  ctx.fillText(text, x, y);
};
const big = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 32) => {
  ctx.fillStyle = '#111827';
  ctx.font = `700 ${size}px Arial, sans-serif`;
  ctx.fillText(text, x, y);
};
const row = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 30) => {
  ctx.fillStyle = '#111827';
  ctx.font = `500 ${size}px Arial, sans-serif`;
  ctx.fillText(text, x, y);
};

/** PAN card layout: labels above values, PAN in large monospace. */
export async function generatePanCardPng(): Promise<Uint8Array> {
  const { c, ctx } = newCard();
  band(ctx, 1000, '#1e3a8a', 'INCOME TAX DEPARTMENT', 'GOVT. OF INDIA');
  ctx.fillStyle = '#111827';
  ctx.font = '600 28px Arial, sans-serif';
  ctx.fillText('Permanent Account Number Card', 300, 150);
  ctx.font = '800 58px "Courier New", monospace';
  ctx.fillText('ABCPS1234Z', 300, 222);
  small(ctx, 'Name', 300, 272);
  big(ctx, 'SPECIMEN PERSON', 300, 312);
  small(ctx, "Father's Name", 300, 362);
  big(ctx, 'RAMESH SPECIMEN', 300, 402);
  small(ctx, 'Date of Birth', 300, 452);
  big(ctx, '15/08/1998', 300, 492);
  photoBox(ctx, 60, 300, 180, 220);
  ctx.strokeStyle = '#9ca3af';
  ctx.lineWidth = 2;
  ctx.strokeRect(740, 470, 200, 70);
  small(ctx, 'Signature', 770, 575);
  watermark(ctx, 1000, 630);
  return toPng(c);
}

/** Student ID card: label/value pairs on single lines. */
export async function generateCollegeIdPng(): Promise<Uint8Array> {
  const { c, ctx } = newCard();
  band(ctx, 1000, '#0f766e', 'SPECIMEN INSTITUTE OF TECHNOLOGY', 'STUDENT ID');
  photoBox(ctx, 60, 140, 200, 250);
  const lines = [
    'Name: Specimen Student',
    'Roll No: 21CS1042',
    'Reg. No: SIT/2021/CSE/0421',
    'Department: Computer Science',
    'Batch: 2021 - 2025',
    'DOB: 15/08/2003',
    'Valid Till: 31/07/2025',
  ];
  lines.forEach((t, i) => row(ctx, t, 300, 175 + i * 50));
  barcode(ctx, 60, 440, 200, 60);
  small(ctx, 'Student Identity Card', 60, 540);
  watermark(ctx, 1000, 630);
  return toPng(c);
}

/** A generic national identity card with the usual PII fields. */
export async function generateGenericIdPng(): Promise<Uint8Array> {
  const { c, ctx } = newCard();
  band(ctx, 1000, '#374151', 'NATIONAL IDENTITY CARD', 'SPECIMEN');
  photoBox(ctx, 60, 140, 200, 250);
  const lines = [
    'ID Number: NIC-2048-7719',
    'Name: Specimen Person',
    'Date of Birth: 15/08/1998',
    'Address: 12 Sample Street, Model Town 400001',
    'Phone: 9876500000',
    'Email: specimen.person@example.com',
  ];
  lines.forEach((t, i) => row(ctx, t, 300, 175 + i * 52, 28));
  barcode(ctx, 60, 440, 200, 60);
  small(ctx, 'Issued 01/01/2020', 60, 540);
  watermark(ctx, 1000, 630);
  return toPng(c);
}

/* ------------------------------------------------------------------- PDFs */

const DARK = rgb(0.08, 0.1, 0.12);
const GRAY = rgb(0.4, 0.45, 0.5);
const RULE = rgb(0.8, 0.85, 0.9);

interface Pdf {
  doc: PDFDocument;
  page: PDFPage;
  f: PDFFont;
  fb: PDFFont;
  fm: PDFFont;
}

async function newPdf(title: string, subtitle: string, org: string): Promise<Pdf> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 780]);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const fm = await doc.embedFont(StandardFonts.Courier);
  page.drawRectangle({ x: 40, y: 690, width: 520, height: 60, color: rgb(0.95, 0.96, 0.98) });
  page.drawText(org, { x: 55, y: 728, size: 11, font: fb, color: rgb(0.12, 0.15, 0.2) });
  page.drawText(title, { x: 55, y: 708, size: 9, font: f, color: rgb(0.35, 0.4, 0.48) });
  page.drawText(subtitle, { x: 55, y: 670, size: 8, font: fm, color: GRAY });
  page.drawText('SPECIMEN DOCUMENT - synthetic data generated for Zeroara demonstrations. Not a real record.', { x: 55, y: 40, size: 7.5, font: f, color: GRAY });
  return { doc, page, f, fb, fm };
}

function section(p: Pdf, y: number, text: string) {
  p.page.drawText(text, { x: 55, y, size: 9.5, font: p.fb, color: rgb(0.15, 0.2, 0.28) });
  p.page.drawLine({ start: { x: 55, y: y - 8 }, end: { x: 545, y: y - 8 }, thickness: 0.75, color: RULE });
}

function kv(p: Pdf, y: number, label: string, value: string, opts: { bold?: boolean; mono?: boolean; valueX?: number } = {}) {
  p.page.drawText(label, { x: 55, y, size: 8.5, font: p.f, color: GRAY });
  p.page.drawText(value, { x: opts.valueX ?? 215, y, size: opts.bold ? 10 : 9, font: opts.bold ? p.fb : opts.mono ? p.fm : p.f, color: DARK });
}

function cells(p: Pdf, y: number, xs: number[], values: string[], font?: PDFFont) {
  values.forEach((v, i) => {
    if (v) p.page.drawText(v, { x: xs[i], y, size: 8.5, font: font ?? p.f, color: DARK });
  });
}

export async function generateBankStatementPdf(): Promise<Uint8Array> {
  const p = await newPdf('ACCOUNT STATEMENT - SAVINGS ACCOUNT', 'STATEMENT REF: SB-2026-08-000421', 'SPECIMEN BANK LIMITED');
  section(p, 630, 'ACCOUNT DETAILS');
  kv(p, 605, 'Account Holder Name:', 'SPECIMEN PERSON', { bold: true });
  kv(p, 585, 'Account Number:', '000012345678', { mono: true });
  kv(p, 565, 'IFSC Code:', 'SPEC0000001', { mono: true });
  kv(p, 545, 'Customer ID:', '00098765', { mono: true });
  kv(p, 525, 'Statement Period:', '01/08/2026 - 31/08/2026');
  section(p, 490, 'TRANSACTIONS');
  const xs = [55, 130, 330, 415, 490];
  cells(p, 470, xs, ['Date', 'Description', 'Debit', 'Credit', 'Balance'], p.fb);
  cells(p, 450, xs, ['01/08/2026', 'Opening Balance', '', '', 'INR 1,95,300.00']);
  cells(p, 430, xs, ['03/08/2026', 'Salary Credit - Specimen Tech', '', 'INR 62,450.00', 'INR 2,57,750.00']);
  cells(p, 410, xs, ['10/08/2026', 'UPI - Rent Payment', 'INR 18,000.00', '', 'INR 2,39,750.00']);
  cells(p, 390, xs, ['22/08/2026', 'NEFT Credit - Reimbursement', '', 'INR 44,550.00', 'INR 2,84,300.00']);
  section(p, 355, 'SUMMARY');
  kv(p, 330, 'Closing Balance:', 'INR 2,84,300.00', { bold: true });
  kv(p, 310, 'Average Monthly Balance:', 'INR 2,10,000.00');
  kv(p, 290, 'Total Credits:', 'INR 1,07,000.00');
  kv(p, 270, 'Total Debits:', 'INR 18,000.00');
  return p.doc.save();
}

export async function generateSalarySlipPdf(): Promise<Uint8Array> {
  const p = await newPdf('PAYSLIP FOR AUGUST 2026', 'PAYSLIP REF: PS-2026-08-10422', 'SPECIMEN TECHNOLOGIES PVT LTD');
  section(p, 630, 'EMPLOYEE DETAILS');
  kv(p, 605, 'Employee Name:', 'SPECIMEN PERSON', { bold: true });
  kv(p, 585, 'Employee ID:', 'EMP-10422', { mono: true });
  kv(p, 565, 'Designation:', 'Software Engineer');
  kv(p, 545, 'Employer:', 'Specimen Technologies Pvt Ltd');
  kv(p, 525, 'PAN:', 'ABCPS1234Z', { mono: true });
  kv(p, 505, 'UAN:', '100200300400', { mono: true });
  kv(p, 485, 'Bank Account:', '000012345678', { mono: true });
  section(p, 450, 'EARNINGS');
  kv(p, 425, 'Basic Pay:', 'INR 40,000.00');
  kv(p, 405, 'House Rent Allowance:', 'INR 16,000.00');
  kv(p, 385, 'Special Allowance:', 'INR 14,000.00');
  kv(p, 365, 'Gross Earnings:', 'INR 70,000.00', { bold: true });
  section(p, 330, 'DEDUCTIONS');
  kv(p, 305, 'Provident Fund:', 'INR 4,800.00');
  kv(p, 285, 'Professional Tax:', 'INR 200.00');
  kv(p, 265, 'Income Tax (TDS):', 'INR 2,550.00');
  kv(p, 245, 'Total Deductions:', 'INR 7,550.00', { bold: true });
  section(p, 210, 'NET PAY');
  kv(p, 185, 'Net Pay:', 'INR 62,450.00', { bold: true });
  kv(p, 165, 'Amount in words:', 'Sixty-two thousand four hundred fifty only');
  return p.doc.save();
}

export async function generateTaxFormPdf(): Promise<Uint8Array> {
  const p = await newPdf('FORM 16 - CERTIFICATE UNDER SECTION 203 (PART B)', 'CERTIFICATE NO: TDS-2026-000917', 'SPECIMEN TECHNOLOGIES PVT LTD (DEDUCTOR)');
  section(p, 630, 'PART A - IDENTIFICATION');
  kv(p, 605, 'Name of Employee:', 'SPECIMEN PERSON', { bold: true });
  kv(p, 585, 'PAN of Employee:', 'ABCPS1234Z', { mono: true });
  kv(p, 565, 'TAN of Employer:', 'ABCD12345E', { mono: true });
  kv(p, 545, 'Assessment Year:', '2026-27');
  kv(p, 525, 'Address:', '12 Sample Street, Specimen City 400001');
  section(p, 490, 'PART B - INCOME CHARGEABLE UNDER SALARIES');
  kv(p, 465, 'Gross Salary:', 'INR 8,40,000.00');
  kv(p, 445, 'Standard Deduction:', 'INR 50,000.00');
  kv(p, 425, 'Deductions (Chapter VI-A):', 'INR 70,000.00');
  kv(p, 405, 'Total Income:', 'INR 7,20,000.00', { bold: true });
  section(p, 370, 'TAX');
  kv(p, 345, 'Tax Payable:', 'INR 54,600.00');
  kv(p, 325, 'Tax Deducted at Source:', 'INR 54,600.00');
  kv(p, 305, 'Verification:', 'Certified that the above is true and correct.');
  return p.doc.save();
}

export async function generateGenericFinancialPdf(): Promise<Uint8Array> {
  const p = await newPdf('TAX INVOICE / PAYMENT RECEIPT', 'INVOICE NO: INV-2026-0142', 'SPECIMEN PAYMENTS LLP');
  section(p, 630, 'PARTIES');
  kv(p, 605, 'Billed To:', 'SPECIMEN PERSON', { bold: true });
  kv(p, 585, 'Email:', 'specimen.person@example.com');
  kv(p, 565, 'Beneficiary Account:', '000012345678', { mono: true });
  kv(p, 545, 'IFSC:', 'SPEC0000001', { mono: true });
  kv(p, 525, 'Invoice Date:', '28/08/2026');
  section(p, 490, 'ITEMS');
  const xs = [55, 330, 470];
  cells(p, 470, xs, ['Description', 'Qty', 'Amount'], p.fb);
  cells(p, 450, xs, ['Consulting services (August 2026)', '1', 'INR 62,500.00']);
  cells(p, 430, xs, ['GST @ 20%', '', 'INR 12,500.00']);
  section(p, 395, 'TOTALS');
  kv(p, 370, 'Sub Total:', 'INR 62,500.00');
  kv(p, 350, 'Total Amount Payable:', 'INR 75,000.00', { bold: true });
  kv(p, 330, 'Payment Status:', 'PAID via NEFT on 29/08/2026');
  return p.doc.save();
}

/* ------------------------------------------------------------- dispatcher */

const SPECIMENS: Record<string, { fileName: string; mimeType: string; make: () => Promise<Uint8Array> }> = {
  aadhaar: { fileName: 'Aadhaar_SPECIMEN_sample.png', mimeType: 'image/png', make: generateSampleAadhaarPng },
  pan: { fileName: 'PAN_Card_SPECIMEN_sample.png', mimeType: 'image/png', make: generatePanCardPng },
  college_id: { fileName: 'College_ID_SPECIMEN_sample.png', mimeType: 'image/png', make: generateCollegeIdPng },
  generic_id: { fileName: 'Identity_Card_SPECIMEN_sample.png', mimeType: 'image/png', make: generateGenericIdPng },
  bank_statement: { fileName: 'Bank_Statement_SPECIMEN_sample.pdf', mimeType: 'application/pdf', make: generateBankStatementPdf },
  salary_slip: { fileName: 'Salary_Slip_SPECIMEN_sample.pdf', mimeType: 'application/pdf', make: generateSalarySlipPdf },
  tax_form: { fileName: 'Form16_SPECIMEN_sample.pdf', mimeType: 'application/pdf', make: generateTaxFormPdf },
  generic_financial: { fileName: 'Invoice_SPECIMEN_sample.pdf', mimeType: 'application/pdf', make: generateGenericFinancialPdf },
  income_accredited: { fileName: 'Accredited_Investor_Verification_ApexLP.pdf', mimeType: 'application/pdf', make: generateSamplePdfBytes },
};

export const SPECIMEN_SCENARIOS = Object.keys(SPECIMENS);

/** The specimen document for a scenario (falls back to the income certificate). */
export async function generateSpecimen(scenarioId: string): Promise<SpecimenFile> {
  const spec = SPECIMENS[scenarioId] ?? SPECIMENS.income_accredited;
  return { bytes: await spec.make(), fileName: spec.fileName, mimeType: spec.mimeType };
}
