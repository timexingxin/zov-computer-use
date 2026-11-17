#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "[error] Node.js (>= 20.0.0) is required. Install it via https://nodejs.org or 'brew install node'." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[error] Node.js >= 20.0.0 is required (found $(node -v))." >&2
  exit 1
fi

IS_UNINSTALL=0
for arg in "$@"; do
  if [ "$arg" = "--uninstall" ] || [ "$arg" = "--help" ] || [ "$arg" = "-h" ]; then
    IS_UNINSTALL=1
  fi
done

if [ "$IS_UNINSTALL" -eq 0 ] && [ "$(uname -s)" = "Darwin" ]; then
  if ! /usr/bin/xcode-select -p >/dev/null 2>&1; then
    echo "[error] Xcode Command Line Tools (swiftc + python3) are required on macOS. Run 'xcode-select --install' first." >&2
    exit 1
  fi
fi

# Install TypeScript compiler devDependencies if not yet installed
if [ ! -f "$ROOT_DIR/node_modules/typescript/bin/tsc" ] && [ ! -f "$ROOT_DIR/node_modules/.pnpm/node_modules/typescript/bin/tsc" ]; then
  echo "[setup] Installing build dependencies..."
  if [ -f "$ROOT_DIR/pnpm-lock.yaml" ] && command -v pnpm >/dev/null 2>&1; then
    pnpm install --frozen-lockfile
  else
    npm install --no-audit --no-fund
  fi
fi

if [ "$IS_UNINSTALL" -eq 0 ]; then
  node "$ROOT_DIR/scripts/build-all.mjs"
fi

exec node "$ROOT_DIR/scripts/install.mjs" "$@"
