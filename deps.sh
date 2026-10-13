#!/usr/bin/env bash
# Restores dependencies removed on 2026-10-13 to free disk space.
set -euo pipefail
cd "$(dirname "$0")"

# dist was build output; regenerate with your normal build command if needed

(cd . && npm ci)

# src-tauri/target is Rust build output; rebuilt on next build. Prefetch crates:
(cd src-tauri && cargo fetch)
