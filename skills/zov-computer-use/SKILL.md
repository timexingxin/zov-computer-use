---
name: zov-computer-use
description: Concrete implementation and tool reference for the Zov Computer Use (zov-cua) native macOS desktop MCP backend. For high-level cross-app routing, read computer-use-orchestrator as well.
---

# Zov Computer Use (macOS Desktop MCP Skill)

Main agent owns GUI writes by default. Keep desktop GUI calls serialized on the main agent; delegate only non-GUI document or code analysis to subagents.

This skill operates **Zov Computer Use** (`zov-cua`, powered by `@zov/mcp-server` + compiled native Swift `macos-ax-helper`), providing zero-proprietary-dependency, zero-focus-steal macOS desktop automation.

## 1. Routing Boundary (STRICT)

**DO use for:**
- Finder and native filesystem dialogs
- System Settings / System Preferences
- Native macOS desktop applications (Notes, Calendar, Calculator, Mail, TextEdit, Preview, Anki, etc.)
- Native file pickers and Open/Save panels (`⌘⇧G`)
- Desktop UI controls, toolbars, sheets, and menus

**DO NOT use for:**
- Web page DOM interaction, scraping, or web form filling (use Playwright / Chrome DevTools MCP instead)
- Browser URL navigation when structured browser tools are available
- Pure CLI, API, or local file tasks

---

## 2. Core Loop: Observe → Act → Verify

Observe once, act once, then verify.

1. **Check Readiness**: If permission status is unknown, call `request_access` once (strictly read-only).
2. **Resolve or Launch App**: `list_apps` lists currently running regular GUI applications. If the target app is not running, call `open_application` (or `launch_app`) once with the exact application name or bundle identifier (e.g., `{"name": "Calculator"}` or `{"name": "日历"}`).
3. **Observe Semantic State**: Call `get_app_state` starting with the accessibility tree (`detail="compact"`, without a screenshot).
4. **Evaluate App State Quality**:
   - **GOOD STATE**: Contains actionable elements (`pressable` for native background `AXPress`, `clickable` for bounds-verified controls such as QtWebEngine that lack native `AXPress`, `editable`, `has_menu`), clear labels, and window bounds. Proceed with semantic element actions (`left_click` / `click`, `set_value`, `perform_action`).
   - **DEGRADED STATE**: Tree contains only root window/container nodes without interactive children (e.g., custom canvas or loading splash). Request `screenshot` (`include_screenshot=true`) for visual coordinate fallback, or check whether a modal dialog is intercepting input.
   - **FAILED STATE**: `isError: true` or IPC failure. Read the structured error code (`permission_denied`, `stale_handle`, `ambiguous_element`, `window_not_found`, `foreground_required`, `timeout`) and execute targeted recovery.
5. **Atomic State Return**: When dispatching mutating element actions (`left_click` / `click`, `set_value`, `type`, `key`), pass `return_state="compact"` to receive a refreshed compact state in a single roundtrip.
6. **Visual Coordinate Fallback**: Request a window screenshot and use a coordinate target **only** when the accessibility tree cannot locate or express the target.
7. **Transient Timeout Handling**: Heavy system panes (e.g., System Settings storage calculation) may take several seconds to respond to AX queries. On a read timeout (`action_sent: false`), wait 500ms and re-observe once before reporting failure.

Do not run both the accessibility and visual workflows for the same action. Do not focus or raise an application window merely to perform a semantic AX action.

### Read-Only vs. Mutating Actions & Destructive Action Guard

- **Read-Only**: `list_apps`, `list_windows`, `get_active_window`, `get_app_state`, `screenshot`, `list_displays` / `get_screen_info`, `read_clipboard`, `request_access`, `get_capabilities`.
- **Mutating**: `left_click` / `click`, `double_click`, `triple_click`, `right_click`, `middle_click`, `set_value`, `type` / `type_text`, `key` / `press_key`, `hotkey`, `hold_key`, `perform_action`, `write_clipboard`.
- **Destructive Action Guard**: Irreversible operations (deleting files, overwriting user documents, sending external messages, submitting forms, changing system credentials) MUST NOT be triggered from blind coordinate inference. Confirm window identity, semantic element role + label, user authorization, and post-action state.

If `request_access` reports `Accessibility` or `Screen Recording` as denied, instruct the user to grant permission in **macOS System Settings → Privacy & Security** for their host terminal/IDE, then pause the GUI branch cleanly.

---

## 3. Target Contract

Two target formats are supported:

- **Semantic Element Target (Preferred)**:
  - `{"type": "element", "state_id": "<state_id>", "index": <index>}` (also accepts `"handle": "<h_...>"`).
- **Coordinate Target (Visual Fallback Only)**:
  - `{"type": "coordinate", "x": <x>, "y": <y>}`

Rules:
- Always prefer an element target when the observed AX tree contains the control.
- Never translate image pixel coordinates into an element target.
- **Retina Pixel-to-Point Conversion**: On macOS, `screenshot` returns physical PNG pixel dimensions (`width`, `height`) alongside `scale_factor` (typically `2` on Retina) and logical `point_width` / `point_height`, whereas `click` / `move_pointer` operate in Quartz global **point** coordinates. Divide pixel coordinates read from a screenshot raster by `scale_factor` (`x = Math.round(px_x / scale_factor)`, `y = Math.round(px_y / scale_factor)`), and add the window's `bounds.x` / `bounds.y` offset if the screenshot was window-scoped (`window_id`).

## 4. Action Strategy & Focus Safety

- `strategy="a11y"` enforces pure accessibility dispatch and fails closed without moving the physical cursor or stealing window focus.
- `strategy="auto"` (default) attempts semantic AX dispatch first on element targets and falls back to occlusion-verified `click-coord` on controls without native `AXPress`.
- `strategy="event"` forces raw synthetic event dispatch when explicitly required for custom non-AX views.

### macOS Open / Save File Panels (`⌘⇧G`)

When automating native `NSOpenPanel` / `NSSavePanel` path selection and foreground activation is authorized for the task:
1. Observe the panel and record its `pid`, `bundle_id`, and `window_id`.
2. Activate the target app/panel if background keystrokes are ignored by AppKit (`open_application` with `activate=true`).
3. Send `⌘⇧G` (`hotkey` `["cmd", "shift", "g"]` or `key` with `modifiers: ["cmd", "shift"]`), re-observe the newly attached Go-to-Folder sheet, set or type the target path, and confirm with `Return`.

## 5. Text, Keyboard & `app_ref` Object Contract

- Prefer `set_value` on editable fields—it writes directly via AX without keystroke injection or focus changes.
- Always pass `app_ref` as a **JSON object**, never as a `"pid:1234"` string:
  - Example: `{"pid": 12345, "bundle_id": "com.apple.calculator"}` or `{"name": "Calculator"}`.

## 6. Retry Safety & Kill Switch

- When an error reports `action_sent: true` (including `code: "timeout"` on any mutating click, key, or typing tool), partial or full GUI input may already have been delivered to the OS—**never blindly replay the action**; always call `get_app_state` first to verify what already took effect.
- Only when `action_sent: false` (e.g., `stale_handle`, `element_not_found`, `invalid_argument`, `foreground_required`) has zero OS input been sent; re-observe with `get_app_state` to obtain a fresh `state_id` or resolve occlusion before retrying.
- Call `stop_computer_control` to halt automation immediately in any unexpected state. Once stopped, all subsequent calls on the session (except `get_capabilities`, `wait`, and `stop_computer_control`) fail closed and tracked held mouse buttons are released; start a new MCP session before resuming future authorized tasks.

## 7. Tool Surface Summary (47 Tools)

- **Observe**: `list_apps`, `open_application` (`launch_app`), `list_windows`, `get_active_window`, `get_app_state`, `screenshot`, `list_displays` (`get_screen_info`)
- **Pointer**: `left_click` (`click`), `double_click`, `triple_click`, `right_click`, `middle_click`, `scroll`, `mouse_move` (`move_pointer`), `left_click_drag`, `mouse_down` (`left_mouse_down`), `mouse_up` (`left_mouse_up`)
- **Text & Keyboard**: `set_value`, `type` (`type_text`), `key` (`press_key`), `hotkey`, `hold_key`
- **Semantic**: `perform_action`, `find_element`, `click_element`, `set_element_value`
- **Runtime & Safety**: `request_access`, `stop_computer_control`, `wait`, `read_clipboard`, `write_clipboard`, `get_capabilities`

Always treat the live MCP `tools/list` schema as authoritative for exact parameter fields.

## 8. Read-Only Protocol & Guard Probe

Run `python3 skills/zov-computer-use/scripts/rpc_probe.py --guard` (Python 3.9+ standard library only) to verify MCP stdio handshake, tool manifest registration, native macOS `list_apps` readiness, subagent metadata refusal (`SUBAGENT_COMPUTER_USE_UNAVAILABLE`), and zero-orphan process group teardown without performing any GUI writes.
