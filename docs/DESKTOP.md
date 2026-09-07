# Zeroara desktop app: `zeroara://` deep links

The Tauri shell in `src-tauri/` runs the same web app fully offline and receives verification requests from the OS as custom-scheme links:

```
zeroara://verify?request=<base64url(JSON request)>
```

## What is configured

| File | Change |
| --- | --- |
| `src-tauri/Cargo.toml` | `tauri-plugin-deep-link = "2"`, `tauri-plugin-single-instance` with the `deep-link` feature. |
| `src-tauri/src/lib.rs` | Registers both plugins; focuses the existing window when a second instance is launched with a link; registers the scheme at runtime for dev builds on Windows/Linux. |
| `src-tauri/tauri.conf.json` | `plugins.deep-link.desktop.schemes = ["zeroara"]`, `app.withGlobalTauri = true` so the webview can use `window.__TAURI__.deepLink`. |
| `src-tauri/capabilities/default.json` | `deep-link:default` permission. |
| `src/integration/deepLink.ts` | Reads the launch URL (`getCurrent`) and later URLs (`onOpenUrl`), parses them with `parseZeroaraDeepLink`, and hands the request to the app, which boots straight into the request flow. |

## Build and test

```sh
# Rust toolchain + Tauri prerequisites: https://tauri.app/start/prerequisites/
npm install
npm run tauri dev       # dev build; on Windows/Linux the scheme is registered at runtime
npm run tauri build     # installable bundle; macOS registers the scheme from the bundle's Info.plist
```

macOS only delivers custom-scheme links to **bundled** apps (`.app` from `tauri build`), not to `tauri dev`. Windows and Linux work in dev after the runtime registration.

Test from a terminal once the app is installed:

```sh
# macOS
open 'zeroara://verify?request=eyJ2ZXJzaW9uIjoxLCJyZXF1ZXN0SWQiOiJyZXFfdGVzdDAxIiwicmVxdWVzdGVyIjoiVGVzdCIsImRvY3VtZW50IjoiYWFkaGFhciIsImNsYWltIjp7Im9wIjoiPj0iLCJ2YWx1ZSI6MTh9LCJub25jZSI6IjB4YWJjZGVmMDEyMzQ1Njc4OSJ9'
# Linux
xdg-open 'zeroara://verify?request=...'
# Windows (PowerShell)
Start-Process 'zeroara://verify?request=...'
```

The request payload and the result payload the app sends to `callbackUrl` are specified in `docs/INTEGRATION.md`.

## Not yet verified here

The Rust side was written against the Tauri v2 plugin APIs but has not been compiled in this environment (no Rust toolchain was available). Run `npm run tauri dev` once and fix any plugin API drift before shipping.
