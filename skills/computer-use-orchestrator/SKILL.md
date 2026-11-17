---
name: computer-use-orchestrator
description: "Controls native desktop and cross-app tasks with semantic targeting, background-first operation, observed effects, and recovery. Use for macOS GUI, native dialogs, canvas, or mixed web/desktop flows. Pure API/CLI/file tasks do not need this skill."
---

# Computer Use Orchestrator (macOS Background-First GUI Routing)

This skill orchestrates native macOS desktop automation across Model Context Protocol (MCP) Computer Use backends while enforcing strict focus safety, single-writer ownership, and verifiable state transitions.

## 1. Routing Priority

1. **Direct API / MCP / CLI / Filesystem First**: Whenever a task can be completed cleanly via native files, CLI tools, or dedicated APIs, use them instead of GUI automation.
2. **Structured Browser Tools for Web DOM**: Delegate web page navigation, DOM scraping, and web form interaction to structured browser tools (e.g., Playwright MCP or Chrome DevTools MCP). Never operate web pages via blind desktop coordinate clicking when DOM tools exist.
3. **Semantic Accessibility (AX) First for macOS GUI**: Route native macOS desktop tasks to **Zov Computer Use** (`zov-cua`, read `zov-computer-use`). Inspect health and permission readiness first (`request_access` / `list_apps`), without triggering unnecessary permission prompts during read-only checks.
4. **Fallback Backends**: If a specific capability is unavailable in the primary server, fall back to other explicitly configured desktop backends (such as `cua-driver` or `macos-mcp`) according to their live tool schemas.
5. **Visual Coordinate Fallback**: Use window-scoped screenshots and coordinate actions **only** when the Accessibility tree does not expose the target control (e.g., custom canvas or self-drawn widgets). Physical cursor movement, foreground window activation, or global hotkeys require explicit user authorization—never silently steal focus from the user's active window.

## 2. Closed-Loop State Discipline

- **Pin Target Identity**: Establish the exact `app_ref` (`pid`, `bundle_id`, `name`) and `window_id` before dispatching actions. Do not assume the frontmost window belongs to the current task.
- **Re-Observe After Every Mutation**: Respect `state_id` and element handle lifecycles (`h_*`), or pass `return_state="compact"` for single-roundtrip atomic updates. Never chain multiple blind coordinate clicks from stale memory.
- **Verify Real Outcomes**: An `action_receipt` (`ok: true`) only confirms dispatch, not application-level completion. Verify field values, window states, or exported files directly after mutating actions.
- **Targeted Recovery**:
  - `stale_handle` / expired `state_id` → re-observe via `get_app_state` and select a fresh handle.
  - Invalid arguments → check the live MCP tool schema.
  - Permission denied → report the exact macOS Privacy & Security permission needed (`Accessibility` or `Screen Recording`) and stop the GUI branch cleanly.
  - Transient UI/IO delay → wait briefly and re-observe once; never loop across multiple GUI backends blindly.
- **Clean Up Owned Resources Only**: Close or remove only temporary windows/files created by the current task. Never terminate or restart user-owned applications.

## 3. Primary Backend Capability Profile

| Backend | Primary Characteristics & Operational Boundaries |
| --- | --- |
| `zov-cua` (**Zov Computer Use**) | Native Swift `ApplicationServices` + `CoreGraphics` macOS AX MCP server (`@zov/mcp-server`). Uses stable semantic handles (`h_*`), compact/diff tree compression, atomic `return_state="compact"` updates, TOCTOU identity checks, password redaction, and background-safe `click`/`set_value`/`perform_action`. Works on any Mac with Node.js >= 20 and Xcode Command Line Tools (`swiftc`). |

## 4. Single-Writer & Main-Agent Serialization

- **Single Writer per Window**: At any moment, at most one controller/agent may write to a target application or window. Before switching backends, confirm prior action completion and acquire a fresh `state_id` from the new backend. Never pass `state_id`, handles, or raster coordinates across different MCP servers.
- **Main-Agent GUI Ownership**: `zov-cua` enforces a cooperative subagent guard (`_meta["com.zov/request-context"].runtime_scope === "subagent"` → `SUBAGENT_COMPUTER_USE_UNAVAILABLE`). Keep GUI mutations serialized on the main agent; delegate only non-GUI file/research subtasks to subagents. Never strip metadata to bypass runtime guards.

## 5. Safe Background Window Closing

1. Before closing any window, verify task ownership (`app_ref`, `window_id`, document path) and unsaved state; save and verify file output first if modified.
2. When `AXCloseButton` is exposed in the window's AX tree, re-observe the target window and trigger `AXPress` (or `left_click` / `click` with `strategy="a11y"`) on the close button rather than sending background `cmd+w`.
3. After dispatch, call `list_windows` to confirm the target `window_id` has exited while other user windows remain intact. If a save sheet appears, pause and re-observe instead of repeating close commands.

## 6. Kill-Switch & Post-Stop Recovery

- `stop_computer_control` acts as a session-level kill switch, not a temporary window lock release. Once invoked (`"Computer control was stopped ... Start a new session"`), all subsequent calls on the same MCP session (both mutating and observation tools, except `get_capabilities`, `wait`, and `stop_computer_control`) fail closed and tracked held mouse inputs are released.
- Do not loop `request_access` or mutate runtime directories to bypass a stopped session. Resume only in a newly authorized MCP session after confirming prior actions have settled, and never automatically replay the halted action.
