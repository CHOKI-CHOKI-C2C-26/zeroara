pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";

/*
  Private credential allowlist membership proof.

  The caller first maps an SSN, licence number, or other credential into a
  field element using a documented canonical encoding. The raw credential,
  blinding salt, Merkle siblings, and path bits remain private. The verifier
  receives only a Poseidon commitment to the credential and the published
  allowlist Merkle root.

  This circuit proves *membership* in an approved set. Proving that a value is
  absent from a sanctions registry requires a separately maintained sparse
  Merkle non-membership tree; do not infer non-membership from this circuit.
*/
template SetMembership(depth) {
    // Private witness
    signal input credentialValue;
    signal input blindingSalt;
    signal input siblings[depth];
    signal input pathIndices[depth];

    // Public statement
    signal input allowlistRoot;
    signal input credentialCommitment;

    // Commit to the credential before it enters the Merkle tree.
    component leafHasher = Poseidon(2);
    leafHasher.inputs[0] <== credentialValue;
    leafHasher.inputs[1] <== blindingSalt;
    leafHasher.out === credentialCommitment;

    signal current[depth + 1];
    current[0] <== credentialCommitment;

    component nodeHashers[depth];
    signal left[depth];
    signal right[depth];
    for (var i = 0; i < depth; i++) {
        // Path entries are bits: 0 means current is left; 1 means it is right.
        pathIndices[i] * (pathIndices[i] - 1) === 0;
        left[i] <== current[i] + pathIndices[i] * (siblings[i] - current[i]);
        right[i] <== siblings[i] + pathIndices[i] * (current[i] - siblings[i]);

        nodeHashers[i] = Poseidon(2);
        nodeHashers[i].inputs[0] <== left[i];
        nodeHashers[i].inputs[1] <== right[i];
        current[i + 1] <== nodeHashers[i].out;
    }

    current[depth] === allowlistRoot;
}

// Depth 20 supports up to 1,048,576 approved credentials.
component main {public [allowlistRoot, credentialCommitment]} = SetMembership(20);
