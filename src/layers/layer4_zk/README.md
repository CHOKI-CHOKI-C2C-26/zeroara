# Layer 4: Client-Side Groth16 ZK Prover & Witness Blinding

## 📋 Module Overview
Layer 4 is Zeroara's Zero-Knowledge cryptographic core. It evaluates arithmetic circuits compiled via Circom into R1CS over the BN128/BN254 elliptic curve directly inside client-side WebAssembly using `snarkjs`. It proves mathematical statements (such as `actualIncome >= thresholdValue`) while concealing the raw witness value behind a 253-bit blinding salt $r$ via Poseidon hashing.

---

## 👤 Ownership & Responsibility
- **Assigned Owner**: **Shrihaan Arora**
- **Role**: Zero-Knowledge Cryptographer & Circuit Engineer
- **Handoff Note**: Integrated in commit `7b9fcbe` with session context binding, Poseidon commitment verification, and offline embedded verification key fallback.

---

## ⚙️ Key Invariants & Rules
1. **Zero-Knowledge**: Raw financial values must NEVER be exposed as public signals or serialized into audit receipts without blinding.
2. **Poseidon Hashing**: Commitment $C = \text{Poseidon}(\text{actualValue}, r)$ where $r \in \mathbb{F}_p$ is a cryptographically secure 253-bit scalar.
3. **Session Binding**: Prover outputs must be bound to the session context (nonce, requester, document digest) to prevent replay attacks.
4. **Client-Side WASM Execution**: Proof generation must execute locally in $<1000\text{ms}$ with zero cloud offloading.

---

## 📥 Inputs & 📤 Outputs
- **Input**: Private witness numerical value, threshold value, blinding salt, and session context.
- **Output**: `Groth16ProofResult` containing proof points $(\pi_a, \pi_b, \pi_c)$, public signals, Poseidon commitment, and soundness validation.

---

## 🤖 Instructions for AI Agents
- Circuits live in `circuits/income_threshold.circom` and `circuits/set_membership.circom`.
- WebAssembly and zkey assets must be accessed via `/zk/income_threshold.wasm` and `/zk/income_threshold.zkey`.

## Private credential set membership

`set_membership.circom` proves that a private credential-derived field value is
in an approved Poseidon Merkle allowlist. Its only public inputs are
`allowlistRoot` and `credentialCommitment`; it never exposes the original SSN,
licence number, salt, siblings, or path direction. It uses a fixed depth of 20
(up to 1,048,576 leaves). Run `npm run test:zk-membership` to validate the
off-circuit commitment and Merkle-path construction.

It intentionally does not claim that a credential is absent from a sanctions
list. That needs a separately governed sparse-Merkle non-membership registry,
including an authenticated empty-leaf convention and a published root.
- If an offline environment cannot fetch `/zk/verification_key.json`, ensure the engine seamlessly falls back to `EMBEDDED_VERIFICATION_KEY`.
