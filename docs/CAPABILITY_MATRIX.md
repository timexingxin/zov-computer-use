# Platform Capability & Tool Support Matrix
> **Version**: `1.0.0`  
> **Policy**: **Truthfulness > Tool Count**. No fake success or unexecuted stubs.

This matrix documents the actual runtime support level for all **47 MCP tools** (39 primary tools + 8 aliases) exposed by `@zov/mcp-server` (`zov-cua`).

## Support Levels
- **VERIFIED (OS)**: Behavior asserted on macOS by an automated test that exercises the real OS helper or GUI (`rpc_probe.py`, `cli-doctor.test.mjs`, Swift CLI golden tests in `audit-regression.test.mjs`, or opt-in `gui-e2e-textedit.test.mjs`).
- **VERIFIED (Protocol/Core)**: Pure in-memory/protocol behavior (capabilities, schema validation, redaction, ambiguity/stale-handle guards, kill-switch, `wait`) asserted by automated unit/adversarial tests.
- **IMPLEMENTED**: Implemented in `MacOSAdapter` + `macos-ax-helper.swift` with schema/mock coverage; physical OS side effects require interactive `test:e2e:real` or manual session verification.
- **SKELETON (Fails Closed)**: Throws `UnsupportedPlatformError` (`code: "unsupported_platform"`, `action_sent: false`) deterministically with zero OS command execution.
- **UNSUPPORTED**: Intentionally rejected on all platforms with `UnsupportedPlatformError`.

---

## Tool-by-Tool Matrix (All 47 Tools)

| # | Tool Name (+ Aliases) | macOS (Darwin) | Windows (Win32) | Linux | Automated Coverage | Native Mechanism |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `get_capabilities` | **VERIFIED (Protocol)** | **VERIFIED (Protocol)** | **VERIFIED (Protocol)** | `red-team-adversarial.test.mjs` | Capability registry |
| 2 | `list_apps` | **VERIFIED (OS)** | SKELETON | SKELETON | `installer-and-skills.test.mjs` (`rpc_probe.py`) | `NSWorkspace.runningApplications` |
| 3 | `list_windows` | **IMPLEMENTED** | SKELETON | SKELETON | `mcp-protocol.test.mjs` (mock) | `CGWindowListCopyWindowInfo` |
| 4 | `get_active_window` | **IMPLEMENTED** | SKELETON | SKELETON | `mcp-protocol.test.mjs` (mock) | Frontmost layer-0 `CGWindow` |
| 5 | `get_app_state` | **VERIFIED (OS)** | SKELETON | SKELETON | `gui-e2e-textedit.test.mjs`, `audit-regression.test.mjs` | `ApplicationServices` AX walk (depth 20, 8s cap) |
| 6 | `screenshot` | **IMPLEMENTED** | SKELETON | SKELETON | `red-team-adversarial.test.mjs` (Win fail-closed) | `/usr/sbin/screencapture` + PNG IHDR + `scale_factor` |
| 7 | `get_screen_info` (`list_displays`) | **VERIFIED (OS)** | SKELETON | SKELETON | `cli-doctor.test.mjs` | `CGMainDisplayID` + `NSScreen` |
| 8 | `click` (`left_click`) | **IMPLEMENTED** | SKELETON | SKELETON | `red-team-adversarial.test.mjs`, `audit-regression.test.mjs` | `AXPress` -> occlusion-checked `CGEvent` |
| 9 | `double_click` | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (schema) | `CGEvent` (`clickState=2`) |
| 10 | `triple_click` | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (schema) | `CGEvent` (`clickState=3`) |
| 11 | `right_click` | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (schema) | `CGEvent` (`rightMouseDown/Up`) |
| 12 | `middle_click` | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (schema) | `CGEvent` (`otherMouseDown/Up`) |
| 13 | `move_pointer` (`mouse_move`) | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (NaN/missing guard) | `CGEvent` (`mouseMoved`) |
| 14 | `scroll` | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (target & bounds guard) | `CGEvent` (`scrollWheelEvent2Source`) |
| 15 | `left_click_drag` | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (coord guard) | `CGEvent` (`Dragged` sequence) |
| 16 | `mouse_down` (`left_mouse_down`) | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (held-input release) | `CGEvent` + held-button tracker |
| 17 | `mouse_up` (`left_mouse_up`) | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (held-input release) | `CGEvent` |
| 18 | `type_text` (`type`) | **VERIFIED (OS)** | SKELETON | SKELETON | `gui-e2e-textedit.test.mjs`, `audit-regression.test.mjs` | `AXValue` / Unicode `CGEvent` |
| 19 | `press_key` (`key`) | **VERIFIED (OS)** | SKELETON | SKELETON | `gui-e2e-textedit.test.mjs`, `audit-regression.test.mjs` (Swift `--dry-run`) | `CGEvent` (`postToPid` / HID tap) |
| 20 | `hotkey` | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (chord parser) | `CGEvent` chord |
| 21 | `hold_key` | **IMPLEMENTED** | SKELETON | SKELETON | `red-team-adversarial.test.mjs` (manifest) | `CGEvent` key + modifiers |
| 22 | `set_value` | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (redacted receipt & `return_state`) | `AXUIElementSetAttributeValue` |
| 23 | `select_text` | **UNSUPPORTED** | **UNSUPPORTED** | **UNSUPPORTED** | `red-team-adversarial.test.mjs` | Throws `UnsupportedPlatformError` |
| 24 | `launch_app` (`open_application`) | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (PID existence & Win C3) | `/usr/bin/open` + `NSWorkspace` poll |
| 25 | `focus_app` | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (Win C3 fail-closed) | `NSRunningApplication.activate()` |
| 26 | `focus_window` | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (`window_not_found`) | Exact `CGWindowID` + `AXRaise` |
| 27 | `move_window` | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (`window_not_found`) | Exact `CGWindowID` + `AXPosition` |
| 28 | `resize_window` | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (`window_not_found`) | Exact `CGWindowID` + `AXSize` |
| 29 | `minimize_window` | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (`window_not_found`) | Exact `CGWindowID` + `AXMinimized` |
| 30 | `maximize_window` | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (`window_not_found`) | Idempotent `AXFullScreen`/`AXZoomButton` |
| 31 | `find_element` | **VERIFIED (Core)** | SKELETON | SKELETON | `audit-regression.test.mjs` / `core-handles-reducer.test.mjs` | Compact tree substring + role search |
| 32 | `click_element` | **VERIFIED (Core)** | SKELETON | SKELETON | `audit-regression.test.mjs` (role filter + ambiguity) | Compact tree resolve + `click` |
| 33 | `set_element_value` | **VERIFIED (Core)** | SKELETON | SKELETON | `audit-regression.test.mjs` (role filter + ambiguity) | Compact tree resolve + `setValue` |
| 34 | `perform_action` | **IMPLEMENTED** | SKELETON | SKELETON | `audit-regression.test.mjs` (TOCTOU args) | `AXUIElementPerformAction` |
| 35 | `request_access` | **VERIFIED (OS)** | **VERIFIED (Read-Only)** | **VERIFIED (Read-Only)** | `cli-doctor.test.mjs`, `audit-regression.test.mjs` | Darwin: `AXIsProcessTrusted` + `CGPreflightScreenCaptureAccess`; Win/Linux: returns `{accessibility:false, screen_recording:false}` |
| 36 | `stop_computer_control` | **VERIFIED (Protocol)** | **VERIFIED (Protocol)** | **VERIFIED (Protocol)** | `red-team-adversarial.test.mjs`, `audit-regression.test.mjs` | Session halt latch + held-input release |
| 37 | `wait` | **VERIFIED (Protocol)** | **VERIFIED (Protocol)** | **VERIFIED (Protocol)** | `audit-regression.test.mjs` (`0..30000ms` clamp) | Bounded `setTimeout` |
| 38 | `read_clipboard` | **VERIFIED (OS)** | SKELETON | SKELETON | `gui-e2e-textedit.test.mjs` | `/usr/bin/pbpaste` |
| 39 | `write_clipboard` | **VERIFIED (OS)** | SKELETON | SKELETON | `gui-e2e-textedit.test.mjs` | `/usr/bin/pbcopy` |

---

## Test Validation Matrix

| Test Suite | Execution Environment | Verification Scope | Target Platforms | Command |
| :--- | :--- | :--- | :--- | :--- |
| **Unit, Protocol, Stdio, Swift CLI Golden & Adversarial** | Headless CI & Local Terminal (Zero GUI Input Events) | Handle generation, occurrence-aware diffing, secret redaction across `return_state`, timeout `action_sent=true`, Windows C3 fail-closed, Swift `--dry-run` chord/shift/NaN/window-id guards, stdio FIFO & 2 MiB framing, installer fault injection | Ubuntu (x64), macOS (arm64/x64) | `npm test` |
| **CLI Environment Doctor** | Interactive or CLI Session | Node.js >= 20, compiled `macos-ax-helper` binary presence, Accessibility & Screen Recording permissions, `WindowServer`, CoreGraphics display, and 47-tool manifest | macOS, Linux | `npm run doctor` |
| **Real GUI E2E Test** (`gui-e2e-textedit`) | Opt-in Interactive Aqua Session | Temporary file open, AX tree capture, Unicode typing, Command-S save, byte verification, clipboard roundtrip | macOS physical GUI session | `npm run test:e2e:real` |
