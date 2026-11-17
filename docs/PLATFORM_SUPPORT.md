# Platform Support & Operational Matrix
> **Policy**: **Truthfulness > Tool Count**. No synthetic or unexecuted receipts.

---

## 1. Operating System Status

| Platform & Architecture | Automation Mechanism | Status | Zero Fake-Success Guarantee | Verification Evidence |
| :--- | :--- | :---: | :--- | :--- |
| **macOS (Apple Silicon arm64)** | Native Swift `ApplicationServices` (AX), `CoreGraphics`, `screencapture` | **IMPLEMENTED**; core/CLI/TextEdit paths VERIFIED | Strict fail-closed taxonomy (`stale_handle`, `window_not_found`, `foreground_required`, `timeout`) | Automated unit/stdio/Swift CLI golden suite + local TextEdit GUI E2E. |
| **macOS (Intel x64)** | Native Swift `ApplicationServices` (AX), `CoreGraphics`, `screencapture` | **IMPLEMENTED** | Same compiled Swift source (`xcode-select --install`) | CI build and unit/golden tests; physical Intel GUI E2E not separately recorded. |
| **Windows (x64)** | Fail-closed skeleton (no PowerShell execution) | **EXPERIMENTAL SKELETON** | Every GUI/app tool throws `UnsupportedPlatformError` (`request_access` returns `{false, false}`) | Verified fail-closed in `red-team-adversarial.test.mjs` and `audit-regression.test.mjs`. |
| **Linux (X11 / Wayland)** | Fail-closed skeleton | **EXPERIMENTAL SKELETON** | Every GUI/app tool throws `UnsupportedPlatformError` (`request_access` returns `{false, false}`) | Verified fail-closed on Ubuntu CI. |

See [`docs/CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md) for the complete breakdown across all **47 tools**.

---

## 2. macOS Build & Permission Prerequisites

1. **Xcode Command Line Tools** (`xcode-select --install`): Required during `./install.sh` / `npm run build` to compile `macos-ax-helper` via `/usr/bin/swiftc` and run `rpc_probe.py` via `python3`. At runtime, `cua doctor` and `request_access` execute the pre-compiled `macos-ax-helper permissions` binary directly (`AXIsProcessTrusted` + `CGPreflightScreenCaptureAccess`) without invoking `/usr/bin/swift` or Apple Events.
2. **Accessibility Permission** (**System Settings > Privacy & Security > Accessibility**): Required to inspect application AX trees and dispatch actions.
3. **Screen Recording Permission** (**System Settings > Privacy & Security > Screen Recording**): Required for window/display `screenshot` capture.
