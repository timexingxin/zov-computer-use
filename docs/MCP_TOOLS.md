# Computer Use MCP Tools Reference

`@zov/mcp-server` (`zov-cua`) exposes **47 standardized tools** (39 primary tools + 8 backward-compatible aliases) through the Model Context Protocol (MCP), with runtime schema validation enforced on `required` fields, enums, finite coordinates, and integer bounds.

---

## Tool Status Classification (macOS)

- **Stable**: Implemented on macOS with runtime schema validation and structured fail-closed error taxonomy.
- **Unsupported**: Intentionally rejected with `UnsupportedPlatformError` (`code: "unsupported_platform"`).

---

## 1. Observation Tools (7 tools)

| Tool | macOS Status | Description | Key Parameters |
| :--- | :---: | :--- | :--- |
| `list_apps` | **Stable** | Lists running regular GUI desktop applications. | `{}` |
| `list_windows` | **Stable** | Lists on-screen Quartz windows (`optionOnScreenOnly`, `is_minimized: false`) across desktop or filtered by app. | `app_ref?: { pid, name, bundle_id }` |
| `get_active_window` | **Stable** | Returns current frontmost on-screen window info. | `{}` |
| `get_app_state` | **Stable** | Accessibility tree snapshot with stable handles (`h_*`) and secret redaction (sets `AXEnhancedUserInterface`/`AXManualAccessibility` so Electron/Chromium/Qt expose AX subtrees). | `app_ref`, `detail?: "compact"\|"diff"\|"full"`, `include_screenshot?: bool` |
| `screenshot` | **Stable** | Captures desktop, 1-based display (`display_id`, matching `displays_detail[].display_index`), or window (`window_id`) PNG; returns physical pixel `width`/`height` plus `scale_factor` and logical `point_width`/`point_height`. | `window_id?: number`, `display_id?: number` |
| `get_screen_info` | **Stable** | Returns display count, main display point/pixel dimensions, scale factor, and per-display `display_index` + `CGDirectDisplayID` + Quartz `bounds`. | `{}` |
| `list_displays` | **Stable** | Alias for `get_screen_info`. | `{}` |

---

## 2. Pointer & Mouse Tools (14 tools)

| Tool | macOS Status | Description | Key Parameters |
| :--- | :---: | :--- | :--- |
| `click` | **Stable** | Clicks semantic element target (`AXPress` first, occlusion-verified fallback) or coordinate target. | `target: Target`, `button?: "left"\|"right"\|"middle"`, `clickCount?: 1..10`, `strategy?: "auto"\|"a11y"\|"event"`, `return_state?: "compact"\|"full"\|"none"` |
| `left_click` | **Stable** | Alias for `click` with optional `app_ref` and `modifiers`. | `target: Target`, `app_ref?: AppRef`, `modifiers?: string\|string[]`, `clickCount?: 1..10`, `strategy?`, `return_state?` |
| `double_click` | **Stable** | Double-clicks element or coordinate (`clickCount=2`). | `target: Target` |
| `triple_click` | **Stable** | Triple-clicks element or coordinate (`clickCount=3`). | `target: Target` |
| `right_click` | **Stable** | Context-menu click (`button="right"`). | `target: Target` |
| `middle_click` | **Stable** | Middle mouse click (`button="middle"`). | `target: Target` |
| `move_pointer` | **Stable** | Moves cursor to Quartz global point coordinates `(x, y)`. | `x: number`, `y: number` |
| `mouse_move` | **Stable** | Alias for `move_pointer`. | `x: number`, `y: number` |
| `scroll` | **Stable** | Scrolls vertically/horizontally at current cursor or optional `target`. | `deltaY?: number`, `deltaX?: number`, `delta?: number`, `direction?: "up"\|"down"\|"left"\|"right"`, `target?: Target` |
| `left_click_drag` | **Stable** | Clicks and drags from `(fromX, fromY)` (or current cursor) to `(toX/x, toY/y)`. | `toX/x: number`, `toY/y: number`, `fromX?: number`, `fromY?: number` |
| `mouse_down` | **Stable** | Presses and holds a mouse button at current cursor (tracked for cleanup on stop/exit). | `button?: "left"\|"right"\|"middle"` |
| `left_mouse_down` | **Stable** | Alias for `mouse_down` (`button="left"`). | `{}` |
| `mouse_up` | **Stable** | Releases a held mouse button at current cursor. | `button?: "left"\|"right"\|"middle"` |
| `left_mouse_up` | **Stable** | Alias for `mouse_up` (`button="left"`). | `{}` |

> **Retina Coordinate Note**: `screenshot` `width`/`height` are physical PNG pixels, whereas `click`, `move_pointer`, and `left_click_drag` use Quartz global **points**. Divide pixel coordinates by `scale_factor` (`Math.round(px / scale_factor)`), and add the window's `bounds.x` / `bounds.y` offset when the screenshot was captured with `window_id`. Note also that `type_text` uses layout-independent Unicode events, whereas `press_key` / `hotkey` map named shortcuts via standard macOS ANSI virtual keycodes.

---

## 3. Text & Keyboard Tools (8 tools)

| Tool | macOS Status | Description | Key Parameters |
| :--- | :---: | :--- | :--- |
| `type_text` | **Stable** | Writes text into an editable element (`setValue` first) or types Unicode characters; fails closed on non-editable element targets. | `text: string`, `target?: Target`, `app_ref?: AppRef`, `clearFirst?: bool`, `strategy?`, `return_state?` |
| `type` | **Stable** | Alias for `type_text`. | `text: string`, `target?: Target`, `app_ref?: AppRef`, `clearFirst?: bool`, `strategy?`, `return_state?` |
| `press_key` | **Stable** | Presses a key or chord (`cmd+g`, `cmd++`, `return`) scoped to background `app_ref` (`postToPid`) or foreground. | `key/text: string`, `modifiers?: string[]`, `repeat?: 0..100`, `app_ref?: AppRef`, `strategy?`, `return_state?` |
| `key` | **Stable** | Alias for `press_key`. | `text/key: string`, `modifiers?: string[]`, `repeat?: 0..100`, `app_ref?: AppRef`, `strategy?`, `return_state?` |
| `hotkey` | **Stable** | Presses simultaneous shortcut array (e.g. `["cmd", "shift", "g"]`). | `keys: string[]`, `app_ref?: AppRef`, `strategy?` |
| `hold_key` | **Stable** | Dispatches key with modifiers (alias path over `press_key`). | `key/text: string`, `modifiers?: string[]`, `app_ref?: AppRef`, `strategy?` |
| `set_value` | **Stable** | Semantically sets `AXValue` on an editable element without keystrokes or value echo in receipts. | `target: ElementTarget`, `value: string`, `return_state?: "compact"\|"full"\|"none"` |
| `select_text` | **Unsupported** | Not implemented; deterministically throws `UnsupportedPlatformError` (`code: "unsupported_platform"`). | `target: ElementTarget`, `start?: number`, `end?: number` |

---

## 4. Window & Application Lifecycle (8 tools)

| Tool | macOS Status | Description | Key Parameters |
| :--- | :---: | :--- | :--- |
| `launch_app` | **Stable** | Launches or activates an application by name or bundle ID (`open -g` when `activate=false`). | `name: string`, `activate?: boolean` |
| `open_application` | **Stable** | Launches/activates by `name`, `bundle_id`, or verified running `pid` (throws `app_not_found` if PID does not exist). | `name?: string`, `bundle_id?: string`, `pid?: number`, `activate?: boolean` |
| `focus_app` | **Stable** | Brings a running application to the foreground. | `app_ref: AppRef` |
| `focus_window` | **Stable** | Raises a specific window by exact `CGWindowID` (throws `window_not_found` if absent). | `window_id: number` |
| `move_window` | **Stable** | Moves a specific window to `(x, y)` points. | `window_id: number`, `x: number`, `y: number` |
| `resize_window` | **Stable** | Resizes a specific window (`width > 10`, `height > 10`). | `window_id: number`, `width: number`, `height: number` |
| `minimize_window` | **Stable** | Minimizes a specific window via `AXMinimized`. | `window_id: number` |
| `maximize_window` | **Stable** | Idempotently zooms/maximizes a window (no-op if already fullscreen or zoomed to visible screen frame). | `window_id: number` |

---

## 5. Semantic & High-Level Helpers (4 tools)

| Tool | macOS Status | Description | Key Parameters |
| :--- | :---: | :--- | :--- |
| `find_element` | **Stable** | Searches compact AX tree by case-insensitive substring `name` and optional exact `role`. | `app_ref: AppRef`, `name: string`, `role?: string` |
| `click_element` | **Stable** | Finds unique matching element by `name` (and optional `role`) and clicks it; rejects ambiguous matches. | `app_ref: AppRef`, `name: string`, `role?: string` |
| `set_element_value` | **Stable** | Finds unique matching element by `name` (and optional `role`) and sets its `AXValue`. | `app_ref: AppRef`, `name: string`, `role?: string`, `value: string` |
| `perform_action` | **Stable** | Triggers a named AX action (`AXPress`, `AXConfirm`, `AXShowMenu`) verified against advertised actions and TOCTOU identity. | `target: ElementTarget`, `action: string` |

---

## 6. Safety, System & Clipboard (6 tools)

| Tool | macOS Status | Description | Key Parameters |
| :--- | :---: | :--- | :--- |
| `request_access` | **Stable** | Strictly read-only permission check (`Accessibility` & `Screen Recording`); never opens System Settings windows. | `types?: ("accessibility"\|"screen_recording")[]` |
| `stop_computer_control` | **Stable** | Session-level kill switch: blocks all subsequent calls (except `get_capabilities`/`wait`/`stop_computer_control`) and releases tracked held inputs. | `{}` |
| `wait` | **Stable** | Pauses execution for `ms` milliseconds (`0..30000`). | `ms?: number` (default 1000) |
| `read_clipboard` | **Stable** | Reads plain text from macOS clipboard (`pbpaste`). | `{}` |
| `write_clipboard` | **Stable** | Writes plain text to macOS clipboard (`pbcopy`) without echoing text in receipt. | `text: string` |
| `get_capabilities` | **Stable** | Returns truthful per-platform capability flags. | `{}` |
