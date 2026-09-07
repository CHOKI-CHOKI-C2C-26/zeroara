import type { ZeroaraRequest } from './protocol';
import { parseZeroaraDeepLink } from '../layers/layer8_transport/transportEngine';

/* Receives `zeroara://verify?request=...` from the OS when running inside the
 * Tauri desktop shell. Uses the deep-link plugin's global API
 * (window.__TAURI__.deepLink, available with app.withGlobalTauri = true), so
 * the web build needs no extra dependency and simply does nothing here. */

interface TauriDeepLinkApi {
  getCurrent: () => Promise<string[] | null>;
  onOpenUrl: (cb: (urls: string[]) => void) => Promise<() => void>;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

export function installDeepLinkListener(onRequest: (req: ZeroaraRequest, rawUrl: string) => void): () => void {
  const api = (window as unknown as { __TAURI__?: { deepLink?: TauriDeepLinkApi } }).__TAURI__?.deepLink;
  if (!api) return () => {};

  const handle = (urls: string[] | null) => {
    for (const url of urls ?? []) {
      const req = parseZeroaraDeepLink(url);
      if (req) {
        onRequest(req, url);
        return;
      }
    }
  };

  // The URL the app was launched with (cold start)…
  api.getCurrent().then(handle).catch(() => {});
  // …and URLs delivered while it is running.
  let unlisten: (() => void) | null = null;
  api.onOpenUrl(handle).then((fn) => (unlisten = fn)).catch(() => {});
  return () => unlisten?.();
}
