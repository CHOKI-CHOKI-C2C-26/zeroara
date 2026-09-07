import { isTauri } from '../integration/deepLink';

export type Route = 'landing' | 'app';

/** Parameters that mean "boot straight into the app" (SDK, deep links, demo, audit frame). */
const APP_PARAMS = ['request', 'view', 'audit', 'stage', 'phase', 'sample'];

export function currentRoute(): Route {
  if (typeof window === 'undefined') return 'app';
  if (isTauri()) return 'app';
  const params = new URLSearchParams(window.location.search);
  if (APP_PARAMS.some((k) => params.has(k))) return 'app';
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return path === '/' || path === '/index.html' ? 'landing' : 'app';
}

/** Client-side navigation; the root listens to popstate. */
export function navigate(path: string) {
  if (window.location.pathname === path) return;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
