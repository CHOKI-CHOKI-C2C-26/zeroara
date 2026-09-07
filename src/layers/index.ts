// Layer 1: Ingest & SHA-256 Preimage Digest
export * from './layer1_ingest/types';
export * from './layer1_ingest/ingestEngine';
export * from './layer1_ingest/specimens';

// Layer 2: OCR Spatial Extraction & Geometry Detection
export * from './layer2_ocr/types';
export * from './layer2_ocr/ocrEngine';

// Layer 3: Physical Pixel Burning & Text Stream Stripping
export * from './layer3_burn/types';
export * from './layer3_burn/burnEngine';

// Layer 4: Client-Side Groth16 ZK Prover
export * from './layer4_zk/types';
export * from './layer4_zk/zkEngine';

// Layer 5: Quad-Factor Master Audit Seal
export * from './layer5_seal/types';
export * from './layer5_seal/sealEngine';

// Layer 6: Standalone Enterprise Verifier Portal (THE NEXT STAGE)
export * from './layer6_verifier/types';
export * from './layer6_verifier/verifierEngine';
export * from './layer6_verifier/VerifierPortalView';

// Layer 7: Hardware Attestation (Scaffolded Blank Section)
export * from './layer7_enclave/types';
export * from './layer7_enclave/enclaveEngine';
export * from './layer7_enclave/HardwareEnclaveView';

// Layer 8: Web-to-Desktop Transport Protocol (Scaffolded Blank Section)
export * from './layer8_transport/types';
export * from './layer8_transport/transportEngine';
export * from './layer8_transport/TransportProtocolView';
