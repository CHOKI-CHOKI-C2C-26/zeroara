const { buildPoseidon } = require('circomlibjs');
const assert = require('node:assert/strict');

const DEPTH = 20;

async function poseidonHash(poseidon, left, right) {
  return poseidon.F.toString(poseidon([BigInt(left), BigInt(right)]));
}

async function merkleRoot(poseidon, leaf, siblings, pathIndices) {
  let current = leaf;
  for (let i = 0; i < DEPTH; i++) {
    current = pathIndices[i] === 0
      ? await poseidonHash(poseidon, current, siblings[i])
      : await poseidonHash(poseidon, siblings[i], current);
  }
  return current;
}

async function run() {
  const poseidon = await buildPoseidon();
  // In production this is a canonical field encoding of the credential, never
  // the raw SSN/licence string placed in public signals or logs.
  const credentialValue = 48291037n;
  const blindingSalt = 9043210987654321n;
  const commitment = await poseidonHash(poseidon, credentialValue, blindingSalt);
  const siblings = Array.from({ length: DEPTH }, (_, i) => BigInt(1000 + i).toString());
  const pathIndices = Array.from({ length: DEPTH }, (_, i) => i % 2);
  const root = await merkleRoot(poseidon, commitment, siblings, pathIndices);

  assert.equal(await merkleRoot(poseidon, commitment, siblings, pathIndices), root);
  assert.notEqual(
    await merkleRoot(poseidon, commitment, siblings, pathIndices.map((bit, i) => i === 3 ? 1 - bit : bit)),
    root,
    'altering a private Merkle path must not produce the approved root'
  );
  assert.equal(commitment.includes(credentialValue.toString()), false, 'commitment does not expose the raw credential value');

  console.log('PASS: private Poseidon credential commitment and depth-20 allowlist path produce a deterministic root');
  console.log('PASS: altered membership path is rejected by root comparison');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
