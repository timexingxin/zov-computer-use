import ApplicationServices
import Cocoa
import CoreGraphics
import Darwin
import Foundation

// Weak runtime lookup for _AXUIElementGetWindow so future macOS changes never cause a dyld launch failure.
typealias AXGetWindowFn = @convention(c) (AXUIElement, UnsafeMutablePointer<CGWindowID>) -> AXError
let axGetWindowSymbol: AXGetWindowFn? = {
    let rtldDefault = UnsafeMutableRawPointer(bitPattern: -2)
    guard let sym = dlsym(rtldDefault, "_AXUIElementGetWindow") else { return nil }
    return unsafeBitCast(sym, to: AXGetWindowFn.self)
}()

func getAXWindowID(_ element: AXUIElement) -> Int? {
    guard let fn = axGetWindowSymbol else { return nil }
    var wid: CGWindowID = 0
    if fn(element, &wid) == .success, wid != 0 {
        return Int(wid)
    }
    return nil
}

struct RectOut: Codable {
    let x: Int
    let y: Int
    let width: Int
    let height: Int
}

struct AppOut: Codable {
    let pid: Int32
    let name: String
    let bundle_id: String?
    let active: Bool
    let windows_count: Int?
}

struct WindowOut: Codable {
    let id: Int
    let pid: Int32
    let title: String
    let app_name: String
    let bundle_id: String?
    let bounds: RectOut
    let is_minimized: Bool
    let is_focused: Bool
}

struct ElementOut: Codable {
    let role: String
    let subrole: String?
    let identifier: String?
    let name: String
    let description: String?
    let value: String?
    let bounds: RectOut?
    let enabled: Bool
    let focused: Bool
    let capabilities: [String]
    let actions: [String]
    let ax_path: [Int]
    let children: [ElementOut]?
}

struct InspectOut: Codable {
    let app: AppOut
    let active_window: WindowOut?
    let elements: [ElementOut]
}

func failJSON(_ message: String, code: String = "operation_failed", extra: [String: Any] = [:]) -> Never {
    var payload: [String: Any] = [
        "ok": false,
        "error": message,
        "code": code,
    ]
    for (k, v) in extra { payload[k] = v }
    if let data = try? JSONSerialization.data(withJSONObject: payload),
       let str = String(data: data, encoding: .utf8) {
        FileHandle.standardOutput.write((str + "\n").data(using: .utf8)!)
    }
    exit(1)
}

func emitJSON<T: Encodable>(_ value: T) -> Never {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(value), let str = String(data: data, encoding: .utf8) else {
        failJSON("Failed to serialize JSON response", code: "operation_failed")
    }
    FileHandle.standardOutput.write((str + "\n").data(using: .utf8)!)
    exit(0)
}

func emitDict(_ dict: [String: Any]) -> Never {
    guard JSONSerialization.isValidJSONObject(dict),
          let data = try? JSONSerialization.data(withJSONObject: dict)
    else {
        failJSON("Failed to serialize JSON dictionary", code: "operation_failed")
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    exit(0)
}

func strAttr(_ el: AXUIElement, _ attr: String) -> String? {
    var ref: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &ref) == .success, let val = ref else {
        return nil
    }
    if let s = val as? String { return s }
    if let n = val as? NSNumber { return n.stringValue }
    return nil
}

func boolAttr(_ el: AXUIElement, _ attr: String, default defVal: Bool) -> Bool {
    var ref: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &ref) == .success, let val = ref else {
        return defVal
    }
    if let b = val as? Bool { return b }
    if let n = val as? NSNumber { return n.boolValue }
    return defVal
}

func boundsAttr(_ el: AXUIElement) -> RectOut? {
    var posRef: CFTypeRef?
    var sizeRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &posRef) == .success,
          AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &sizeRef) == .success,
          let pVal = posRef, let sVal = sizeRef,
          CFGetTypeID(pVal) == AXValueGetTypeID(),
          CFGetTypeID(sVal) == AXValueGetTypeID()
    else {
        return nil
    }
    var pt = CGPoint.zero
    var sz = CGSize.zero
    AXValueGetValue(pVal as! AXValue, .cgPoint, &pt)
    AXValueGetValue(sVal as! AXValue, .cgSize, &sz)
    if !pt.x.isFinite || !pt.y.isFinite || !sz.width.isFinite || !sz.height.isFinite {
        return nil
    }
    if abs(pt.x) > 200_000 || abs(pt.y) > 200_000 || abs(sz.width) > 200_000 || abs(sz.height) > 200_000 {
        return nil
    }
    return RectOut(
        x: Int(pt.x.rounded()),
        y: Int(pt.y.rounded()),
        width: Int(sz.width.rounded()),
        height: Int(sz.height.rounded())
    )
}

func actionNames(_ el: AXUIElement) -> [String] {
    var arr: CFArray?
    if AXUIElementCopyActionNames(el, &arr) == .success, let list = arr as? [String] {
        return list
    }
    return []
}

let passwordKeywordRegex = try! NSRegularExpression(
    pattern: "(\\b(password|passcode|passwd|pin\\s*code)\\b|密码|口令)",
    options: [.caseInsensitive]
)

func isPasswordField(role: String, subrole: String?, name: String, desc: String, identifier: String?) -> Bool {
    if role == "securetextfield" || subrole == "securetextfield" {
        return true
    }
    if ["textfield", "textarea", "combobox", "searchfield"].contains(role) {
        let combined = "\(name) \(desc) \(identifier ?? "")"
        let range = NSRange(combined.startIndex..<combined.endIndex, in: combined)
        if passwordKeywordRegex.firstMatch(in: combined, options: [], range: range) != nil {
            return true
        }
    }
    return false
}

func synthesizeElementName(el: AXUIElement, role: String, subrole: String?, precomputedChildTexts: [String]? = nil) -> String {
    let title = (strAttr(el, kAXTitleAttribute as String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if !title.isEmpty { return title }

    let val = strAttr(el, kAXValueAttribute as String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if (role == "statictext" || role == "heading"), !val.isEmpty {
        return val
    }

    if ["button", "link", "menuitem", "tab", "checkbox", "radiobutton"].contains(role) {
        let childTexts: [String]
        if let pre = precomputedChildTexts {
            childTexts = pre
        } else {
            var collected: [String] = []
            var chRef: CFTypeRef?
            if AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &chRef) == .success,
               let chList = chRef as? [AXUIElement] {
                for c in chList {
                    let cRole = (strAttr(c, kAXRoleAttribute as String) ?? "").replacingOccurrences(of: "^AX", with: "", options: .regularExpression).lowercased()
                    if cRole == "statictext" {
                        let ct = (strAttr(c, kAXTitleAttribute as String) ?? strAttr(c, kAXValueAttribute as String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                        if !ct.isEmpty { collected.append(ct) }
                    }
                }
            }
            childTexts = collected
        }
        let joined = childTexts.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        if !joined.isEmpty { return joined }

        let desc = (strAttr(el, kAXDescriptionAttribute as String) ?? strAttr(el, kAXHelpAttribute as String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !desc.isEmpty { return desc }

        if subrole == "closebutton" { return "Close" }
        if subrole == "minimizebutton" { return "Minimize" }
        if subrole == "fullscreenbutton" || subrole == "zoombutton" { return "Zoom" }
    }
    return ""
}

func listRegularApps() -> [AppOut] {
    var out: [AppOut] = []
    for app in NSWorkspace.shared.runningApplications {
        guard app.activationPolicy == .regular, app.processIdentifier > 0 else { continue }
        let name = app.localizedName ?? app.bundleURL?.deletingPathExtension().lastPathComponent ?? "Unknown"
        out.append(AppOut(
            pid: app.processIdentifier,
            name: name,
            bundle_id: app.bundleIdentifier,
            active: app.isActive,
            windows_count: nil
        ))
    }
    return out
}

func listCGWindows(filterPid: Int32? = nil) -> [WindowOut] {
    let bundleByPid: [Int32: String] = Dictionary(
        uniqueKeysWithValues: NSWorkspace.shared.runningApplications.compactMap { app in
            guard let bid = app.bundleIdentifier else { return nil }
            return (app.processIdentifier, bid)
        }
    )
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let info = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
        return []
    }
    var out: [WindowOut] = []
    var sawFrontWindow = false
    for item in info {
        let layer = (item[kCGWindowLayer as String] as? Int) ?? 0
        if layer != 0 { continue }
        guard let pidNum = item[kCGWindowOwnerPID as String] as? NSNumber else { continue }
        let pid = pidNum.int32Value
        if let fp = filterPid, pid != fp {
            if !sawFrontWindow { sawFrontWindow = true }
            continue
        }
        let wid = (item[kCGWindowNumber as String] as? NSNumber)?.intValue ?? 0
        let owner = (item[kCGWindowOwnerName as String] as? String) ?? ""
        let title = (item[kCGWindowName as String] as? String) ?? ""
        var rect = RectOut(x: 0, y: 0, width: 0, height: 0)
        if let b = item[kCGWindowBounds as String] as? [String: Any] {
            let x = (b["X"] as? NSNumber)?.doubleValue ?? 0
            let y = (b["Y"] as? NSNumber)?.doubleValue ?? 0
            let w = (b["Width"] as? NSNumber)?.doubleValue ?? 0
            let h = (b["Height"] as? NSNumber)?.doubleValue ?? 0
            if x.isFinite && y.isFinite && w.isFinite && h.isFinite {
                rect = RectOut(x: Int(x.rounded()), y: Int(y.rounded()), width: Int(w.rounded()), height: Int(h.rounded()))
            }
        }
        if rect.width <= 10 || rect.height <= 10 { continue }
        let isFocused = !sawFrontWindow
        sawFrontWindow = true
        out.append(WindowOut(
            id: wid,
            pid: pid,
            title: title,
            app_name: owner,
            bundle_id: bundleByPid[pid],
            bounds: rect,
            is_minimized: false,
            is_focused: isFocused
        ))
    }
    return out
}

func inspectApp(pid: Int32, windowId: Int?, maxDepth: Int, maxNodes: Int) -> InspectOut {
    let apps = listRegularApps()
    guard let appInfo = apps.first(where: { $0.pid == pid }) else {
        failJSON("Application not found for pid \(pid)", code: "app_not_found")
    }

    let deadline = CFAbsoluteTimeGetCurrent() + 8.0
    let axApp = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(axApp, 1.2)
    _ = AXUIElementSetAttributeValue(axApp, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    _ = AXUIElementSetAttributeValue(axApp, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)

    var winsRef: CFTypeRef?
    var axWindows: [AXUIElement] = []
    if AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &winsRef) == .success,
       let wList = winsRef as? [AXUIElement] {
        axWindows = wList
    }

    var visitedCount = 0

    func walk(_ el: AXUIElement, depth: Int, path: [Int]) -> ElementOut? {
        if depth > maxDepth || visitedCount >= maxNodes || CFAbsoluteTimeGetCurrent() > deadline {
            return nil
        }
        visitedCount += 1

        let rawRole = strAttr(el, kAXRoleAttribute as String) ?? "AXUnknown"
        let role = rawRole.replacingOccurrences(of: "^AX", with: "", options: .regularExpression).lowercased()
        let rawSubrole = strAttr(el, kAXSubroleAttribute as String)
        let subrole = rawSubrole?.replacingOccurrences(of: "^AX", with: "", options: .regularExpression).lowercased()
        let identifier = strAttr(el, kAXIdentifierAttribute as String) ?? strAttr(el, "AXDOMIdentifier")
        let desc = strAttr(el, kAXDescriptionAttribute as String) ?? strAttr(el, kAXHelpAttribute as String) ?? ""
        let rawVal = strAttr(el, kAXValueAttribute as String)

        let bounds = boundsAttr(el)
        let enabled = boolAttr(el, kAXEnabledAttribute as String, default: true)
        let focused = boolAttr(el, kAXFocusedAttribute as String, default: false)
        let acts = actionNames(el)

        var childrenOut: [ElementOut] = []
        if depth < maxDepth && visitedCount < maxNodes && CFAbsoluteTimeGetCurrent() <= deadline {
            var chRef: CFTypeRef?
            if AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &chRef) == .success,
               let chList = chRef as? [AXUIElement] {
                for (idx, child) in chList.enumerated() {
                    if visitedCount >= maxNodes || CFAbsoluteTimeGetCurrent() > deadline { break }
                    if let cNode = walk(child, depth: depth + 1, path: path + [idx]) {
                        childrenOut.append(cNode)
                    }
                }
            }
        }

        let childStaticTexts = childrenOut.filter { $0.role == "statictext" && !$0.name.isEmpty }.map { $0.name }
        let name = synthesizeElementName(el: el, role: role, subrole: subrole, precomputedChildTexts: childStaticTexts)
        let isSecure = isPasswordField(role: role, subrole: subrole, name: name, desc: desc, identifier: identifier)
        let val = isSecure ? ((rawVal?.isEmpty == false) ? "[REDACTED_PASSWORD]" : rawVal) : rawVal

        var caps: [String] = []
        let hasNativePress = acts.contains("AXPress") || acts.contains("press")
        let hasValidBounds = (bounds?.width ?? 0) > 0 && (bounds?.height ?? 0) > 0
        let isClickableRole = ["button", "link", "menuitem", "popupbutton", "checkbox", "radiobutton", "tab"].contains(role)

        if hasNativePress {
            caps.append("pressable")
        } else if enabled && hasValidBounds && isClickableRole {
            caps.append("clickable")
        }
        if acts.contains("AXConfirm") {
            caps.append("confirmable")
        }
        if acts.contains("AXShowMenu") {
            caps.append("has_menu")
        }
        if ["textfield", "textarea", "combobox", "searchfield", "securetextfield"].contains(role) {
            caps.append("editable")
        }
        if ["checkbox", "radiobutton", "switch"].contains(role) {
            caps.append("checkable")
        }

        let cleanDesc = desc.trimmingCharacters(in: .whitespacesAndNewlines)
        return ElementOut(
            role: role,
            subrole: (subrole?.isEmpty == false) ? subrole : nil,
            identifier: (identifier?.isEmpty == false) ? identifier : nil,
            name: name,
            description: (!cleanDesc.isEmpty && cleanDesc != name) ? cleanDesc : nil,
            value: val,
            bounds: bounds,
            enabled: enabled,
            focused: focused,
            capabilities: caps,
            actions: acts,
            ax_path: path,
            children: childrenOut.isEmpty ? nil : childrenOut
        )
    }

    var roots: [ElementOut] = []
    for (wIdx, w) in axWindows.enumerated() {
        if let targetWid = windowId {
            if let cgWid = getAXWindowID(w), cgWid != targetWid {
                continue
            }
        }
        if let node = walk(w, depth: 0, path: [wIdx]) {
            roots.append(node)
        }
    }

    let cgWins = listCGWindows(filterPid: pid)
    let activeWin = windowId != nil ? cgWins.first(where: { $0.id == windowId }) ?? cgWins.first : cgWins.first

    return InspectOut(
        app: AppOut(
            pid: appInfo.pid,
            name: appInfo.name,
            bundle_id: appInfo.bundle_id,
            active: appInfo.active,
            windows_count: axWindows.count
        ),
        active_window: activeWin,
        elements: roots
    )
}

func resolveByPath(axApp: AXUIElement, path: [Int]) -> AXUIElement? {
    guard !path.isEmpty else { return nil }
    var winsRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &winsRef) == .success,
          let wins = winsRef as? [AXUIElement],
          path[0] >= 0 && path[0] < wins.count
    else {
        return nil
    }
    var current = wins[path[0]]
    for idx in path.dropFirst() {
        var chRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(current, kAXChildrenAttribute as CFString, &chRef) == .success,
              let ch = chRef as? [AXUIElement],
              idx >= 0 && idx < ch.count
        else {
            return nil
        }
        current = ch[idx]
    }
    return current
}

func topWindowAtPoint(x: Double, y: Double) -> (pid: Int32, owner: String, windowId: Int)? {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let info = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
        return nil
    }
    for item in info {
        let layer = (item[kCGWindowLayer as String] as? Int) ?? 0
        if layer != 0 { continue }
        let alpha = (item[kCGWindowAlpha as String] as? Double) ?? 1.0
        if alpha <= 0.01 { continue }
        guard let b = item[kCGWindowBounds as String] as? [String: Any] else { continue }
        let bx = (b["X"] as? NSNumber)?.doubleValue ?? 0
        let by = (b["Y"] as? NSNumber)?.doubleValue ?? 0
        let bw = (b["Width"] as? NSNumber)?.doubleValue ?? 0
        let bh = (b["Height"] as? NSNumber)?.doubleValue ?? 0
        if bw <= 2 || bh <= 2 { continue }
        if x >= bx && x <= bx + bw && y >= by && y <= by + bh {
            let pid = (item[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0
            let owner = (item[kCGWindowOwnerName as String] as? String) ?? "Unknown"
            let wid = (item[kCGWindowNumber as String] as? NSNumber)?.intValue ?? 0
            return (pid, owner, wid)
        }
    }
    return nil
}

func axHitTestMatchesPid(x: Double, y: Double, expectedPid: Int32) -> Bool {
    let sysWide = AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(sysWide, 0.4)
    var hitEl: AXUIElement?
    guard AXUIElementCopyElementAtPosition(sysWide, Float(x), Float(y), &hitEl) == .success,
          let elem = hitEl
    else {
        return false
    }
    var hitPid: pid_t = 0
    if AXUIElementGetPid(elem, &hitPid) == .success {
        return hitPid == expectedPid
    }
    return false
}

let KEY_CODES: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
    "1": 18, "!": 18, "2": 19, "@": 19, "3": 20, "#": 20, "4": 21, "$": 21,
    "6": 22, "^": 22, "5": 23, "%": 23, "=": 24, "+": 24, "9": 25, "(": 25,
    "7": 26, "&": 26, "-": 27, "_": 27, "8": 28, "*": 28, "0": 29, ")": 29,
    "]": 30, "}": 30, "o": 31, "u": 32, "[": 33, "{": 33, "i": 34, "p": 35,
    "return": 36, "enter": 36, "l": 37, "j": 38, "'": 39, "\"": 39, "k": 40,
    ";": 41, ":": 41, "\\": 42, "|": 42, ",": 43, "<": 43, "/": 44, "?": 44,
    "n": 45, "m": 46, ".": 47, ">": 47, "tab": 48, "space": 49, " ": 49,
    "`": 50, "~": 50, "backspace": 51, "delete": 51, "escape": 53, "esc": 53,
    "forwarddelete": 117, "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
    "left": 123, "arrowleft": 123, "right": 124, "arrowright": 124,
    "down": 125, "arrowdown": 125, "up": 126, "arrowup": 126,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
    "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111
]

func modifierFlags(from mods: [String]) -> CGEventFlags {
    var flags = CGEventFlags()
    for m in mods {
        switch m.lowercased().trimmingCharacters(in: .whitespacesAndNewlines) {
        case "cmd", "command", "meta", "super":
            flags.insert(.maskCommand)
        case "ctrl", "control":
            flags.insert(.maskControl)
        case "alt", "option", "opt":
            flags.insert(.maskAlternate)
        case "shift":
            flags.insert(.maskShift)
        default:
            break
        }
    }
    return flags
}

func parseCoord(_ raw: String?, name: String) -> Double {
    guard let s = raw, let v = Double(s), v.isFinite, abs(v) <= 100_000 else {
        failJSON("Invalid or non-finite coordinate for \(name): '\(raw ?? "")'", code: "invalid_argument")
    }
    return v
}

// Sequential CLI flag parser so values starting with "--" are never misidentified as flags.
let rawArgs = Array(CommandLine.arguments.dropFirst())
guard let subcmd = rawArgs.first else {
    failJSON("Missing subcommand", code: "invalid_argument")
}

var flagMap: [String: String] = [:]
var idx = 1
while idx < rawArgs.count {
    let key = rawArgs[idx]
    if key.hasPrefix("--"), idx + 1 < rawArgs.count {
        flagMap[key] = rawArgs[idx + 1]
        idx += 2
    } else {
        idx += 1
    }
}

func argVal(_ flag: String) -> String? {
    return flagMap[flag]
}

switch subcmd {
case "permissions":
    emitDict([
        "accessibility": AXIsProcessTrusted(),
        "screen_recording": CGPreflightScreenCaptureAccess(),
    ])

case "list-apps":
    emitJSON(listRegularApps())

case "list-windows":
    let pid = argVal("--pid").flatMap { Int32($0) }
    emitJSON(listCGWindows(filterPid: pid))

case "inspect":
    guard let pidStr = argVal("--pid"), let pid = Int32(pidStr), pid > 0 else {
        failJSON("Missing or invalid --pid", code: "invalid_argument")
    }
    let wid = argVal("--window-id").flatMap { Int($0) }
    let maxDepth = min(30, max(1, argVal("--max-depth").flatMap { Int($0) } ?? 20))
    let maxNodes = min(10_000, max(50, argVal("--max-nodes").flatMap { Int($0) } ?? 3000))
    emitJSON(inspectApp(pid: pid, windowId: wid, maxDepth: maxDepth, maxNodes: maxNodes))

case "act-element":
    guard let pidStr = argVal("--pid"), let pid = Int32(pidStr), pid > 0,
          let pathJson = argVal("--path"),
          let pathData = pathJson.data(using: .utf8),
          let path = try? JSONDecoder().decode([Int].self, from: pathData),
          let action = argVal("--action")
    else {
        failJSON("Missing --pid, --path, or --action", code: "invalid_argument")
    }
    let expectedRole = argVal("--expected-role")?.lowercased()
    let expectedIdent = argVal("--expected-identifier")
    let expectedName = argVal("--expected-name")

    let axApp = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(axApp, 2.0)

    guard let el = resolveByPath(axApp: axApp, path: path) else {
        failJSON("Element no longer exists at observed AX path; re-observe with get_app_state", code: "stale_handle")
    }

    let actualRawRole = strAttr(el, kAXRoleAttribute as String) ?? ""
    let actualRole = actualRawRole.replacingOccurrences(of: "^AX", with: "", options: .regularExpression).lowercased()
    let actualSubrole = strAttr(el, kAXSubroleAttribute as String)?.replacingOccurrences(of: "^AX", with: "", options: .regularExpression).lowercased()

    if let exp = expectedRole, !exp.isEmpty, actualRole != exp {
        failJSON("Element role changed at AX path (expected \(exp), got \(actualRole)); re-observe state", code: "stale_handle")
    }

    // Secondary TOCTOU identity check: prevent acting on shifted sibling controls
    if let expId = expectedIdent, !expId.isEmpty {
        let actualId = strAttr(el, kAXIdentifierAttribute as String) ?? strAttr(el, "AXDOMIdentifier") ?? ""
        if actualId != expId {
            failJSON("Element identifier changed at AX path (expected '\(expId)', got '\(actualId)'); re-observe state", code: "stale_handle")
        }
    } else if let expName = expectedName, !expName.isEmpty {
        let actualName = synthesizeElementName(el: el, role: actualRole, subrole: actualSubrole)
        if actualName != expName {
            failJSON("Element label changed at AX path (expected '\(expName)', got '\(actualName)'); re-observe state", code: "stale_handle")
        }
    }

    if action == "setValue" {
        let value = argVal("--value") ?? ""
        let err = AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, value as CFTypeRef)
        if err == .success {
            emitDict(["ok": true, "ax_error": 0])
        } else {
            failJSON("AXUIElementSetAttributeValue failed with AXError \(err.rawValue)", code: "not_settable", extra: ["ax_error": err.rawValue])
        }
    } else {
        let axAction = action.hasPrefix("AX") ? action : (action == "press" ? "AXPress" : action)
        let acts = actionNames(el)
        if !acts.contains(axAction) {
            failJSON(
                "Element does not advertise '\(axAction)' (advertised actions: \(acts))",
                code: "action_unavailable",
                extra: ["advertised_actions": acts]
            )
        }
        let err = AXUIElementPerformAction(el, axAction as CFString)
        if err == .success {
            emitDict(["ok": true, "ax_error": 0, "performed": axAction])
        } else {
            failJSON(
                "AX action '\(axAction)' returned AXError \(err.rawValue) (advertised actions: \(acts))",
                code: "action_unavailable",
                extra: ["ax_error": err.rawValue, "advertised_actions": acts]
            )
        }
    }

case "click-coord":
    let x = parseCoord(argVal("--x"), name: "--x")
    let y = parseCoord(argVal("--y"), name: "--y")
    let button = argVal("--button") ?? "left"
    guard ["left", "right", "middle"].contains(button) else {
        failJSON("Invalid mouse button: '\(button)'", code: "invalid_argument")
    }
    let count: Int64
    if let cs = argVal("--count") {
        guard let parsed = Int64(cs), parsed >= 1, parsed <= 10 else {
            failJSON("clickCount must be an integer between 1 and 10", code: "invalid_argument")
        }
        count = parsed
    } else {
        count = 1
    }

    let modsCsv = argVal("--modifiers") ?? ""
    let mods = modsCsv.isEmpty ? [] : modsCsv.split(separator: ",").map(String.init)
    let requirePid = argVal("--require-pid").flatMap { Int32($0) }
    let restoreCursor = argVal("--restore-cursor") == "1"

    let allowOverlay = argVal("--allow-overlay") == "1"
    if let expectedPid = requirePid, !allowOverlay {
        if let top = topWindowAtPoint(x: x, y: y), top.pid != expectedPid {
            // Secondary AX hit-test disambiguates click-through transparent overlays (ignoresMouseEvents)
            if !axHitTestMatchesPid(x: x, y: y, expectedPid: expectedPid) {
                failJSON(
                    "Target point (\(Int(x.rounded())), \(Int(y.rounded()))) is occluded by '\(top.owner)' (pid=\(top.pid), window_id=\(top.windowId)). Authorize focus_app / open_application(activate=true) or use background key(app_ref=...) instead.",
                    code: "foreground_required",
                    extra: ["covering_pid": top.pid, "covering_app": top.owner, "covering_window_id": top.windowId]
                )
            }
        }
    }

    let origPos = CGEvent(source: nil)?.location
    let pt = CGPoint(x: x, y: y)
    let src = CGEventSource(stateID: .hidSystemState)
    let (downType, upType, cgBtn): (CGEventType, CGEventType, CGMouseButton) = {
        switch button {
        case "right": return (.rightMouseDown, .rightMouseUp, .right)
        case "middle": return (.otherMouseDown, .otherMouseUp, .center)
        default: return (.leftMouseDown, .leftMouseUp, .left)
        }
    }()

    let flags = modifierFlags(from: mods)
    for clickIdx in 1...count {
        if let down = CGEvent(mouseEventSource: src, mouseType: downType, mouseCursorPosition: pt, mouseButton: cgBtn),
           let up = CGEvent(mouseEventSource: src, mouseType: upType, mouseCursorPosition: pt, mouseButton: cgBtn) {
            if !flags.isEmpty {
                down.flags = flags
                up.flags = flags
            }
            down.setIntegerValueField(.mouseEventClickState, value: clickIdx)
            up.setIntegerValueField(.mouseEventClickState, value: clickIdx)
            down.post(tap: .cghidEventTap)
            usleep(12_000)
            up.post(tap: .cghidEventTap)
            if clickIdx < count { usleep(25_000) }
        }
    }

    if restoreCursor, let orig = origPos {
        usleep(15_000)
        if let moveBack = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: orig, mouseButton: .left) {
            moveBack.post(tap: .cghidEventTap)
        }
    }

    emitDict(["ok": true, "x": Int(x.rounded()), "y": Int(y.rounded())])

case "key":
    guard let rawKey = argVal("--key"), !rawKey.isEmpty else {
        failJSON("Missing --key", code: "invalid_argument")
    }
    let modsCsv = argVal("--modifiers") ?? ""
    var mods = modsCsv.isEmpty ? [] : modsCsv.split(separator: ",").map(String.init)
    var mainKey = rawKey

    // Parse chord syntax safely (including "cmd++" -> cmd & "+", while rejecting "cmd+" or "+a")
    if rawKey != "+" && rawKey.contains("+") {
        if rawKey.hasSuffix("++") {
            let prefix = String(rawKey.dropLast(2))
            if prefix.isEmpty {
                failJSON("Malformed key chord: '\(rawKey)'", code: "invalid_argument")
            }
            let modParts = prefix.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
            if modParts.contains(where: { $0.isEmpty }) {
                failJSON("Malformed key chord: '\(rawKey)'", code: "invalid_argument")
            }
            mods.append(contentsOf: modParts)
            mainKey = "+"
        } else {
            let parts = rawKey.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
            if parts.contains(where: { $0.isEmpty }) || parts.count < 2 {
                failJSON("Malformed key chord: '\(rawKey)'", code: "invalid_argument")
            }
            mods.append(contentsOf: parts.dropLast())
            mainKey = parts.last!
        }
    }

    let lower = mainKey.lowercased()
    let hasCmdOrCtrl = mods.contains {
        ["cmd", "command", "meta", "super", "ctrl", "control"].contains($0.lowercased().trimmingCharacters(in: .whitespaces))
    }

    if ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+", "{", "}", "|", ":", "\"", "<", ">", "?", "~"].contains(mainKey) {
        if !mods.contains(where: { $0.lowercased() == "shift" }) {
            mods.append("shift")
        }
    } else if !hasCmdOrCtrl, mainKey.count == 1, mainKey != lower, mainKey.uppercased() == mainKey {
        // Only auto-add shift for standalone uppercase letters, never for cmd+G / ctrl+C shortcuts
        if !mods.contains(where: { $0.lowercased() == "shift" }) {
            mods.append("shift")
        }
    }

    let repeatCount: Int
    if let rs = argVal("--repeat") {
        guard let parsed = Int(rs), parsed >= 1, parsed <= 100 else {
            failJSON("repeat must be an integer between 1 and 100", code: "invalid_argument")
        }
        repeatCount = parsed
    } else {
        repeatCount = 1
    }

    let normalizedMods = mods.map { $0.lowercased().trimmingCharacters(in: .whitespaces) }
    if argVal("--dry-run") == "1" {
        emitDict([
            "ok": true,
            "dry_run": true,
            "key": lower,
            "key_code": KEY_CODES[lower].map { Int($0) } as Any,
            "modifiers": normalizedMods,
            "repeat": repeatCount,
        ])
    }

    let targetPid = argVal("--pid").flatMap { Int32($0) }
    let flags = modifierFlags(from: mods)
    let src = CGEventSource(stateID: .privateState)

    if let keyCode = KEY_CODES[lower] {
        for _ in 0..<repeatCount {
            guard let down = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: true),
                  let up = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: false)
            else {
                failJSON("Failed to allocate CGEvent for key '\(mainKey)'")
            }
            if !flags.isEmpty {
                down.flags = flags
                up.flags = flags
            }
            if let pid = targetPid {
                down.postToPid(pid)
                usleep(8_000)
                up.postToPid(pid)
            } else {
                down.post(tap: .cghidEventTap)
                usleep(8_000)
                up.post(tap: .cghidEventTap)
            }
            if repeatCount > 1 { usleep(15_000) }
        }
    } else {
        let utf16 = Array(mainKey.utf16)
        for _ in 0..<repeatCount {
            guard let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false)
            else {
                failJSON("Failed to allocate Unicode CGEvent")
            }
            down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            if !flags.isEmpty {
                down.flags = flags
                up.flags = flags
            }
            if let pid = targetPid {
                down.postToPid(pid)
                usleep(8_000)
                up.postToPid(pid)
            } else {
                down.post(tap: .cghidEventTap)
                usleep(8_000)
                up.post(tap: .cghidEventTap)
            }
        }
    }

    emitDict(["ok": true, "key": lower, "scoped_pid": targetPid as Any])

case "type-unicode":
    guard let rawText = argVal("--text") else {
        failJSON("Missing --text", code: "invalid_argument")
    }
    let text = rawText.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    let targetPid = argVal("--pid").flatMap { Int32($0) }
    let src = CGEventSource(stateID: .privateState)
    for scalar in text {
        let s = String(scalar)
        if s == "\n" {
            if let down = CGEvent(keyboardEventSource: src, virtualKey: 36, keyDown: true),
               let up = CGEvent(keyboardEventSource: src, virtualKey: 36, keyDown: false) {
                if let pid = targetPid {
                    down.postToPid(pid)
                    up.postToPid(pid)
                } else {
                    down.post(tap: .cghidEventTap)
                    up.post(tap: .cghidEventTap)
                }
            }
            usleep(6_000)
            continue
        }
        let utf16 = Array(s.utf16)
        if let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true),
           let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false) {
            down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            if let pid = targetPid {
                down.postToPid(pid)
                up.postToPid(pid)
            } else {
                down.post(tap: .cghidEventTap)
                up.post(tap: .cghidEventTap)
            }
        }
        usleep(4_000)
    }
    emitDict(["ok": true, "length": text.count, "scoped_pid": targetPid as Any])

case "screen-info":
    let mainDisp = CGMainDisplayID()
    let w = CGDisplayPixelsWide(mainDisp)
    let h = CGDisplayPixelsHigh(mainDisp)
    let matchingScreen = NSScreen.screens.first { scr in
        (scr.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == mainDisp
    } ?? NSScreen.main
    let scale = Double(matchingScreen?.backingScaleFactor ?? 2.0)
    let primaryHeight: CGFloat = NSScreen.screens.first?.frame.height ?? CGFloat(h)

    let displaysDetail: [[String: Any]] = NSScreen.screens.map { scr in
        let did = (scr.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
        let f = scr.frame
        // Convert AppKit bottom-left origin to Quartz global top-left point space
        let qY = primaryHeight - (f.origin.y + f.size.height)
        let s = Double(scr.backingScaleFactor)
        return [
            "id": Int(did),
            "is_main": did == mainDisp,
            "bounds": [
                "x": Int(f.origin.x.rounded()),
                "y": Int(qY.rounded()),
                "width": Int(f.size.width.rounded()),
                "height": Int(f.size.height.rounded()),
            ],
            "scale": s,
        ]
    }

    var dispCount: UInt32 = 0
    CGGetActiveDisplayList(0, nil, &dispCount)
    emitDict([
        "displays": max(1, Int(dispCount)),
        "main_display": [
            "width": w,
            "height": h,
            "scale": scale,
            "pixel_width": Int((Double(w) * scale).rounded()),
            "pixel_height": Int((Double(h) * scale).rounded()),
        ],
        "displays_detail": displaysDetail,
        "platform": "darwin",
    ])

case "focus-app":
    guard let pidStr = argVal("--pid"), let pid = Int32(pidStr),
          let rApp = NSRunningApplication(processIdentifier: pid)
    else {
        emitDict(["ok": false])
    }
    let ok = rApp.activate()
    emitDict(["ok": ok])

case "window-op":
    guard let op = argVal("--op"),
          let widStr = argVal("--window-id"), let targetWid = Int(widStr), targetWid > 0
    else {
        failJSON("Valid positive --window-id and --op are required", code: "window_not_found")
    }

    var candidatePids: [Int32] = []
    if let pStr = argVal("--pid"), let p = Int32(pStr), p > 0 {
        candidatePids.append(p)
    }
    if let cgMatch = listCGWindows().first(where: { $0.id == targetWid }), !candidatePids.contains(cgMatch.pid) {
        candidatePids.append(cgMatch.pid)
    }
    if candidatePids.isEmpty {
        // Also search regular apps for minimized windows, strictly matching exact CGWindowID only
        candidatePids = listRegularApps().map { $0.pid }
    }

    var foundWin: AXUIElement?
    var foundPid: Int32 = 0
    outerLoop: for pid in candidatePids {
        let axApp = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(axApp, 1.0)
        var winsRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &winsRef) == .success,
           let wins = winsRef as? [AXUIElement] {
            for w in wins {
                if getAXWindowID(w) == targetWid {
                    foundWin = w
                    foundPid = pid
                    break outerLoop
                }
            }
        }
    }

    guard let winEl = foundWin else {
        failJSON("Window not found: \(targetWid)", code: "window_not_found")
    }

    var success = false
    switch op {
    case "focus":
        _ = NSRunningApplication(processIdentifier: foundPid)?.activate()
        success = AXUIElementPerformAction(winEl, kAXRaiseAction as CFString) == .success
    case "move":
        let x = parseCoord(argVal("--x"), name: "--x")
        let y = parseCoord(argVal("--y"), name: "--y")
        var pt = CGPoint(x: x, y: y)
        if let axVal = AXValueCreate(.cgPoint, &pt) {
            success = AXUIElementSetAttributeValue(winEl, kAXPositionAttribute as CFString, axVal) == .success
        }
    case "resize":
        let w = parseCoord(argVal("--width"), name: "--width")
        let h = parseCoord(argVal("--height"), name: "--height")
        guard w > 10 && h > 10 else {
            failJSON("Window width and height must be > 10", code: "invalid_argument")
        }
        var sz = CGSize(width: w, height: h)
        if let axVal = AXValueCreate(.cgSize, &sz) {
            success = AXUIElementSetAttributeValue(winEl, kAXSizeAttribute as CFString, axVal) == .success
        }
    case "minimize":
        success = AXUIElementSetAttributeValue(winEl, kAXMinimizedAttribute as CFString, kCFBooleanTrue) == .success
    case "maximize":
        if boolAttr(winEl, "AXFullScreen", default: false) {
            success = true
        } else if let curBounds = boundsAttr(winEl),
                  let vis = NSScreen.main?.visibleFrame,
                  abs(Double(curBounds.width) - Double(vis.width)) <= 4 && abs(Double(curBounds.height) - Double(vis.height)) <= 4 {
            // Already zoomed to visible screen frame; keep idempotent instead of toggling back down
            success = true
        } else {
            var btnRef: CFTypeRef?
            if AXUIElementCopyAttributeValue(winEl, kAXZoomButtonAttribute as CFString, &btnRef) == .success, let btn = btnRef {
                success = AXUIElementPerformAction(btn as! AXUIElement, kAXPressAction as CFString) == .success
            } else if AXUIElementCopyAttributeValue(winEl, kAXFullScreenButtonAttribute as CFString, &btnRef) == .success, let btn = btnRef {
                success = AXUIElementPerformAction(btn as! AXUIElement, kAXPressAction as CFString) == .success
            }
        }
    default:
        failJSON("Unknown window op: \(op)", code: "invalid_argument")
    }

    emitDict(["ok": success])

case "pointer-op":
    guard let op = argVal("--op") else {
        failJSON("Missing --op", code: "invalid_argument")
    }
    let src = CGEventSource(stateID: .hidSystemState)
    let curPos = CGEvent(source: nil)?.location ?? .zero
    let button = argVal("--button") ?? "left"
    guard ["left", "right", "middle"].contains(button) else {
        failJSON("Invalid button: '\(button)'", code: "invalid_argument")
    }
    let (downType, upType, dragType, cgBtn): (CGEventType, CGEventType, CGEventType, CGMouseButton) = {
        switch button {
        case "right": return (.rightMouseDown, .rightMouseUp, .rightMouseDragged, .right)
        case "middle": return (.otherMouseDown, .otherMouseUp, .otherMouseDragged, .center)
        default: return (.leftMouseDown, .leftMouseUp, .leftMouseDragged, .left)
        }
    }()

    switch op {
    case "move":
        let x = parseCoord(argVal("--x"), name: "--x")
        let y = parseCoord(argVal("--y"), name: "--y")
        if let ev = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left) {
            ev.post(tap: .cghidEventTap)
        }
    case "down":
        if let ev = CGEvent(mouseEventSource: src, mouseType: downType, mouseCursorPosition: curPos, mouseButton: cgBtn) {
            ev.post(tap: .cghidEventTap)
        }
    case "up":
        if let ev = CGEvent(mouseEventSource: src, mouseType: upType, mouseCursorPosition: curPos, mouseButton: cgBtn) {
            ev.post(tap: .cghidEventTap)
        }
    case "drag":
        let tx = parseCoord(argVal("--to-x"), name: "--to-x")
        let ty = parseCoord(argVal("--to-y"), name: "--to-y")
        let startPt: CGPoint = {
            if argVal("--from-x") != nil || argVal("--from-y") != nil {
                let fx = parseCoord(argVal("--from-x"), name: "--from-x")
                let fy = parseCoord(argVal("--from-y"), name: "--from-y")
                return CGPoint(x: fx, y: fy)
            }
            return curPos
        }()
        let endPt = CGPoint(x: tx, y: ty)
        if let mv = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: startPt, mouseButton: .left) {
            mv.post(tap: .cghidEventTap)
            usleep(10_000)
        }
        if let dn = CGEvent(mouseEventSource: src, mouseType: downType, mouseCursorPosition: startPt, mouseButton: cgBtn),
           let dr = CGEvent(mouseEventSource: src, mouseType: dragType, mouseCursorPosition: endPt, mouseButton: cgBtn),
           let up = CGEvent(mouseEventSource: src, mouseType: upType, mouseCursorPosition: endPt, mouseButton: cgBtn) {
            dn.post(tap: .cghidEventTap)
            usleep(15_000)
            dr.post(tap: .cghidEventTap)
            usleep(15_000)
            up.post(tap: .cghidEventTap)
        }
    case "scroll":
        let dyRaw = parseCoord(argVal("--delta-y") ?? "0", name: "--delta-y")
        let dxRaw = parseCoord(argVal("--delta-x") ?? "0", name: "--delta-x")
        let dy = Int32(dyRaw.rounded())
        let dx = Int32(dxRaw.rounded())
        if let ev = CGEvent(scrollWheelEvent2Source: src, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0) {
            ev.post(tap: .cghidEventTap)
        }
    default:
        failJSON("Unknown pointer op: \(op)", code: "invalid_argument")
    }

    emitDict(["ok": true])

default:
    failJSON("Unknown subcommand: \(subcmd)", code: "invalid_argument")
}
