import type { ZeroaraRequest, ZeroaraVerificationResult } from '../../integration/protocol';
import { parseZeroaraRequest, encodeRequestParam } from '../../integration/protocol';
import type { DispatchResult, TransportState } from './types';

/**
 * Layer 8 Web-to-Desktop Transport Protocol.
 *
 * Online -> offline: an OS custom-scheme deep link carries the request:
 *   zeroara://verify?request=<base64url(JSON request)>
 * Offline -> online: only the verification result (status, Groth16 proof,
 * master seal, redacted-document hash, optional redacted PDF) is POSTed to
 * the request's callbackUrl, after the user authorises the release.
 */

export const ZEROARA_SCHEME = 'zeroara';

export function buildZeroaraDeepLink(request: ZeroaraRequest): string {
  return `${ZEROARA_SCHEME}://verify?request=${encodeRequestParam(request)}`;
}

/** Accepts zeroara://verify?request=... (base64url or classic base64). */
export function parseZeroaraDeepLink(uri: string): ZeroaraRequest | null {
  try {
    if (!uri.toLowerCase().startsWith(`${ZEROARA_SCHEME}://`)) return null;
    const url = new URL(uri.replace(/^zeroara:\/\//i, 'http://zeroara.invalid/'));
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, '');
    if (host !== 'verify' && !(host === 'zeroara.invalid' && path === '/verify')) return null;
    const param = url.searchParams.get('request');
    if (!param) return null;
    const normalized = param.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const json = new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
    return parseZeroaraRequest(JSON.parse(json));
  } catch {
    return null;
  }
}

export function getTransportState(): TransportState {
  return {
    protocolScheme: 'zeroara://',
    nativeDeepLinks: typeof window !== 'undefined' && !!(window as unknown as { __TAURI__?: unknown }).__TAURI__,
  };
}

/** POST the verification result to the online verifier. Never throws. */
export async function dispatchVerificationResult(callbackUrl: string, result: ZeroaraVerificationResult, timeoutMs = 20000): Promise<DispatchResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(result),
      signal: controller.signal,
      credentials: 'omit',
      mode: 'cors',
    });
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      body = null;
    }
    const ok = res.ok && (body === null || body.ok !== false);
    return {
      ok,
      httpStatus: res.status,
      status: typeof body?.status === 'string' ? (body.status as string) : undefined,
      reasons: Array.isArray(body?.reasons) ? (body!.reasons as string[]) : undefined,
      message: typeof body?.message === 'string' ? (body.message as string) : undefined,
      error: ok ? undefined : typeof body?.error === 'string' ? (body.error as string) : `The verifier answered HTTP ${res.status}.`,
    };
  } catch (err) {
    const e = err as Error;
    return { ok: false, httpStatus: 0, error: e.name === 'AbortError' ? 'The verifier did not answer in time.' : `Could not reach the verifier (${e.message}).` };
  } finally {
    window.clearTimeout(timer);
  }
}
