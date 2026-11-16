# Development & Contributing Guide

Thank you for your interest in contributing to `macos-computer-use-kit`!

---

## 1. Prerequisites

- **Node.js**: >= 20.0.0
- **npm** (bundled with Node.js) or **pnpm** >= 10.0.0
- **Operating System**: macOS 13+ (with Xcode Command Line Tools `/usr/bin/swiftc` for building the native `macos-ax-helper`), Windows 11, or modern Linux.

---

## 2. Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/timexingxin/macos-computer-use-kit.git
   cd macos-computer-use-kit
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build all workspace packages (and compile `macos-ax-helper` on macOS):
   ```bash
   npm run build
   ```

4. Run the test suite:
   ```bash
   npm test
   ```

5. Run doctor diagnostics:
   ```bash
   npm run doctor
   ```

---

## 3. Monorepo Organization

- `packages/core`: Pure TypeScript domain logic, types, state compression, secret redaction, stable handles.
- `packages/platform-macos`: Native macOS `ApplicationServices` + `CoreGraphics` Swift helper (`native/macos-ax-helper.swift`) and TypeScript adapter.
- `packages/platform-windows`: Windows UIA adapter (experimental skeleton, fails closed).
- `packages/platform-linux`: Linux AT-SPI2 adapter (experimental skeleton, fails closed).
- `packages/mcp-server`: Serialized JSON-RPC 2.0 stdio MCP server and tool manifest.
- `packages/cli`: `cua` diagnostic CLI tool.
- `skills/`: Production `computer-use-orchestrator` and `zcode-computer-use` skills + `rpc_probe.py`.
