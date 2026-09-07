/**
 * Zeroara Scenario Registry
 * -------------------------------------------------------------------------
 * Cross-cutting configuration that turns Zeroara from a single income-demo
 * into a general provable-redaction workbench. Each scenario declares the
 * sensitive fields expected in a document category, how to detect them, and
 * what redaction action applies:
 *
 *   - DIRECT_BURN     irreversible pixel redaction of a PII identifier
 *   - PROVE_AND_BURN  redaction + a Groth16 predicate proof (numeric only)
 *   - DETECT_ONLY     flagged/located but not burned (no circuit yet)
 *
 * A scenario's proofMode is:
 *   - PROOF_BACKED    at least one numeric witness field can drive a predicate
 *   - SEAL_ONLY       identity/other docs: redaction is bound into the master
 *                     audit seal, but no numeric ZK proof is generated
 *
 * This module is pure data + regexes (no runtime imports from layers) so it
 * can be consumed by the OCR layer, the UI, and the seal/receipt layer
 * without creating cycles.
 */

import type { TargetAction } from '../layers/layer2_ocr/types';

export type ScenarioProofMode = 'PROOF_BACKED' | 'SEAL_ONLY';

export type FieldDetector =
  // Regex matched against reconstructed line text; the matched substring is the value.
  | { kind: 'pattern'; re: RegExp }
  // Label keyword on a line; the tokens after the label on that line are the value.
  | { kind: 'label'; re: RegExp }
  // Currency/number amounts (handled specially so a witness can be chosen).
  // witnessLabels rank the line labels that identify the witness amount, best first
  // (e.g. "Closing balance" before any "balance"); unlabelled amounts are burned.
  | { kind: 'currency'; witnessLabels?: RegExp[] }
  // Date/Year of Birth line -> burns the DOB and yields numericValue = age in years (witness).
  | { kind: 'age_from_dob' }
  // The Latin-script name line directly above the DOB line (Aadhaar card layout).
  | { kind: 'name_above_dob' }
  // Aadhaar portrait region inferred from the demographic-column geometry.
  | { kind: 'aadhaar_photo_layout' };

export interface ScenarioField {
  key: string;
  label: string;
  classification: string;
  action: TargetAction;
  detect: FieldDetector;
  numeric?: boolean;
  /** The single numeric field whose value drives the ZK predicate. */
  isWitness?: boolean;
  /** Lower runs first, so specific identifiers claim their tokens before generic ones. */
  priority: number;
}

export interface DocumentScenario {
  id: string;
  label: string;
  category: string;
  description: string;
  proofMode: ScenarioProofMode;
  fields: ScenarioField[];
  defaults: {
    requesterName: string;
    purpose: string;
    /** Human-readable predicate; 'Seal-only (no numeric predicate)' when not proof-backed. */
    predicate: string;
    /** Threshold for the numeric predicate; 0 when not applicable. */
    thresholdValue: number;
    /** Currency/unit for the numeric predicate; '' when not applicable. */
    unit: string;
  };
}

// --- Shared detectors -------------------------------------------------------
// India-specific and generic identifiers.
export const RE_AADHAAR =
  // Trailing 4-4-4 groups (digits or masked XXXX/****) ending at a word boundary.
  // No leading \b on purpose: OCR often fuses speckle/photo-edge noise onto the
  // first group (e.g. "770123 4567 8901"), and we must still find "0123 4567 8901".
  /(?:\d{4}|[Xx]{4}|\*{4})[\s-]?(?:\d{4}|[Xx]{4}|\*{4})[\s-]?\d{4}\b/;
export const RE_VID = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;   // 16-digit Aadhaar VID
export const RE_PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/;                      // ABCDE1234F
export const RE_IFSC = /\b[A-Z]{4}0[A-Z0-9]{6}\b/;                   // HDFC0001234
export const RE_ACCOUNT = /\b\d{9,18}\b/;                            // bank account no.
export const RE_DATE = /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/;    // 01/02/1990
export const RE_YEAR = /\b(?:19|20)\d{2}\b/;
export const RE_EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
export const RE_PHONE_IN = /\b(?:\+91[\-\s]?)?[6-9]\d{9}\b/;         // Indian mobile
export const RE_SSN = /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/;               // US SSN (legacy)
export const RE_TAN = /\b[A-Z]{4}\d{5}[A-Z]\b/;                        // employer TAN: ABCD12345E
export const RE_GENDER = /\b(?:MALE|FEMALE|TRANSGENDER|Male|Female|Transgender)\b|\u092a\u0941\u0930\u0941\u0937|\u092e\u0939\u093f\u0932\u093e/;
export const RE_CURRENCY =
  /(?:INR|Rs\.?|₹|USD|US\$|\$|€|£)\s?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?(?:\s?(?:INR|USD|EUR|GBP))?|\b\d{4,9}\.\d{2}\b(?:\s?(?:INR|USD|EUR|GBP))?/;

// Label keywords (India + generic).
const L_NAME = /\bname\b/i;
const L_FATHER = /\bfather'?s?\b/i;
const L_ADDRESS = /\baddress\b/i;
const L_ROLL = /\b(?:roll(?:\s*(?:no|number))?|enrol?ment(?:\s*(?:no|number))?)\b/i;
const L_REG = /\b(?:reg(?:istration)?\.?\s*(?:no|number)?|registration)\b/i;
const L_DEPT = /\b(?:dept|department|branch|programme|program|course)\b/i;
const L_BATCH = /\b(?:batch|session|semester|academic year|year of study)\b/i;
const L_EMPID = /\b(?:emp(?:loyee)?\.?\s*(?:id|code|no)|staff\s*id)\b/i;
const L_EMPLOYER = /\b(?:employer|company|organi[sz]ation|firm)\b/i;
const L_DOCNO = /\b(?:document\s*(?:no|number)|id\s*(?:no|number)|reference\s*(?:no|number))\b/i;
const L_VID = /\b(?:vid|virtual id|enrol?ment no)\b/i;
const L_GUARDIAN = /\b(?:S\/O|D\/O|W\/O|C\/O|son of|daughter of|wife of|care of)\b/i;
const L_CUSTOMER = /\b(?:customer\s*(?:id|no|number)|cif(?:\s*(?:no|number))?|crn)\b/i;
const L_UAN = /\bUAN\b/i;

// Which amount is the witness, per document type (best label first).
const W_INCOME = [/\b(?:annual|net|total|audited)\s+income\b/i, /\bincome\b|\bsalary\b|\bearnings\b|\bwages?\b|\bcompensation\b/i];
const W_BALANCE = [/\b(?:closing|available|current|ledger)\s+balance\b|\bbalance\s+(?:as\s+on|at)\b/i, /\bbalance\b/i];
const W_NET_PAY = [/\bnet\s*(?:pay|salary|payable|amount|earnings)\b|\btake[\s-]?home\b/i, /\bgross\s*(?:pay|salary|earnings)\b/i];
const W_DECLARED_INCOME = [/\b(?:total|taxable|declared|gross\s+total|net)\s+income\b/i, /\bincome\b/i];
const W_AMOUNT = [/\b(?:total\s+amount|amount\s+payable|grand\s+total|net\s+payable|amount\s+due)\b/i, /\btotal\b/i, /\bamount\b|\bbalance\b/i];

const PREDICATE_GTE = '>= (Greater than or equal to)';
const PREDICATE_SEAL_ONLY = 'Seal-only (no numeric predicate)';

// Reusable field builders.
const nameField = (): ScenarioField => ({
  key: 'name', label: 'Full Name', classification: 'Personal Name (PII)',
  action: 'DIRECT_BURN', detect: { kind: 'label', re: L_NAME }, priority: 30,
});
const dobField = (): ScenarioField => ({
  key: 'dob', label: 'Date / Year of Birth', classification: 'Date of Birth (PII)',
  action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_DATE }, priority: 20,
});
const addressField = (): ScenarioField => ({
  key: 'address', label: 'Address', classification: 'Residential Address (PII)',
  action: 'DIRECT_BURN', detect: { kind: 'label', re: L_ADDRESS }, priority: 35,
});
const emailField = (): ScenarioField => ({
  key: 'email', label: 'Email Address', classification: 'Contact Identifier (PII)',
  action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_EMAIL }, priority: 15,
});
const phoneField = (): ScenarioField => ({
  key: 'phone', label: 'Phone Number', classification: 'Contact Identifier (PII)',
  action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_PHONE_IN }, priority: 16,
});

export const SCENARIOS: DocumentScenario[] = [
  {
    id: 'aadhaar',
    label: 'Aadhaar Card',
    category: 'Indian Identity Document',
    description:
      'UIDAI Aadhaar (card photo, e-Aadhaar PDF, or masked Aadhaar). Burns the 12-digit / masked number, name, gender, and date of birth, and proves AGE \u2265 threshold from the DOB without revealing it.',
    proofMode: 'PROOF_BACKED',
    fields: [
      { key: 'aadhaar', label: 'Aadhaar Number', classification: 'Aadhaar / UIDAI Number (Sensitive PII)', action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_AADHAAR }, priority: 5 },
      { key: 'gender', label: 'Gender', classification: 'Personal Attribute (PII)', action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_GENDER }, priority: 12 },
      { key: 'age', label: 'Date of Birth', classification: 'Age Witness (ZK Predicate: age \u2265 threshold)', action: 'PROVE_AND_BURN', detect: { kind: 'age_from_dob' }, numeric: true, isWitness: true, priority: 20 },
      { key: 'name', label: 'Full Name', classification: 'Personal Name (PII)', action: 'DIRECT_BURN', detect: { kind: 'name_above_dob' }, priority: 30 },
      addressField(),
      { key: 'vid', label: 'Virtual ID (VID)', classification: 'Aadhaar Virtual Identifier (Sensitive PII)', action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_VID }, priority: 4 },
      { key: 'guardian', label: 'Parent / Guardian Name', classification: 'Relation Name (PII)', action: 'DIRECT_BURN', detect: { kind: 'label', re: L_GUARDIAN }, priority: 25 },
      { key: 'photo', label: 'Photo (face)', classification: 'Biometric Photo Region (layout-inferred)', action: 'DIRECT_BURN', detect: { kind: 'aadhaar_photo_layout' }, priority: 60 },
      { key: 'enrolment', label: 'Enrolment Reference', classification: 'Aadhaar Reference Identifier', action: 'DETECT_ONLY', detect: { kind: 'label', re: L_VID }, priority: 40 },
    ],
    defaults: { requesterName: 'KYC Verification Desk', purpose: 'Age-gated KYC: prove age \u2265 18 from Aadhaar without revealing DOB', predicate: PREDICATE_GTE, thresholdValue: 18, unit: 'years' },
  },
  {
    id: 'pan',
    label: 'PAN Card',
    category: 'Indian Identity Document',
    description:
      'Income Tax Department PAN card. Redacts the PAN, name, father’s name, and date of birth. Identity document — seal-only.',
    proofMode: 'SEAL_ONLY',
    fields: [
      { key: 'pan', label: 'PAN', classification: 'Permanent Account Number (Sensitive PII)', action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_PAN }, priority: 5 },
      nameField(),
      { key: 'father', label: "Father's Name", classification: 'Parent Name (PII)', action: 'DIRECT_BURN', detect: { kind: 'label', re: L_FATHER }, priority: 25 },
      dobField(),
    ],
    defaults: { requesterName: 'KYC Verification Desk', purpose: 'PAN-based identity KYC (privacy-preserving)', predicate: PREDICATE_SEAL_ONLY, thresholdValue: 0, unit: '' },
  },
  {
    id: 'college_id',
    label: 'College / Student ID',
    category: 'Institutional Identity Document',
    description:
      'Student / college ID card. Redacts student name, roll number, registration number, department, and batch/year. Photo regions can be added manually. Seal-only.',
    proofMode: 'SEAL_ONLY',
    fields: [
      { key: 'name', label: 'Student Name', classification: 'Personal Name (PII)', action: 'DIRECT_BURN', detect: { kind: 'label', re: L_NAME }, priority: 30 },
      { key: 'roll', label: 'Roll Number', classification: 'Institutional Identifier (PII)', action: 'DIRECT_BURN', detect: { kind: 'label', re: L_ROLL }, priority: 20 },
      { key: 'registration', label: 'Registration Number', classification: 'Institutional Identifier (PII)', action: 'DIRECT_BURN', detect: { kind: 'label', re: L_REG }, priority: 21 },
      { key: 'department', label: 'Department / Branch', classification: 'Institutional Attribute', action: 'DIRECT_BURN', detect: { kind: 'label', re: L_DEPT }, priority: 32 },
      { key: 'batch', label: 'Batch / Year', classification: 'Institutional Attribute', action: 'DIRECT_BURN', detect: { kind: 'label', re: L_BATCH }, priority: 33 },
      dobField(),
    ],
    defaults: { requesterName: 'Campus Access Control', purpose: 'Student identity verification (privacy-preserving)', predicate: PREDICATE_SEAL_ONLY, thresholdValue: 0, unit: '' },
  },
  {
    id: 'bank_statement',
    label: 'Bank Statement',
    category: 'Financial Document',
    description:
      'Bank account statement. Redacts account number and IFSC, and can prove a balance/credit predicate (e.g. balance ≥ threshold) without revealing the amount.',
    proofMode: 'PROOF_BACKED',
    fields: [
      { key: 'account', label: 'Account Number', classification: 'Bank Account Number (Sensitive PII)', action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_ACCOUNT }, priority: 8 },
      { key: 'ifsc', label: 'IFSC Code', classification: 'Bank Routing Identifier', action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_IFSC }, priority: 6 },
      { key: 'customer', label: 'Customer ID', classification: 'Bank Customer Identifier (PII)', action: 'DIRECT_BURN', detect: { kind: 'label', re: L_CUSTOMER }, priority: 15 },
      nameField(),
      { key: 'balance', label: 'Closing Balance', classification: 'Financial Witness Claim (ZK Predicate: balance \u2265 threshold)', action: 'PROVE_AND_BURN', detect: { kind: 'currency', witnessLabels: W_BALANCE }, numeric: true, isWitness: true, priority: 50 },
    ],
    defaults: { requesterName: 'Lender Underwriting Desk', purpose: 'Solvency / balance threshold verification', predicate: PREDICATE_GTE, thresholdValue: 50000, unit: 'INR' },
  },
  {
    id: 'salary_slip',
    label: 'Salary Slip',
    category: 'Financial Document',
    description:
      'Payslip. Redacts employee ID and employer, and can prove a net/gross pay predicate (e.g. net pay ≥ threshold) without revealing the amount.',
    proofMode: 'PROOF_BACKED',
    fields: [
      { key: 'pan', label: 'PAN / Tax ID', classification: 'Tax Identifier (Sensitive PII)', action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_PAN }, priority: 6 },
      { key: 'uan', label: 'UAN', classification: 'Provident Fund Identifier (PII)', action: 'DIRECT_BURN', detect: { kind: 'label', re: L_UAN }, priority: 7 },
      { key: 'account', label: 'Bank Account Number', classification: 'Bank Account Number (Sensitive PII)', action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_ACCOUNT }, priority: 8 },
      { key: 'employee_id', label: 'Employee ID', classification: 'Employment Identifier (PII)', action: 'DIRECT_BURN', detect: { kind: 'label', re: L_EMPID }, priority: 20 },
      nameField(),
      { key: 'employer', label: 'Employer', classification: 'Employment Attribute', action: 'DIRECT_BURN', detect: { kind: 'label', re: L_EMPLOYER }, priority: 31 },
      { key: 'pay', label: 'Net Pay', classification: 'Financial Witness Claim (ZK Predicate: net pay \u2265 threshold)', action: 'PROVE_AND_BURN', detect: { kind: 'currency', witnessLabels: W_NET_PAY }, numeric: true, isWitness: true, priority: 50 },
    ],
    defaults: { requesterName: 'Rental / Lending Verifier', purpose: 'Income threshold verification', predicate: PREDICATE_GTE, thresholdValue: 50000, unit: 'INR' },
  },
  {
    id: 'tax_form',
    label: 'Tax Form',
    category: 'Financial Document',
    description:
      'Tax return / Form-16 style document. Redacts PAN and can prove a declared-income predicate without revealing the figure.',
    proofMode: 'PROOF_BACKED',
    fields: [
      { key: 'pan', label: 'PAN', classification: 'Permanent Account Number (Sensitive PII)', action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_PAN }, priority: 6 },
      { key: 'tan', label: 'Employer TAN', classification: 'Tax Deduction Account Number', action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_TAN }, priority: 7 },
      nameField(),
      addressField(),
      { key: 'income', label: 'Total Income', classification: 'Financial Witness Claim (ZK Predicate: income \u2265 threshold)', action: 'PROVE_AND_BURN', detect: { kind: 'currency', witnessLabels: W_DECLARED_INCOME }, numeric: true, isWitness: true, priority: 50 },
    ],
    defaults: { requesterName: 'Tax Compliance Verifier', purpose: 'Declared income threshold verification', predicate: PREDICATE_GTE, thresholdValue: 250000, unit: 'INR' },
  },
  {
    id: 'income_accredited',
    label: 'Accredited Investor / Income',
    category: 'Financial Document',
    description:
      'Accredited-investor / income certificate. Proves a net income ≥ threshold predicate and burns SSN and other financial figures. (Original Zeroara demo scenario.)',
    proofMode: 'PROOF_BACKED',
    fields: [
      { key: 'ssn', label: 'Social Security Number', classification: 'Government Identifier (Sensitive PII)', action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_SSN }, priority: 5 },
      emailField(),
      { key: 'income', label: '2-Year Trailing Income', classification: 'Financial Witness Claim (ZK Predicate)', action: 'PROVE_AND_BURN', detect: { kind: 'currency', witnessLabels: W_INCOME }, numeric: true, isWitness: true, priority: 50 },
    ],
    defaults: { requesterName: 'Apex Distributed Ventures LP', purpose: 'SEC Rule 506(c) Accredited Investor Verification', predicate: PREDICATE_GTE, thresholdValue: 100000, unit: 'USD' },
  },
  {
    id: 'generic_id',
    label: 'Generic Identity Document',
    category: 'Identity Document',
    description:
      'Any identity document. Redacts document/ID number, name, DOB, address, phone, and email. Seal-only.',
    proofMode: 'SEAL_ONLY',
    fields: [
      { key: 'doc_no', label: 'Document / ID Number', classification: 'Document Identifier (PII)', action: 'DIRECT_BURN', detect: { kind: 'label', re: L_DOCNO }, priority: 18 },
      { key: 'aadhaar', label: 'Aadhaar Number', classification: 'Aadhaar / UIDAI Number (Sensitive PII)', action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_AADHAAR }, priority: 6 },
      { key: 'pan', label: 'PAN', classification: 'Permanent Account Number (Sensitive PII)', action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_PAN }, priority: 6 },
      nameField(),
      dobField(),
      addressField(),
      phoneField(),
      emailField(),
    ],
    defaults: { requesterName: 'Identity Verification Desk', purpose: 'General identity KYC (privacy-preserving)', predicate: PREDICATE_SEAL_ONLY, thresholdValue: 0, unit: '' },
  },
  {
    id: 'generic_financial',
    label: 'Generic Financial Document',
    category: 'Financial Document',
    description:
      'Any financial document. Burns account numbers and can prove a numeric amount predicate; other amounts are redacted directly.',
    proofMode: 'PROOF_BACKED',
    fields: [
      { key: 'account', label: 'Account Number', classification: 'Account Number (Sensitive PII)', action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_ACCOUNT }, priority: 8 },
      { key: 'ifsc', label: 'Routing / IFSC', classification: 'Routing Identifier', action: 'DIRECT_BURN', detect: { kind: 'pattern', re: RE_IFSC }, priority: 6 },
      emailField(),
      { key: 'amount', label: 'Total Amount', classification: 'Financial Witness Claim (ZK Predicate: amount \u2265 threshold)', action: 'PROVE_AND_BURN', detect: { kind: 'currency', witnessLabels: W_AMOUNT }, numeric: true, isWitness: true, priority: 50 },
    ],
    defaults: { requesterName: 'Financial Verifier', purpose: 'Numeric amount threshold verification', predicate: PREDICATE_GTE, thresholdValue: 50000, unit: 'INR' },
  },
];

export const DEFAULT_SCENARIO_ID = 'generic_id';

export function getScenario(id: string): DocumentScenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS.find((s) => s.id === DEFAULT_SCENARIO_ID)!;
}

export function isProofBacked(scenario: DocumentScenario): boolean {
  return scenario.proofMode === 'PROOF_BACKED' && scenario.fields.some((f) => f.isWitness);
}
