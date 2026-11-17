# Code Provenance & Clean-Room Attributions (`docs/PROVENANCE.md`)

Every file and module in `zov-computer-use` adheres to strict open-source provenance standards. Proprietary binaries, extracted app bundles, and decompiled code are strictly excluded.

---

## 1. Provenance Classification Matrix

Each module in this repository is categorized under the following classification:
- **A**: Original first-party source code authored for this repository
- **B**: Permissively licensed dependency (retaining original copyright / `NOTICE`)
- **C**: Clean-room implementation based on public protocol/OS specifications
- **D**: Proprietary / closed-source (strictly excluded from this repository)
- **E**: Pre-compiled binary artifact (strictly excluded from Git; compiled locally from Swift source during build)

| Subsystem / Module | Provenance Class | Origin & Legal Justification |
| :--- | :---: | :--- |
| `packages/core` (`@zov/core`) | **A** | Original TypeScript implementation of stable handles, occurrence-aware state diffing, password redaction, and error taxonomy. |
| `packages/platform-macos` (`@zov/platform-macos`) | **A / C** | Clean-room Swift source (`native/macos-ax-helper.swift`, compiled locally via `/usr/bin/swiftc`) using public Apple `ApplicationServices` (`HIServices`), `CoreGraphics`, `AppKit`, and `/usr/sbin/screencapture`. Zero binary artifacts committed to Git. |
| `packages/platform-windows` (`@zov/platform-windows`) | **A** | Fail-closed TypeScript adapter skeleton (`UnsupportedPlatformError`). |
| `packages/platform-linux` (`@zov/platform-linux`) | **A** | Fail-closed TypeScript adapter skeleton (`UnsupportedPlatformError`). |
| `packages/mcp-server` (`@zov/mcp-server`) | **A / C** | Original TypeScript JSON-RPC 2.0 `stdio` MCP server and 47-tool schema validator implementing the public Model Context Protocol specification. |
| `packages/cli` (`@zov/cli`) | **A** | Original diagnostic CLI (`doctor`, `mcp`, `list-apps`, `screenshot`). |
| `skills/computer-use-orchestrator/SKILL.md` | **A** | Original macOS background-first GUI orchestration skill. |
| `skills/zov-computer-use/SKILL.md` & `scripts/rpc_probe.py` | **A / C** | Original execution skill and Python 3.9+ stdlib-only read-only MCP stdio verifier. |

---

## 2. Clean-Room Methodology

1. **Independent Implementation**: All code in `packages/*`, `skills/*`, and `scripts/*` is authored from scratch using standard Node.js/Python/Swift APIs and public OS interfaces.
2. **Exclusion of Proprietary Artifacts**: Zero closed-source helper app bundles or third-party bundled scripts are included in this repository.
3. **Open Specifications Used**:
   - Model Context Protocol (MCP) Specification (JSON-RPC 2.0).
   - Apple macOS Accessibility (`ApplicationServices` / `HIServices`) and `CoreGraphics` Quartz Event Services.
