# Troubleshooting & Common Issues

This guide addresses recurring issues, recovery protocols, and diagnostic paths on macOS.

---

## 1. Accessibility Not Granted (`[WARN] Accessibility Permission`)

### Symptoms
`npm run doctor` (or `cua doctor`) reports:
```text
[WARN] Accessibility Permission: Not Granted / Untrusted
```
Or `get_app_state` returns an empty `elements: []` array because `AXIsProcessTrusted()` is `false`.

### Fix
1. Open **System Settings > Privacy & Security > Accessibility**.
2. Locate your host app (Terminal, iTerm2, VS Code, Cursor, Claude, or Antigravity) and toggle it **ON**.
3. If already toggled ON after an app update, toggle it **OFF** and **ON** again so macOS TCC refreshes the code-signing identity.
4. Run `npm run doctor` to verify `[PASS] Accessibility Permission: Granted`.

---

## 2. Missing Native AX Helper (`[FAIL] Native AX Helper`)

### Symptoms
`npm run doctor` reports `[FAIL] Native AX Helper: Missing` or tool calls fail with `Native macOS AX helper binary not found`.

### Fix
1. Install Xcode Command Line Tools if missing: `xcode-select --install`.
2. Rebuild the workspace and runtime: `npm run build` (or re-run `./install.sh`).

---

## 3. Stale Element Handle (`stale_handle`)

### Symptoms
Action fails with `code: "stale_handle"` and `action_sent: false` (because `state_id` expired or the control at `ax_path` changed role/identifier/label between `get_app_state` and action dispatch).

### Recovery
1. Call `get_app_state(app_ref, detail="compact")` once to capture the updated UI tree.
2. Select the fresh `state_id` and element `index` or `handle`.
3. Re-issue the action.

---

## 4. Target Occluded (`foreground_required`) & Window Not Found (`window_not_found`)

- **`foreground_required`**: Returned when a control lacks native `AXPress` (e.g., QtWebEngine) and its screen center is covered by another application's non-click-through window. Either use background keyboard shortcuts (`key` with `app_ref`) or request user authorization to bring the target app forward (`focus_app`).
- **`window_not_found`**: Returned when `focus_window` / `move_window` / `resize_window` / `minimize_window` / `maximize_window` is called with a closed or invalid `window_id`. Call `list_windows` to inspect current window IDs.

---

## 5. Retina Coordinate Offset on Visual Fallback

`screenshot` returns physical PNG pixel dimensions (`width`, `height`) plus `scale_factor` (typically `2` on Retina Macs), while `click` / `move_pointer` expect Quartz global **point** coordinates. Divide pixel positions read from a screenshot by `scale_factor` (`Math.round(px / scale_factor)`), and add the window's `bounds.x` / `bounds.y` offset if the screenshot was window-scoped (`window_id`). For multi-monitor setups, pass `display_id` using the 1-based `displays_detail[].display_index` from `get_screen_info` (rather than the raw `CGDirectDisplayID`).
