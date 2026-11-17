# Development & Contributing Guide

Thank you for your interest in contributing to **Zov Computer Use** (`zov-computer-use`)!

---

## 1. Prerequisites

- **Node.js**: >= 20.0.0
- **npm** (bundled with Node.js) or **pnpm** >= 10.0.0
- **Operating System**: macOS 13+ (with Xcode Command Line Tools `/usr/bin/swiftc` for building the native `macos-ax-helper`), Windows 11, or modern Linux.

---

## 2. Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/timexingxin/zov-computer-use.git
   cd zov-computer-use
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build all workspace packages (and compile `macos-ax-helper` on macOS):
   ```bash
   npm run build
   ```

4. Run lint, typecheck, and the test suite:
   ```bash
   npm run lint
   npm run typecheck
   npm test
   ```

5. Run doctor diagnostics:
   ```bash
   npm run doctor
   ```

---

## 3. Monorepo Organization

- `packages/core` (`@zov/core`): Pure TypeScript domain logic, types, state compression, secret redaction, stable handles.
- `packages/platform-macos` (`@zov/platform-macos`): Native macOS `ApplicationServices` + `CoreGraphics` Swift helper (`native/macos-ax-helper.swift`) and TypeScript adapter.
- `packages/platform-windows` (`@zov/platform-windows`): Windows adapter skeleton (fails closed with `UnsupportedPlatformError`).
- `packages/platform-linux` (`@zov/platform-linux`): Linux adapter skeleton (fails closed with `UnsupportedPlatformError`).
- `packages/mcp-server` (`@zov/mcp-server`): Serialized JSON-RPC 2.0 stdio MCP server (`zov-cua`) and 47-tool schema validator.
- `packages/cli` (`@zov/cli`): `cua` / `zov-cua` diagnostic CLI tool.
- `skills/`: Production `computer-use-orchestrator` and `zov-computer-use` skills + `rpc_probe.py`.
