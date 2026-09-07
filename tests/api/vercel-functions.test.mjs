/**
 * Exercises the Vercel function handlers (api/verify/*) end to end against a
 * mock Upstash REST store, using a genuine Groth16 proof generated with the
 * production circuit. No browser needed:
 *   node tests/api/vercel-functions.test.mjs
 */
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as snarkjs from 'snarkjs';
import { buildPoseidon } from 'circomlibjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = (d) => createHash('sha256').update(d).digest('hex');
let failures = 0;
const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };

/* --- mock Upstash REST API (SET/GET/DEL with bearer auth) --- */
const kv = new Map();
const upstash = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== 'Bearer test-token') { res.statusCode = 401; res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const [op, key, val] = JSON.parse(b);
    let result = null;
    if (op === 'SET') { kv.set(key, val); result = 'OK'; }
    else if (op === 'GET') result = kv.has(key) ? kv.get(key) : null;
    else if (op === 'DEL') result = kv.delete(key) ? 1 : 0;
    res.end(JSON.stringify({ result }));
  });
});
await new Promise((r) => upstash.listen(0, r));
process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${upstash.address().port}`;
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
delete process.env.PUBLIC_URL;

const fn = async (rel) => (await import(pathToFileURL(path.join(ROOT, 'api/verify', rel)).href)).default;
const init = await fn('init.js');
const callback = await fn('callback.js');
const status = await fn('status/[id].js');
const redacted = await fn('redacted/[id].js');
const events = await fn('events/[id].js');
const { recomputeSeal } = await import(pathToFileURL(path.join(ROOT, 'server/lib/verifier-core.mjs')).href);

function mockRes() {
  return { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
}
async function call(handler, { method = 'GET', body, query = {} } = {}) {
  const req = { method, headers: { host: 'zeroara.test', 'x-forwarded-proto': 'https', 'content-type': 'application/json' }, body, query };
  const res = mockRes();
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch { /* binary */ }
  return { status: res.statusCode, json, body: res.body, headers: res.headers };
}

/* --- a genuine proof: age 28 >= 18, Poseidon commitment --- */
console.log('generating a Groth16 proof with the production circuit…');
const poseidon = await buildPoseidon();
const salt = BigInt('0x' + randomBytes(31).toString('hex'));
const commitment = poseidon.F.toString(poseidon([28n, salt]));
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  { actualValue: 28, blindingSalt: salt.toString(), thresholdValue: 18, expectedCommitment: commitment },
  path.join(ROOT, 'public/zk/income_threshold.wasm'),
  path.join(ROOT, 'public/zk/income_threshold.zkey')
);
check(publicSignals[0] === '18' && publicSignals[1] === commitment, 'public signals are [threshold, commitment]');

const pdf = Buffer.from('%PDF-1.4\n% zeroara test redacted document\n%%EOF\n');
const pdfHash = sha256(pdf);
const bboxes = [{ id: 'dob', label: 'Date of Birth', x: 10, y: 20, width: 100, height: 20, page: 1 }, { id: 'uid', label: 'Aadhaar Number', x: 10, y: 60, width: 200, height: 24, page: 1 }];

function buildPayload(session, { tamperProof = false, threshold = 18 } = {}) {
  const p = tamperProof ? { ...proof, pi_a: [...proof.pi_a] } : proof;
  if (tamperProof) p.pi_a[0] = (BigInt(p.pi_a[0]) + 1n).toString();
  const receipt = {
    protocol: 'Zeroara Provable Redaction Protocol',
    version: '1.0.0',
    scenario: { id: 'aadhaar', label: 'Aadhaar Card', category: 'identity' },
    redactionMode: 'PROOF_BACKED',
    sourceDocument: { fileName: 'document (name withheld)', fileSizeBytes: 1, mimeType: 'image/png', preimageSha256: '' },
    sanitizedDocument: { fileSizeBytes: pdf.length, preimageSha256: pdfHash, burnedBoundingBoxes: bboxes, textStreamsDetected: 0 },
    redactedFields: [{ label: 'Date of Birth', classification: 'DOB', action: 'PROVE_AND_BURN' }, { label: 'Aadhaar Number', classification: 'UID', action: 'DIRECT_BURN' }],
    enterpriseRequirement: { requesterName: 'Test', purpose: 't', documentCategory: 'Aadhaar Card', targetField: 'Date of Birth', predicate: '>=', thresholdValue: threshold, currency: 'years', challengeNonce: session.nonce, requiredRedactionFields: [] },
    zeroKnowledgeProof: { curve: 'bn128', protocol: 'groth16', publicSignals, proof: p, poseidonCommitment: commitment, blindingSalt: '', verified: true, verificationLatencyMs: 1 },
    masterAuditSeal: { sealHex: recomputeSeal(pdfHash, bboxes, commitment, p) },
  };
  return {
    version: 1, requestId: session.requestId, nonce: session.nonce, status: 'VERIFIED', predicateSatisfied: true, document: 'aadhaar',
    claim: { field: 'Age', op: '>=', value: 18, unit: 'years' }, redactionMode: 'PROOF_BACKED',
    proof: { ...p, publicSignals }, commitment, masterAuditSeal: receipt.masterAuditSeal.sealHex, redactedDocumentSha256: pdfHash,
    redactedPdfBase64: pdf.toString('base64'), receipt, signedTimestamp: new Date().toISOString(),
  };
}

/* --- 1. happy path --- */
const pre = await call(init, { method: 'OPTIONS' });
check(pre.status === 204 && pre.headers['access-control-allow-origin'] === '*', 'CORS preflight answered');
const s1 = await call(init, { method: 'POST', body: { document: 'aadhaar', claim: { field: 'Age', op: '>=', value: 18, unit: 'years' }, requester: 'Aegis Rentals', wantRedactedPdf: true } });
check(s1.status === 201 && s1.json.ok, 'init → 201');
check(s1.json.callbackUrl === 'https://zeroara.test/api/verify/callback', `callbackUrl derived from the request origin (${s1.json.callbackUrl})`);
check(s1.json.deepLink.startsWith('zeroara://verify?request=') && s1.json.webFallbackUrl.startsWith('https://zeroara.test/?request='), 'deep link and web fallback issued');
check(kv.has(`zeroara:session:${s1.json.requestId}`), 'session persisted in the (mock) Upstash store');
const cb1 = await call(callback, { method: 'POST', body: buildPayload(s1.json) });
check(cb1.status === 200 && cb1.json.status === 'VERIFIED', `callback → VERIFIED (${cb1.json?.reasons?.join(' ') ?? 'ok'})`);
check(cb1.json.verification?.proofVerified === true && cb1.json.verification?.sealValid === true, `proof verified in ${cb1.json.verification?.proofVerifyMs} ms, seal recomputed`);
const st1 = await call(status, { query: { id: s1.json.requestId } });
check(st1.status === 200 && st1.json.status === 'VERIFIED' && st1.json.redactedPdfAvailable === true, 'status → VERIFIED with redacted PDF available');
const rd1 = await call(redacted, { query: { id: s1.json.requestId } });
check(rd1.status === 200 && rd1.headers['content-type'] === 'application/pdf' && Buffer.compare(rd1.body, pdf) === 0, 'redacted PDF served byte-for-byte');
const replay = await call(callback, { method: 'POST', body: buildPayload(s1.json) });
check(replay.status === 409, `replay refused (${replay.status})`);
const ev = await call(events, { query: { id: s1.json.requestId } });
check(ev.status === 501, 'events endpoint tells the SDK to poll (501)');

/* --- 2. tampered proof --- */
const s2 = await call(init, { method: 'POST', body: { document: 'aadhaar', claim: { op: '>=', value: 18 }, requester: 'T' } });
const cb2 = await call(callback, { method: 'POST', body: buildPayload(s2.json, { tamperProof: true }) });
check(cb2.status === 422 && cb2.json.reasons.some((r) => /does not verify/.test(r)), `tampered proof rejected: ${cb2.json.reasons?.[0]}`);

/* --- 3. threshold below the claim --- */
const s3 = await call(init, { method: 'POST', body: { document: 'aadhaar', claim: { op: '>=', value: 30 }, requester: 'T' } });
const cb3 = await call(callback, { method: 'POST', body: buildPayload(s3.json) });
check(cb3.status === 422 && cb3.json.reasons.some((r) => /does not cover the requested 30/.test(r)), `proof for 18 cannot satisfy a claim of 30: ${cb3.json.reasons?.[0]}`);

/* --- 4. wrong nonce, unknown session, declined --- */
const s4 = await call(init, { method: 'POST', body: { document: 'aadhaar', claim: { op: '>=', value: 18 }, requester: 'T' } });
const cb4 = await call(callback, { method: 'POST', body: { ...buildPayload(s4.json), nonce: '0x00' } });
check(cb4.status === 400, 'wrong nonce → 400');
const unknown = await call(status, { query: { id: 'req_nope' } });
check(unknown.status === 404, 'unknown session → 404');
const s5 = await call(init, { method: 'POST', body: { document: 'aadhaar', claim: { op: '>=', value: 18 }, requester: 'T' } });
const cb5 = await call(callback, { method: 'POST', body: { version: 1, requestId: s5.json.requestId, nonce: s5.json.nonce, status: 'DECLINED', predicateSatisfied: false, document: 'aadhaar', claim: null, signedTimestamp: new Date().toISOString() } });
check(cb5.status === 200 && cb5.json.status === 'DECLINED', 'declined recorded');

/* --- 5. missing store → 503 with instructions --- */
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
const noStore = await call(init, { method: 'POST', body: { document: 'aadhaar' } });
check(noStore.status === 503 && /UPSTASH_REDIS_REST_URL/.test(noStore.json.error), 'without a store the API explains what to configure (503)');

upstash.close();
console.log(failures ? `${failures} check(s) failed` : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
