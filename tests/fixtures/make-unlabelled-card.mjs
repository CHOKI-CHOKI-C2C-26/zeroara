// Builds tests/fixtures/unlabelled_student_id.pdf: a 2-page student ID in the
// style of a real university card — front has NO field labels (header, photo,
// name, registration code, residence category); back has labelled fields.
//   node tests/fixtures/make-unlabelled-card.mjs
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'unlabelled_student_id.pdf');
const pdf = await PDFDocument.create();
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const reg = await pdf.embedFont(StandardFonts.Helvetica);
const W = 243, H = 383; // CR80 card at 72 dpi (portrait)
const center = (page, text, y, font, size, color = rgb(0.1, 0.1, 0.1)) => {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (W - w) / 2, y, size, font, color });
};

const front = pdf.addPage([W, H]);
front.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: rgb(0.96, 0.96, 0.98) });
center(front, 'VIT', H - 30, bold, 22, rgb(0.05, 0.2, 0.5));
center(front, 'Vellore Institute of Technology', H - 46, bold, 9);
center(front, '(Deemed to be University under section 3 of the UGC Act, 1956)', H - 58, reg, 5);
center(front, 'VELLORE CAMPUS', H - 84, bold, 8);
// Photo (a plain grey portrait box) between the header and the name.
front.drawRectangle({ x: (W - 100) / 2, y: 120, width: 100, height: 125, color: rgb(0.75, 0.78, 0.82) });
front.drawEllipse({ x: W / 2, y: 200, xScale: 22, yScale: 26, color: rgb(0.55, 0.58, 0.62) });
center(front, 'Aarav Specimen', 96, bold, 15);
center(front, '25BYB0259', 78, bold, 12);
front.drawRectangle({ x: 0, y: 0, width: W, height: 40, color: rgb(0.05, 0.2, 0.5) });
center(front, 'HOSTELLER', 14, bold, 12, rgb(1, 1, 1));

const back = pdf.addPage([W, H]);
const kv = (label, value, y) => {
  back.drawText(label, { x: 16, y, size: 7.5, font: bold });
  back.drawText(value, { x: 100, y, size: 7.5, font: reg });
};
kv('Blood Group', 'B+', H - 40);
kv('Date of Birth', '12/03/2006', H - 58);
kv('Emergency Contact', '9876500000', H - 76);
kv('Parent Name', 'Rohan Specimen', H - 94);
back.drawText('Address', { x: 16, y: H - 112, size: 7.5, font: bold });
back.drawText('12 Sample Street, Katpadi,', { x: 100, y: H - 112, size: 7.5, font: reg });
back.drawText('Vellore 632014, Tamil Nadu', { x: 100, y: H - 124, size: 7.5, font: reg });
kv('Valid Till', '31/05/2029', H - 148);
center(back, 'If found please return to', 60, reg, 7);
center(back, 'Vellore Institute of Technology, Vellore - 632014', 48, reg, 7);
center(back, 'www.vit.ac.in', 36, reg, 7);

await writeFile(out, await pdf.save());
console.log('wrote', out);
