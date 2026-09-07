import type { ZeroaraRequest } from '../../integration/protocol';

/** Wire request carried by `zeroara://verify?request=<base64url JSON>`. */
export type VerificationRequestPayload = ZeroaraRequest;

export interface TransportState {
  protocolScheme: 'zeroara://';
  /** True when running inside the Tauri desktop shell (deep links are delivered by the OS). */
  nativeDeepLinks: boolean;
}

export interface DispatchResult {
  ok: boolean;
  httpStatus: number;
  /** Verifier's own status for the session, when it answered with JSON. */
  status?: string;
  reasons?: string[];
  message?: string;
  error?: string;
}
