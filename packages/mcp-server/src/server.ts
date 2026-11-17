import { readFileSync } from "node:fs";
import {
  type AppState,
  type PlatformAdapter,
  AmbiguousElementError,
  AppNotFoundError,
  ComputerUseError,
  ElementNotFoundError,
  InvalidArgumentError,
  UnsupportedPlatformError,
  computeStateDiff,
  getPlatformCapabilities,
  redactElementSecrets,
  reduceToCompactState,
} from "@zov/core";
import { MacOSAdapter } from "@zov/platform-macos";
import { WindowsAdapter } from "@zov/platform-windows";
import { LinuxAdapter } from "@zov/platform-linux";
import { TOOLS_MANIFEST, type ToolDefinition } from "./tools-manifest.js";

const MAX_RETAINED_STATES = 64;
const MAX_STDIO_LINE_BYTES = 2 * 1024 * 1024;
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2026-07-28",
]);

const MANIFEST_BY_NAME = new Map<string, ToolDefinition>(
  TOOLS_MANIFEST.map((tool) => [tool.name, tool])
);

const PLATFORM_AGNOSTIC_TOOLS = new Set([
  "get_capabilities",
  "stop_computer_control",
  "wait",
  "request_access",
]);

function readServerVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.version === "string" && parsed.version.trim()) {
      return parsed.version.trim();
    }
  } catch {}
  return "1.0.0";
}

const SERVER_VERSION = readServerVersion();

function sanitizeState(rawState: AppState): AppState {
  return {
    ...rawState,
    tree: Array.isArray(rawState.tree) ? rawState.tree.map(redactElementSecrets) : [],
  };
}

function validateTargetObject(target: any, toolName: string): void {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new InvalidArgumentError(`${toolName}: 'target' must be an object`);
  }
  if (target.type !== "element" && target.type !== "coordinate") {
    throw new InvalidArgumentError(`${toolName}: target.type must be 'element' or 'coordinate'`);
  }
  if (target.type === "coordinate") {
    if (
      typeof target.x !== "number" ||
      typeof target.y !== "number" ||
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y) ||
      Math.abs(target.x) > 100_000 ||
      Math.abs(target.y) > 100_000
    ) {
      throw new InvalidArgumentError(`${toolName}: coordinate target requires finite x and y within [-100000, 100000]`);
    }
  } else {
    const hasIndex = target.index !== undefined;
    const hasHandle = typeof target.handle === "string" && target.handle.length > 0;
    const hasName = typeof target.name === "string" && target.name.length > 0;
    if (hasIndex && (!Number.isInteger(target.index) || target.index < 0)) {
      throw new InvalidArgumentError(`${toolName}: element target.index must be a non-negative integer`);
    }
    if (!hasIndex && !hasHandle && !hasName) {
      throw new InvalidArgumentError(`${toolName}: element target requires 'index' or 'handle'`);
    }
  }
}

const VALID_MODIFIERS = new Set([
  "cmd",
  "command",
  "meta",
  "super",
  "win",
  "windows",
  "ctrl",
  "control",
  "alt",
  "option",
  "opt",
  "shift",
]);

function validateModifierTokens(tokens: unknown[], toolName: string): void {
  for (const tok of tokens) {
    if (typeof tok !== "string" || !VALID_MODIFIERS.has(tok.trim().toLowerCase())) {
      throw new InvalidArgumentError(
        `${toolName}: invalid modifier '${String(tok)}' (expected cmd/ctrl/alt/option/shift)`
      );
    }
  }
}

function validateAppRefObject(appRef: Record<string, any>, toolName: string): void {
  if (appRef.pid !== undefined && (!Number.isInteger(appRef.pid) || appRef.pid <= 0)) {
    throw new InvalidArgumentError(`${toolName}: 'app_ref.pid' must be a positive integer`);
  }
  if (appRef.window_id !== undefined && (!Number.isInteger(appRef.window_id) || appRef.window_id <= 0)) {
    throw new InvalidArgumentError(`${toolName}: 'app_ref.window_id' must be a positive integer`);
  }
  if (appRef.name !== undefined && typeof appRef.name !== "string") {
    throw new InvalidArgumentError(`${toolDefName(toolName)}: 'app_ref.name' must be a string`);
  }
  if (appRef.bundle_id !== undefined && typeof appRef.bundle_id !== "string") {
    throw new InvalidArgumentError(`${toolDefName(toolName)}: 'app_ref.bundle_id' must be a string`);
  }
}

function toolDefName(n: string): string {
  return n;
}

function validateToolArgs(toolDef: ToolDefinition, args: Record<string, any>): void {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new InvalidArgumentError(`${toolDef.name}: arguments must be a JSON object`);
  }

  const required = toolDef.inputSchema.required || [];
  for (const reqKey of required) {
    if (args[reqKey] === undefined || args[reqKey] === null) {
      throw new InvalidArgumentError(`${toolDef.name}: missing required argument '${reqKey}'`);
    }
  }

  const props = toolDef.inputSchema.properties || {};
  for (const [key, propRaw] of Object.entries(props)) {
    const val = args[key];
    if (val === undefined) continue;
    const prop = propRaw as Record<string, any>;

    if (prop.type === "number") {
      if (typeof val !== "number" || !Number.isFinite(val)) {
        throw new InvalidArgumentError(`${toolDef.name}: '${key}' must be a finite number`);
      }
      if (typeof prop.minimum === "number" && val < prop.minimum) {
        throw new InvalidArgumentError(`${toolDef.name}: '${key}' must be >= ${prop.minimum}`);
      }
      if (typeof prop.maximum === "number" && val > prop.maximum) {
        throw new InvalidArgumentError(`${toolDef.name}: '${key}' must be <= ${prop.maximum}`);
      }
    } else if (prop.type === "string") {
      if (typeof val !== "string") {
        throw new InvalidArgumentError(`${toolDef.name}: '${key}' must be a string`);
      }
      if (Array.isArray(prop.enum) && !prop.enum.includes(val)) {
        throw new InvalidArgumentError(
          `${toolDef.name}: '${key}' must be one of [${prop.enum.join(", ")}]`
        );
      }
    } else if (prop.type === "boolean") {
      if (typeof val !== "boolean") {
        throw new InvalidArgumentError(`${toolDef.name}: '${key}' must be a boolean`);
      }
    } else if (prop.type === "array") {
      if (!Array.isArray(val)) {
        throw new InvalidArgumentError(`${toolDef.name}: '${key}' must be an array`);
      }
      const itemSchema = prop.items as Record<string, any> | undefined;
      if (itemSchema && typeof itemSchema === "object") {
        for (const item of val) {
          if (itemSchema.type === "string" && (typeof item !== "string" || item.length === 0)) {
            throw new InvalidArgumentError(`${toolDef.name}: every item in '${key}' must be a non-empty string`);
          }
          if (Array.isArray(itemSchema.enum) && !itemSchema.enum.includes(item)) {
            throw new InvalidArgumentError(
              `${toolDef.name}: every item in '${key}' must be one of [${itemSchema.enum.join(", ")}]`
            );
          }
        }
      }
    } else if (prop.type === "object") {
      if (typeof val !== "object" || val === null || Array.isArray(val)) {
        throw new InvalidArgumentError(`${toolDef.name}: '${key}' must be an object`);
      }
    }
  }

  if (args.modifiers !== undefined) {
    if (Array.isArray(args.modifiers)) {
      validateModifierTokens(args.modifiers, toolDef.name);
    } else if (typeof args.modifiers === "string") {
      if (args.modifiers.trim().length > 0) {
        const parts = args.modifiers.split("+");
        validateModifierTokens(parts, toolDef.name);
      }
    } else {
      throw new InvalidArgumentError(`${toolDef.name}: 'modifiers' must be an array of strings or chord string`);
    }
  }

  if (args.clickCount !== undefined && !Number.isInteger(args.clickCount)) {
    throw new InvalidArgumentError(`${toolDef.name}: 'clickCount' must be an integer between 1 and 10`);
  }
  if (args.repeat !== undefined && !Number.isInteger(args.repeat)) {
    throw new InvalidArgumentError(`${toolDef.name}: 'repeat' must be an integer between 0 and 100`);
  }
  if (args.window_id !== undefined && (!Number.isInteger(args.window_id) || args.window_id <= 0)) {
    throw new InvalidArgumentError(`${toolDef.name}: 'window_id' must be a positive integer`);
  }
  if (args.pid !== undefined && (!Number.isInteger(args.pid) || args.pid <= 0)) {
    throw new InvalidArgumentError(`${toolDef.name}: 'pid' must be a positive integer`);
  }
  if (args.app_ref !== undefined) {
    validateAppRefObject(args.app_ref, toolDef.name);
  }
  if (args.target !== undefined) {
    validateTargetObject(args.target, toolDef.name);
  }

  if (toolDef.name === "left_click_drag") {
    const tx = args.toX ?? args.x;
    const ty = args.toY ?? args.y;
    if (
      typeof tx !== "number" ||
      typeof ty !== "number" ||
      !Number.isFinite(tx) ||
      !Number.isFinite(ty) ||
      Math.abs(tx) > 100_000 ||
      Math.abs(ty) > 100_000
    ) {
      throw new InvalidArgumentError("left_click_drag: requires finite target coordinates (toX/toY or x/y)");
    }
    if (args.fromX !== undefined || args.fromY !== undefined) {
      if (
        typeof args.fromX !== "number" ||
        typeof args.fromY !== "number" ||
        !Number.isFinite(args.fromX) ||
        !Number.isFinite(args.fromY)
      ) {
        throw new InvalidArgumentError("left_click_drag: both fromX and fromY must be finite numbers when provided");
      }
    }
  }

  if (toolDef.name === "press_key" || toolDef.name === "key" || toolDef.name === "hold_key") {
    const keyInput = args.key ?? args.text;
    if (typeof keyInput !== "string" || keyInput.length === 0) {
      throw new InvalidArgumentError(`${toolDef.name}: requires a non-empty 'key' or 'text' string`);
    }
  }

  if (toolDef.name === "open_application") {
    const hasName = typeof args.name === "string" && args.name.trim().length > 0;
    const hasBundle = typeof args.bundle_id === "string" && args.bundle_id.trim().length > 0;
    const hasPid = typeof args.pid === "number" && Number.isInteger(args.pid) && args.pid > 0;
    if (!hasName && !hasBundle && !hasPid) {
      throw new InvalidArgumentError("open_application requires 'name', 'bundle_id', or positive integer 'pid'");
    }
  }
}

export function createPlatformAdapter(): PlatformAdapter {
  switch (process.platform) {
    case "darwin":
      return new MacOSAdapter();
    case "win32":
      return new WindowsAdapter();
    case "linux":
      return new LinuxAdapter();
    default:
      return new MacOSAdapter();
  }
}

export class MCPServer {
  private adapter: PlatformAdapter;
  private lastStateMap = new Map<string, AppState>();
  private stateIdToAppRef = new Map<string, any>();
  private isControlHalted = false;

  constructor(adapter?: PlatformAdapter) {
    this.adapter = adapter || createPlatformAdapter();
  }

  private rememberStateMapping(stateId: string, appRef: any): void {
    if (this.stateIdToAppRef.has(stateId)) {
      this.stateIdToAppRef.delete(stateId);
    }
    this.stateIdToAppRef.set(stateId, appRef);
    while (this.stateIdToAppRef.size > MAX_RETAINED_STATES) {
      const oldest = this.stateIdToAppRef.keys().next().value;
      if (oldest === undefined) break;
      this.stateIdToAppRef.delete(oldest);
    }
  }

  private resolveRefForStateId(stateId: string | undefined, explicitRef?: any): any {
    if (stateId) {
      const mapped = this.stateIdToAppRef.get(stateId);
      if (mapped) return mapped;
      const adapterRef = (this.adapter as any).activeStates?.get?.(stateId)?.appRef;
      if (adapterRef) return adapterRef;
    }
    return explicitRef;
  }

  private async attachPostActionState(
    receipt: Record<string, any>,
    returnState: string | undefined,
    ref: any
  ): Promise<Record<string, any>> {
    if ((returnState !== "compact" && returnState !== "full") || !ref) {
      return receipt;
    }
    const freshRaw = await this.adapter.getAppState(ref, {
      detail: returnState === "full" ? "full" : "compact",
    });
    const safeState = sanitizeState(freshRaw);
    if (safeState.state_id) {
      this.rememberStateMapping(safeState.state_id, ref);
    }
    return returnState === "full"
      ? { ...receipt, state: safeState }
      : { ...receipt, compact_state: reduceToCompactState(safeState) };
  }

  getAdapter(): PlatformAdapter {
    return this.adapter;
  }

  async handleCallTool(
    name: string,
    args: Record<string, any> = {},
    meta?: Record<string, any>
  ): Promise<{
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    structuredContent?: Record<string, any>;
    isError?: boolean;
  }> {
    if (meta?.["com.zov/request-context"]?.runtime_scope === "subagent") {
      return {
        isError: true,
        structuredContent: { code: "SUBAGENT_COMPUTER_USE_UNAVAILABLE" },
        content: [
          {
            type: "text",
            text: "SUBAGENT_COMPUTER_USE_UNAVAILABLE: Computer Use GUI writes are restricted to the main agent.",
          },
        ],
      };
    }

    try {
      const result = await this.dispatchTool(name, args);
      return {
        content: [
          {
            type: "text",
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: any) {
      const isComputerUseError = err instanceof ComputerUseError;
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: err.message || String(err),
              code: isComputerUseError ? err.code : "operation_failed",
              recoverable: isComputerUseError ? err.recoverable : false,
              action_sent: isComputerUseError ? err.actionSent : false,
            }),
          },
        ],
      };
    }
  }

  private async dispatchTool(name: string, args: Record<string, any>): Promise<any> {
    if (
      this.isControlHalted &&
      name !== "stop_computer_control" &&
      name !== "get_capabilities" &&
      name !== "wait"
    ) {
      throw new ComputerUseError(
        "Computer control was stopped via kill-switch. Start a new session to resume.",
        "operation_failed"
      );
    }

    const toolDef = MANIFEST_BY_NAME.get(name);
    if (!toolDef) {
      throw new InvalidArgumentError(`Tool not recognized: ${name}`);
    }

    if (name === "select_text") {
      throw new UnsupportedPlatformError("select_text", this.adapter.platform);
    }

    if (this.adapter.platform === "linux" && !PLATFORM_AGNOSTIC_TOOLS.has(name)) {
      throw new UnsupportedPlatformError(name, this.adapter.platform);
    }

    validateToolArgs(toolDef, args);

    switch (name) {
      // --- Capability Registry ---
      case "get_capabilities":
        return getPlatformCapabilities(this.adapter.platform);

      // --- Observation ---
      case "list_apps":
        return await this.adapter.listApps();

      case "list_windows":
        return await this.adapter.listWindows(args.app_ref);

      case "get_active_window":
        return await this.adapter.getActiveWindow();

      case "get_app_state": {
        const detail = args.detail || "compact";
        const rawState = await this.adapter.getAppState(args.app_ref, {
          detail: detail === "full" ? "full" : "compact",
          include_screenshot: args.include_screenshot,
        });
        const state = sanitizeState(rawState);

        const appKey = args.app_ref?.name || String(args.app_ref?.pid || "default");
        const prevState = this.lastStateMap.get(appKey);
        if (this.lastStateMap.has(appKey)) this.lastStateMap.delete(appKey);
        this.lastStateMap.set(appKey, state);
        while (this.lastStateMap.size > MAX_RETAINED_STATES) {
          const oldestAppKey = this.lastStateMap.keys().next().value;
          if (oldestAppKey === undefined) break;
          this.lastStateMap.delete(oldestAppKey);
        }
        if (state?.state_id && args.app_ref) {
          this.rememberStateMapping(state.state_id, args.app_ref);
        }

        if (detail === "compact") {
          return reduceToCompactState(state);
        } else if (detail === "diff") {
          if (prevState) {
            return computeStateDiff(prevState, state);
          }
          return { ...reduceToCompactState(state), diff_baseline_missing: true };
        }
        return state;
      }

      case "screenshot":
        return await this.adapter.takeScreenshot(args);

      case "get_screen_info":
      case "list_displays":
        if (this.adapter.getScreenInfo) {
          return await this.adapter.getScreenInfo();
        }
        throw new UnsupportedPlatformError("get_screen_info", this.adapter.platform);

      // --- Pointer ---
      case "click":
      case "left_click": {
        const modsRaw = args.modifiers;
        const parsedMods = Array.isArray(modsRaw)
          ? modsRaw
          : typeof modsRaw === "string" && modsRaw.trim()
            ? modsRaw.split("+").map((s: string) => s.trim())
            : undefined;
        const clickReceipt = await this.adapter.click(args.target, {
          clickCount: args.clickCount ?? 1,
          button: args.button || "left",
          strategy: args.strategy,
          modifiers: parsedMods,
        });
        const ref = this.resolveRefForStateId(args.target?.state_id, args.app_ref);
        return await this.attachPostActionState(clickReceipt, args.return_state, ref);
      }

      case "double_click": {
        const receipt = await this.adapter.doubleClick(args.target, args);
        return await this.attachPostActionState(
          receipt,
          args.return_state,
          this.resolveRefForStateId(args.target?.state_id, args.app_ref)
        );
      }

      case "triple_click": {
        const receipt = await this.adapter.click(args.target, { ...args, clickCount: 3 });
        return await this.attachPostActionState(
          receipt,
          args.return_state,
          this.resolveRefForStateId(args.target?.state_id, args.app_ref)
        );
      }

      case "right_click": {
        const receipt = await this.adapter.rightClick(args.target, args);
        return await this.attachPostActionState(
          receipt,
          args.return_state,
          this.resolveRefForStateId(args.target?.state_id, args.app_ref)
        );
      }

      case "middle_click": {
        const receipt = await this.adapter.click(args.target, { ...args, button: "middle" });
        return await this.attachPostActionState(
          receipt,
          args.return_state,
          this.resolveRefForStateId(args.target?.state_id, args.app_ref)
        );
      }

      case "move_pointer":
      case "mouse_move":
        return await this.adapter.movePointer(args.x, args.y);

      case "scroll":
        return await this.adapter.scroll(args);

      case "left_click_drag":
        if (this.adapter.drag) {
          return await this.adapter.drag(args.toX ?? args.x, args.toY ?? args.y, args.fromX, args.fromY);
        }
        throw new UnsupportedPlatformError("left_click_drag", this.adapter.platform);

      case "mouse_down":
      case "left_mouse_down":
        if (this.adapter.mouseDown) {
          return await this.adapter.mouseDown(args.button || "left");
        }
        throw new UnsupportedPlatformError("mouse_down", this.adapter.platform);

      case "mouse_up":
      case "left_mouse_up":
        if (this.adapter.mouseUp) {
          return await this.adapter.mouseUp(args.button || "left");
        }
        throw new UnsupportedPlatformError("mouse_up", this.adapter.platform);

      // --- Text & Keyboard ---
      case "type_text":
      case "type": {
        const typeReceipt = await this.adapter.typeText(
          args.text,
          { strategy: args.strategy, clearFirst: args.clearFirst, appRef: args.app_ref },
          args.target
        );
        const ref = args.app_ref || this.resolveRefForStateId(args.target?.state_id, undefined);
        return await this.attachPostActionState(typeReceipt, args.return_state, ref);
      }

      case "press_key":
      case "key": {
        const keyInput = args.key ?? args.text;
        if (typeof args.repeat === "number" && args.repeat === 0) {
          return { ok: true, action: "press_key", action_sent: false, receipt: "repeat=0 no-op" };
        }
        const keyReceipt = await this.adapter.pressKey(keyInput, args.modifiers, {
          appRef: args.app_ref,
          repeat: typeof args.repeat === "number" ? args.repeat : undefined,
          strategy: args.strategy,
        });
        return await this.attachPostActionState(keyReceipt, args.return_state, args.app_ref);
      }

      case "hotkey":
        return await this.adapter.hotkey(args.keys || [], {
          appRef: args.app_ref,
          strategy: args.strategy,
        });

      case "hold_key": {
        const holdKeyInput = args.key ?? args.text;
        return await this.adapter.pressKey(holdKeyInput, args.modifiers, {
          appRef: args.app_ref,
          strategy: args.strategy,
        });
      }

      case "set_value": {
        const valReceipt = await this.adapter.setValue(args.target, args.value);
        const ref = this.resolveRefForStateId(args.target?.state_id, args.app_ref);
        return await this.attachPostActionState(valReceipt, args.return_state, ref);
      }

      // --- Window & App ---
      case "launch_app":
      case "open_application": {
        if (args.pid && !args.name && !args.bundle_id) {
          const appsBefore = await this.adapter.listApps();
          const existing = appsBefore.find((a) => a.pid === args.pid);
          if (!existing) {
            throw new AppNotFoundError(String(args.pid));
          }
          let focused = existing.active;
          if (args.activate ?? true) {
            focused = await this.adapter.focusApp({ pid: args.pid });
          }
          const appsAfter = await this.adapter.listApps();
          return appsAfter.find((a) => a.pid === args.pid) || { ...existing, active: Boolean(focused) };
        }
        const targetIdent = args.bundle_id || args.name;
        return await this.adapter.launchApp(targetIdent, args.activate ?? true);
      }

      case "focus_app":
        return { ok: await this.adapter.focusApp(args.app_ref) };

      case "focus_window":
        return { ok: await this.adapter.focusWindow(args.window_id) };

      case "move_window":
        return { ok: await this.adapter.moveWindow(args.window_id, args.x, args.y) };

      case "resize_window":
        return { ok: await this.adapter.resizeWindow(args.window_id, args.width, args.height) };

      case "minimize_window":
        return { ok: await this.adapter.minimizeWindow(args.window_id) };

      case "maximize_window":
        return { ok: await this.adapter.maximizeWindow(args.window_id) };

      // --- High-level ---
      case "find_element": {
        const state = sanitizeState(await this.adapter.getAppState(args.app_ref, { detail: "compact" }));
        const compact = reduceToCompactState(state);
        const match = compact.elements.find(
          (e) =>
            e.n.toLowerCase().includes(args.name.toLowerCase()) &&
            (!args.role || e.r.toLowerCase() === String(args.role).toLowerCase())
        );
        return match || { not_found: true, searched_name: args.name };
      }

      case "click_element": {
        const state = sanitizeState(await this.adapter.getAppState(args.app_ref, { detail: "compact" }));
        const compact = reduceToCompactState(state);
        const matches = compact.elements.filter(
          (e) =>
            e.n.toLowerCase().includes(args.name.toLowerCase()) &&
            (!args.role || e.r.toLowerCase() === String(args.role).toLowerCase())
        );
        if (matches.length === 0) throw new ElementNotFoundError(`Element "${args.name}" not found`);
        if (matches.length > 1) {
          throw new AmbiguousElementError(
            `Found ${matches.length} elements matching "${args.name}". Specify unique handle.`,
            matches
          );
        }
        const match = matches[0];
        return await this.adapter.click({
          type: "element",
          state_id: state.state_id,
          index: match.i,
          handle: match.h,
        });
      }

      case "set_element_value": {
        const state = sanitizeState(await this.adapter.getAppState(args.app_ref, { detail: "compact" }));
        const compact = reduceToCompactState(state);
        const matches = compact.elements.filter(
          (e) =>
            e.n.toLowerCase().includes(args.name.toLowerCase()) &&
            (!args.role || e.r.toLowerCase() === String(args.role).toLowerCase())
        );
        if (matches.length === 0) throw new ElementNotFoundError(`Element "${args.name}" not found`);
        if (matches.length > 1) {
          throw new AmbiguousElementError(
            `Found ${matches.length} elements matching "${args.name}". Specify unique handle.`,
            matches
          );
        }
        const match = matches[0];
        return await this.adapter.setValue(
          { type: "element", state_id: state.state_id, index: match.i, handle: match.h },
          args.value
        );
      }

      case "perform_action":
        return await this.adapter.performAction(args.target, args.action);

      // --- Safety & System ---
      case "request_access":
        return await this.adapter.requestAccess(args.types);

      case "stop_computer_control":
        this.isControlHalted = true;
        await this.adapter.releaseHeldInputs?.();
        return {
          ok: true,
          action: "stop_computer_control",
          receipt: "Control session halted via kill-switch and held inputs released",
        };

      case "wait": {
        const ms = args.ms ?? 1000;
        await new Promise((r) => setTimeout(r, ms));
        return { ok: true, waited_ms: ms };
      }

      case "read_clipboard":
        if (this.adapter.readClipboard) {
          const text = await this.adapter.readClipboard();
          return { text };
        }
        throw new UnsupportedPlatformError("read_clipboard", this.adapter.platform);

      case "write_clipboard":
        if (this.adapter.writeClipboard) {
          await this.adapter.writeClipboard(args.text);
          return { ok: true, length: args.text.length };
        }
        throw new UnsupportedPlatformError("write_clipboard", this.adapter.platform);

      default:
        throw new InvalidArgumentError(`Tool not recognized: ${name}`);
    }
  }

  startStdio(): void {
    const sendResponse = (msg: Record<string, any>) => {
      process.stdout.write(JSON.stringify(msg) + "\n");
    };

    let requestQueue = Promise.resolve();
    let shuttingDown = false;

    const cleanExit = (code = 0) => {
      if (shuttingDown) return;
      shuttingDown = true;
      const forceTimer = setTimeout(() => process.exit(code), 1500);
      forceTimer.unref?.();
      Promise.resolve(this.adapter.releaseHeldInputs?.())
        .catch(() => {})
        .finally(() => process.exit(code));
    };

    const processLine = async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const req = JSON.parse(trimmed);
        const { id, method, params } = req;

        if (method === "initialize") {
          const requestedProto = typeof params?.protocolVersion === "string" ? params.protocolVersion : "2024-11-05";
          const negotiatedVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requestedProto)
            ? requestedProto
            : "2024-11-05";

          if (id !== undefined) {
            sendResponse({
              jsonrpc: "2.0",
              id,
              result: {
                protocolVersion: negotiatedVersion,
                capabilities: {
                  tools: { listChanged: false },
                },
                serverInfo: {
                  name: "zov-computer-use",
                  version: SERVER_VERSION,
                },
              },
            });
          }
          return;
        }

        if (method === "notifications/initialized") {
          return;
        }

        if (method === "ping") {
          sendResponse({ jsonrpc: "2.0", id, result: {} });
          return;
        }

        if (method === "tools/list") {
          sendResponse({
            jsonrpc: "2.0",
            id,
            result: {
              tools: TOOLS_MANIFEST,
            },
          });
          return;
        }

        if (method === "tools/call") {
          const toolName = params?.name;
          const toolArgs = params?.arguments ?? {};
          const toolMeta = params?._meta;
          const result = await this.handleCallTool(toolName, toolArgs, toolMeta);
          sendResponse({
            jsonrpc: "2.0",
            id,
            result,
          });
          return;
        }

        if (id !== undefined) {
          sendResponse({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          });
        }
      } catch (err: any) {
        try {
          process.stderr.write(`[mcp-server] Error processing JSON-RPC: ${err?.message || String(err)}\n`);
        } catch {}
      }
    };

    // Bounded line framing to prevent unbounded memory growth on malformed stdio streams
    let buffer = "";
    let discardingOversizedLine = false;

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      let start = 0;
      while (start < chunk.length) {
        const nlIdx = chunk.indexOf("\n", start);
        if (nlIdx === -1) {
          const tail = chunk.slice(start);
          if (!discardingOversizedLine) {
            if (Buffer.byteLength(buffer, "utf8") + Buffer.byteLength(tail, "utf8") > MAX_STDIO_LINE_BYTES) {
              buffer = "";
              discardingOversizedLine = true;
            } else {
              buffer += tail;
            }
          }
          break;
        }

        const segment = chunk.slice(start, nlIdx);
        start = nlIdx + 1;

        if (discardingOversizedLine) {
          discardingOversizedLine = false;
          buffer = "";
          sendResponse({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Invalid Request: JSON-RPC line exceeds 2 MiB limit" },
          });
          continue;
        }

        if (Buffer.byteLength(buffer, "utf8") + Buffer.byteLength(segment, "utf8") > MAX_STDIO_LINE_BYTES) {
          buffer = "";
          sendResponse({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Invalid Request: JSON-RPC line exceeds 2 MiB limit" },
          });
          continue;
        }

        const fullLine = buffer + segment;
        buffer = "";
        requestQueue = requestQueue.then(() => processLine(fullLine)).catch(() => {});
      }
    });

    process.stdin.on("end", () => {
      if (!discardingOversizedLine && buffer.trim()) {
        const finalLine = buffer;
        buffer = "";
        requestQueue = requestQueue.then(() => processLine(finalLine)).catch(() => {});
      }
      void requestQueue.finally(() => cleanExit(0));
    });

    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(sig as any, () => {
        process.stderr.write(`[mcp-server] Received ${sig}, releasing held inputs and shutting down...\n`);
        cleanExit(0);
      });
    }
  }
}
