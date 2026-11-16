import { execFile as execFileCallback, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  type ActionResult,
  type AppInfo,
  type AppRef,
  type AppState,
  type ClickOptions,
  type KeyOptions,
  type PermissionReport,
  type PlatformAdapter,
  type ScrollOptions,
  type Target,
  type TypeOptions,
  type UIElement,
  type WindowInfo,
  AmbiguousElementError,
  AppNotFoundError,
  ComputerUseError,
  ElementNotFoundError,
  StaleHandleError,
  assignHandlesToTree,
  resolveElementWithAmbiguity,
} from "@zcode-community/core";

const execFile = promisify(execFileCallback);
const MAX_RETAINED_STATES = 64;

function resolveNativeHelperPath(): string {
  const distDir = dirname(fileURLToPath(import.meta.url));
  return join(distDir, "bin", "macos-ax-helper");
}

export class MacOSAdapter implements PlatformAdapter {
  readonly platform = "darwin" as const;
  readonly status = "verified" as const;

  private activeStates = new Map<string, { appRef: AppRef; tree: UIElement[] }>();
  private helperPath = resolveNativeHelperPath();

  private async runHelper<T>(args: string[], timeoutMs = 15000): Promise<T> {
    if (!existsSync(this.helperPath)) {
      throw new ComputerUseError(
        `Native macOS AX helper binary not found at ${this.helperPath}. Run 'npm run build' on macOS first.`,
        "operation_failed"
      );
    }

    try {
      const { stdout } = await execFile(this.helperPath, args, {
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
      });
      const trimmed = stdout.trim();
      if (!trimmed) return undefined as unknown as T;
      return JSON.parse(trimmed) as T;
    } catch (err: any) {
      const rawOut = typeof err?.stdout === "string" ? err.stdout.trim() : "";
      if (rawOut) {
        try {
          const parsed = JSON.parse(rawOut);
          if (parsed && typeof parsed === "object" && parsed.error) {
            if (parsed.code === "stale_handle") {
              throw new StaleHandleError("ax_path", undefined);
            }
            if (parsed.code === "app_not_found") {
              throw new AppNotFoundError(String(parsed.error));
            }
            throw new ComputerUseError(String(parsed.error), String(parsed.code || "operation_failed"), false, false);
          }
        } catch (inner) {
          if (inner instanceof ComputerUseError) throw inner;
        }
      }
      throw new ComputerUseError(`macOS AX helper failed: ${err.message}`, "operation_failed", false, false);
    }
  }

  private rememberState(stateId: string, record: { appRef: AppRef; tree: UIElement[] }): void {
    if (this.activeStates.has(stateId)) {
      this.activeStates.delete(stateId);
    }
    this.activeStates.set(stateId, record);
    while (this.activeStates.size > MAX_RETAINED_STATES) {
      const oldestKey = this.activeStates.keys().next().value;
      if (oldestKey === undefined) break;
      this.activeStates.delete(oldestKey);
    }
  }

  private async resolveAppFromAppRef(appRef?: AppRef): Promise<AppInfo | undefined> {
    if (!appRef) return undefined;
    const apps = await this.listApps();
    if (typeof appRef.pid === "number" && appRef.pid > 0) {
      const byPid = apps.find((a) => a.pid === appRef.pid);
      if (byPid) return byPid;
      return { pid: appRef.pid, name: appRef.name || String(appRef.pid), bundle_id: appRef.bundle_id, active: false };
    }
    if (appRef.bundle_id) {
      const found = apps.find((a) => a.bundle_id?.toLowerCase() === appRef.bundle_id!.toLowerCase());
      if (found) return found;
    }
    if (appRef.name) {
      const lower = appRef.name.toLowerCase();
      const exact = apps.find((a) => a.name.toLowerCase() === lower);
      if (exact) return exact;
      const partial = apps.find((a) => a.name.toLowerCase().includes(lower));
      if (partial) return partial;
    }
    throw new AppNotFoundError(appRef.name || appRef.bundle_id || String(appRef.pid || "unknown"));
  }

  private async resolvePidFromAppRef(appRef?: AppRef): Promise<number | undefined> {
    const app = await this.resolveAppFromAppRef(appRef);
    return app?.pid;
  }

  async listApps(): Promise<AppInfo[]> {
    return this.runHelper<AppInfo[]>(["list-apps"]);
  }

  async listWindows(appRef?: AppRef): Promise<WindowInfo[]> {
    if (appRef?.pid) {
      return this.runHelper<WindowInfo[]>(["list-windows", "--pid", String(appRef.pid)]);
    }
    const windows = await this.runHelper<WindowInfo[]>(["list-windows"]);
    if (appRef?.bundle_id) {
      const lower = appRef.bundle_id.toLowerCase();
      return windows.filter((w) => w.bundle_id?.toLowerCase() === lower);
    }
    if (appRef?.name) {
      const lower = appRef.name.toLowerCase();
      return windows.filter((w) => w.app_name.toLowerCase().includes(lower));
    }
    return windows;
  }

  async getActiveWindow(): Promise<WindowInfo | null> {
    const windows = await this.listWindows();
    return windows[0] || null;
  }

  async getAppState(
    appRef: AppRef,
    options: { detail?: "compact" | "full"; include_screenshot?: boolean } = {}
  ): Promise<AppState> {
    const pid = await this.resolvePidFromAppRef(appRef);
    if (!pid) {
      throw new AppNotFoundError(appRef.name || String(appRef.pid || appRef.bundle_id));
    }

    const helperArgs = ["inspect", "--pid", String(pid), "--max-depth", "20", "--max-nodes", "3000"];
    if (appRef.window_id) {
      helperArgs.push("--window-id", String(appRef.window_id));
    }

    const data = await this.runHelper<{
      app: AppInfo;
      active_window?: WindowInfo;
      elements: UIElement[];
    }>(helperArgs);

    const windowId = appRef.window_id ?? data.active_window?.id ?? pid;
    const tree = assignHandlesToTree(windowId, data.elements || []);

    const canonicalRef: AppRef = {
      pid: data.app.pid,
      name: data.app.name,
      bundle_id: data.app.bundle_id,
      window_id: appRef.window_id ?? data.active_window?.id,
    };

    const stateId = `s_${randomUUID().slice(0, 8)}`;
    this.rememberState(stateId, { appRef: canonicalRef, tree });

    let screenshotBase64: string | undefined;
    if (options.include_screenshot) {
      try {
        const shot = await this.takeScreenshot({ window_id: canonicalRef.window_id });
        screenshotBase64 = shot.base64;
      } catch (_) {}
    }

    let totalNodes = 0;
    const countWalk = (nodes: UIElement[]) => {
      for (const n of nodes) {
        totalNodes++;
        if (n.children) countWalk(n.children);
      }
    };
    countWalk(tree);

    return {
      state_id: stateId,
      app: data.app,
      active_window: data.active_window,
      tree,
      element_count: totalNodes,
      timestamp: Date.now(),
      screenshot_base64: screenshotBase64,
    };
  }

  async takeScreenshot(options: { window_id?: number; display_id?: number } = {}): Promise<{
    base64: string;
    width: number;
    height: number;
  }> {
    const tempFile = join(tmpdir(), `zcode-cap-${randomUUID().slice(0, 8)}.png`);
    const args = ["-x", "-t", "png"];

    if (options.window_id) {
      args.push("-l", String(options.window_id));
    }
    args.push(tempFile);

    try {
      await execFile("/usr/sbin/screencapture", args);
      const buffer = await readFile(tempFile);
      await unlink(tempFile).catch(() => {});

      let width = 1920;
      let height = 1080;
      if (
        buffer.length >= 24 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
      ) {
        width = buffer.readUInt32BE(16);
        height = buffer.readUInt32BE(20);
      }

      return {
        base64: buffer.toString("base64"),
        width,
        height,
      };
    } catch (err: any) {
      await unlink(tempFile).catch(() => {});
      throw new ComputerUseError(`Failed to take screenshot: ${err.message}`, "operation_failed");
    }
  }

  async getScreenInfo(): Promise<{
    displays: number;
    main_display: { width: number; height: number; scale: number };
    platform: string;
  }> {
    return this.runHelper(["screen-info"]);
  }

  async launchApp(nameOrBundleId: string, activate = true): Promise<AppInfo> {
    const isBundleId = /^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/.test(nameOrBundleId) && !nameOrBundleId.endsWith(".app");
    const openArgs = isBundleId ? ["-b", nameOrBundleId] : ["-a", nameOrBundleId];
    if (!activate) {
      openArgs.unshift("-g");
    }
    await execFile("open", openArgs);
    await new Promise((r) => setTimeout(r, 500));

    const apps = await this.listApps();
    const cleaned = nameOrBundleId.replace(/\.app$/i, "").toLowerCase();
    const app = apps.find(
      (a) =>
        a.name.toLowerCase() === cleaned ||
        a.name.toLowerCase() === nameOrBundleId.toLowerCase() ||
        a.bundle_id?.toLowerCase() === nameOrBundleId.toLowerCase()
    );
    return app || { pid: 0, name: nameOrBundleId, active: activate };
  }

  async focusApp(appRef: AppRef): Promise<boolean> {
    const pid = await this.resolvePidFromAppRef(appRef).catch(() => undefined);
    if (!pid) return false;
    const res = await this.runHelper<{ ok: boolean }>(["focus-app", "--pid", String(pid)]).catch(() => ({ ok: false }));
    return Boolean(res?.ok);
  }

  async focusWindow(windowId: number): Promise<boolean> {
    const res = await this.runHelper<{ ok: boolean }>([
      "window-op",
      "--op", "focus",
      "--window-id", String(windowId),
    ]).catch(() => ({ ok: false }));
    return Boolean(res?.ok);
  }

  async moveWindow(windowId: number, x: number, y: number): Promise<boolean> {
    const res = await this.runHelper<{ ok: boolean }>([
      "window-op",
      "--op", "move",
      "--window-id", String(windowId),
      "--x", String(Math.round(x)),
      "--y", String(Math.round(y)),
    ]).catch(() => ({ ok: false }));
    return Boolean(res?.ok);
  }

  async resizeWindow(windowId: number, width: number, height: number): Promise<boolean> {
    const res = await this.runHelper<{ ok: boolean }>([
      "window-op",
      "--op", "resize",
      "--window-id", String(windowId),
      "--width", String(Math.round(width)),
      "--height", String(Math.round(height)),
    ]).catch(() => ({ ok: false }));
    return Boolean(res?.ok);
  }

  async minimizeWindow(windowId: number): Promise<boolean> {
    const res = await this.runHelper<{ ok: boolean }>([
      "window-op",
      "--op", "minimize",
      "--window-id", String(windowId),
    ]).catch(() => ({ ok: false }));
    return Boolean(res?.ok);
  }

  async maximizeWindow(windowId: number): Promise<boolean> {
    const res = await this.runHelper<{ ok: boolean }>([
      "window-op",
      "--op", "maximize",
      "--window-id", String(windowId),
    ]).catch(() => ({ ok: false }));
    return Boolean(res?.ok);
  }

  async movePointer(x: number, y: number): Promise<ActionResult> {
    await this.runHelper([
      "pointer-op",
      "--op", "move",
      "--x", String(Math.round(x)),
      "--y", String(Math.round(y)),
    ]);
    return {
      ok: true,
      action: "move_pointer",
      action_sent: true,
      receipt: `Dispatched CoreGraphics mouse move to (${x}, ${y})`,
    };
  }

  async click(target: Target, options: ClickOptions = {}): Promise<ActionResult> {
    const button = options.button || "left";
    const clickCount = options.clickCount || 1;
    const strategy = options.strategy || "auto";
    const mods = options.modifiers || [];

    if (target.type === "element") {
      const stateId = target.state_id;
      if (!stateId || !this.activeStates.has(stateId)) {
        throw new StaleHandleError(target.handle ?? target.index ?? "unknown", stateId);
      }

      const { appRef, tree } = this.activeStates.get(stateId)!;
      const resolved = resolveElementWithAmbiguity(tree, target);
      if (resolved.ambiguous) {
        throw new AmbiguousElementError(
          `Target matched ${resolved.count} elements. Specify a unique index or AXIdentifier handle.`,
          []
        );
      }
      if (!resolved.element) {
        throw new ElementNotFoundError(`Element target not found: ${target.handle ?? target.index}`);
      }

      const elem = resolved.element;
      const advertisesAXPress =
        elem.actions.includes("AXPress") ||
        elem.actions.includes("press") ||
        elem.capabilities.includes("pressable");
      const canUseAXPress =
        strategy !== "event" &&
        advertisesAXPress &&
        button === "left" &&
        clickCount === 1 &&
        mods.length === 0 &&
        Array.isArray(elem.ax_path) &&
        appRef.pid;

      // 1. Background-first semantic AXPress ONLY when element truly advertises AXPress
      //    (prevents Qt6 QCocoaAccessibilityElement silent AXError=0 no-ops on AXRaise-only controls)
      if (canUseAXPress) {
        try {
          await this.runHelper([
            "act-element",
            "--pid", String(appRef.pid),
            "--path", JSON.stringify(elem.ax_path),
            "--action", "AXPress",
            "--expected-role", elem.role,
          ]);
          return {
            ok: true,
            action: "click",
            action_sent: true,
            receipt: `Dispatched background AXPress on ${elem.role} "${elem.name}" (pid=${appRef.pid}, zero focus steal)`,
            target,
          };
        } catch (axErr: any) {
          if (axErr instanceof StaleHandleError) {
            throw axErr;
          }
          if (strategy === "a11y") {
            const shortcutHint = elem.description ? ` (hint: ${elem.description})` : "";
            throw new ComputerUseError(
              `Element ${elem.role} "${elem.name}" failed native AXPress${shortcutHint}: ${axErr.message}`,
              "action_unavailable",
              false,
              false
            );
          }
          // Under strategy="auto", fall through to occlusion-verified coordinate click
        }
      } else if (strategy === "a11y") {
        const actsInfo = elem.actions.length > 0 ? elem.actions.join(", ") : "none";
        const shortcutHint = elem.description ? `; ${elem.description}` : "";
        throw new ComputerUseError(
          `Element ${elem.role} "${elem.name}" does not advertise AXPress (actions: [${actsInfo}]${shortcutHint}). Retry with strategy="auto" or "event" when unoccluded.`,
          "action_unavailable",
          false,
          false
        );
      }

      // 2. Occlusion-verified coordinate fallback for controls without native AXPress (e.g. QtWebEngine)
      if (!elem.bounds || elem.bounds.width <= 0 || elem.bounds.height <= 0) {
        throw new ComputerUseError(
          `Element ${elem.role} "${elem.name}" lacks valid screen bounds for coordinate click`,
          "action_unavailable",
          false,
          false
        );
      }

      const targetX = Math.round(elem.bounds.x + elem.bounds.width / 2);
      const targetY = Math.round(elem.bounds.y + elem.bounds.height / 2);
      const coordArgs = [
        "click-coord",
        "--x", String(targetX),
        "--y", String(targetY),
        "--button", button,
        "--count", String(clickCount),
        "--restore-cursor", "1",
      ];
      if (mods.length > 0) {
        coordArgs.push("--modifiers", mods.join(","));
      }
      if (appRef.pid) {
        coordArgs.push("--require-pid", String(appRef.pid));
      }

      await this.runHelper(coordArgs);
      return {
        ok: true,
        action: "click",
        action_sent: true,
        receipt: `Dispatched occlusion-verified ${button} click (${clickCount}x) on ${elem.role} "${elem.name}" at (${targetX}, ${targetY})`,
        target,
      };
    }

    // Coordinate target
    if (strategy === "a11y") {
      throw new ComputerUseError(
        `strategy="a11y" requires an element target`,
        "invalid_argument",
        false,
        false
      );
    }

    const coordArgs = [
      "click-coord",
      "--x", String(target.x),
      "--y", String(target.y),
      "--button", button,
      "--count", String(clickCount),
    ];
    if (mods.length > 0) {
      coordArgs.push("--modifiers", mods.join(","));
    }

    await this.runHelper(coordArgs);
    return {
      ok: true,
      action: "click",
      action_sent: true,
      receipt: `Dispatched CoreGraphics ${button} click (${clickCount}x) at (${target.x}, ${target.y})`,
      target,
    };
  }

  async doubleClick(target: Target, options: ClickOptions = {}): Promise<ActionResult> {
    return this.click(target, { ...options, clickCount: 2 });
  }

  async tripleClick(target: Target, options: ClickOptions = {}): Promise<ActionResult> {
    return this.click(target, { ...options, clickCount: 3 });
  }

  async rightClick(target: Target, options: ClickOptions = {}): Promise<ActionResult> {
    return this.click(target, { ...options, button: "right" });
  }

  async mouseDown(button: "left" | "right" | "middle" = "left"): Promise<ActionResult> {
    await this.runHelper(["pointer-op", "--op", "down", "--button", button]);
    return {
      ok: true,
      action: "mouse_down",
      action_sent: true,
      receipt: `Dispatched CoreGraphics mouse_down (${button})`,
    };
  }

  async mouseUp(button: "left" | "right" | "middle" = "left"): Promise<ActionResult> {
    await this.runHelper(["pointer-op", "--op", "up", "--button", button]);
    return {
      ok: true,
      action: "mouse_up",
      action_sent: true,
      receipt: `Dispatched CoreGraphics mouse_up (${button})`,
    };
  }

  async drag(toX: number, toY: number, fromX?: number, fromY?: number): Promise<ActionResult> {
    const args = [
      "pointer-op",
      "--op", "drag",
      "--to-x", String(Math.round(toX)),
      "--to-y", String(Math.round(toY)),
    ];
    if (fromX !== undefined && fromY !== undefined) {
      args.push("--from-x", String(Math.round(fromX)), "--from-y", String(Math.round(fromY)));
    }
    await this.runHelper(args);
    return {
      ok: true,
      action: "left_click_drag",
      action_sent: true,
      receipt: `Dragged pointer to (${toX}, ${toY})`,
    };
  }

  async scroll(options: ScrollOptions): Promise<ActionResult> {
    const deltaY = options.deltaY ?? (options.direction === "up" ? -100 : options.direction === "down" ? 100 : 0);
    const deltaX = options.deltaX ?? (options.direction === "left" ? -100 : options.direction === "right" ? 100 : 0);

    await this.runHelper([
      "pointer-op",
      "--op", "scroll",
      "--delta-y", String(Math.round(deltaY)),
      "--delta-x", String(Math.round(deltaX)),
    ]);
    return {
      ok: true,
      action: "scroll",
      action_sent: true,
      receipt: `Dispatched CoreGraphics scroll: deltaY=${deltaY}, deltaX=${deltaX}`,
    };
  }

  async typeText(text: string, options?: TypeOptions, target?: Target): Promise<ActionResult> {
    if (target) {
      if (target.type === "element" && options?.strategy !== "event") {
        // Try semantic setValue first if target is editable
        try {
          return await this.setValue(target, text);
        } catch (_) {
          await this.click(target, { strategy: options?.strategy });
          await new Promise((r) => setTimeout(r, 80));
        }
      } else {
        await this.click(target, { strategy: options?.strategy });
        await new Promise((r) => setTimeout(r, 80));
      }
    }

    const resolvedApp = options?.appRef ? await this.resolveAppFromAppRef(options.appRef) : undefined;
    if (options?.strategy === "a11y" && !target) {
      throw new ComputerUseError(
        `type/type_text with strategy="a11y" requires an editable element target (or use set_value)`,
        "action_unavailable",
        false,
        false
      );
    }
    if (options?.strategy === "event" && resolvedApp && !resolvedApp.active) {
      throw new ComputerUseError(
        `Target app "${resolvedApp.name}" (pid=${resolvedApp.pid}) is not frontmost; activate first or omit strategy="event"`,
        "foreground_required",
        false,
        false
      );
    }

    const helperArgs = ["type-unicode", "--text", text];
    const useBackgroundPid = resolvedApp && !resolvedApp.active && options?.strategy !== "event";
    if (useBackgroundPid) {
      helperArgs.push("--pid", String(resolvedApp.pid));
    }

    await this.runHelper(helperArgs);
    return {
      ok: true,
      action: "type_text",
      action_sent: true,
      receipt: useBackgroundPid
        ? `Typed ${text.length} characters via background postToPid=${resolvedApp.pid} (target_active=false)`
        : `Typed ${text.length} characters`,
      target,
    };
  }

  async pressKey(key: string, modifiers: string[] = [], options?: KeyOptions): Promise<ActionResult> {
    if (options?.strategy === "a11y") {
      throw new ComputerUseError(
        `key/press_key does not support strategy="a11y"; use perform_action or strategy="auto"/"event"`,
        "action_unavailable",
        false,
        false
      );
    }

    const resolvedApp = options?.appRef ? await this.resolveAppFromAppRef(options.appRef) : undefined;
    if (options?.strategy === "event" && resolvedApp && !resolvedApp.active) {
      throw new ComputerUseError(
        `Target app "${resolvedApp.name}" (pid=${resolvedApp.pid}) is not frontmost; activate first before strategy="event" key dispatch`,
        "foreground_required",
        false,
        false
      );
    }

    const helperArgs = ["key", "--key", key];
    if (modifiers.length > 0) {
      helperArgs.push("--modifiers", modifiers.join(","));
    }
    if (options?.repeat && options.repeat > 1) {
      helperArgs.push("--repeat", String(options.repeat));
    }
    // When target app is already active/frontmost, use full HID tap so Qt6/WebEngine receives keys reliably;
    // when target app is in the background, use postToPid so user's active window is never polluted.
    const useBackgroundPid = resolvedApp && !resolvedApp.active && options?.strategy !== "event";
    if (useBackgroundPid) {
      helperArgs.push("--pid", String(resolvedApp.pid));
    }

    await this.runHelper(helperArgs);
    const modDesc = modifiers.length ? ` with ${modifiers.join("+")}` : "";
    return {
      ok: true,
      action: "press_key",
      action_sent: true,
      receipt: useBackgroundPid
        ? `Pressed key: ${key}${modDesc} (background postToPid=${resolvedApp.pid}, target_active=false; note Qt6 apps ignore background keys unless active)`
        : `Pressed key: ${key}${modDesc}${resolvedApp ? ` (frontmost pid=${resolvedApp.pid})` : ""}`,
    };
  }

  async hotkey(keys: string[], options?: KeyOptions): Promise<ActionResult> {
    if (keys.length === 0) throw new ComputerUseError("Hotkey requires at least one key", "invalid_argument");
    const mainKey = keys[keys.length - 1];
    const modifiers = keys.slice(0, keys.length - 1);
    return this.pressKey(mainKey, modifiers, options);
  }

  async setValue(target: Target, value: string): Promise<ActionResult> {
    if (target.type !== "element") {
      throw new ComputerUseError("setValue requires an element target", "invalid_argument");
    }
    return this.performElementAction(target, "setValue", value);
  }

  async performAction(target: Target, actionName: string): Promise<ActionResult> {
    if (target.type !== "element") {
      throw new ComputerUseError("performAction requires an element target", "invalid_argument");
    }
    return this.performElementAction(target, actionName);
  }

  private async performElementAction(
    target: { type: "element"; state_id?: string; index?: number; handle?: string },
    action: string,
    value?: string
  ): Promise<ActionResult> {
    const stateId = target.state_id;
    if (!stateId || !this.activeStates.has(stateId)) {
      throw new StaleHandleError(target.handle ?? target.index ?? "unknown", stateId);
    }

    const { appRef, tree } = this.activeStates.get(stateId)!;
    const resolved = resolveElementWithAmbiguity(tree, target);
    if (resolved.ambiguous) {
      throw new AmbiguousElementError(
        `Target matched ${resolved.count} elements. Action rejected to prevent unintended side effects.`,
        []
      );
    }
    if (!resolved.element) {
      throw new ElementNotFoundError(`Element target not found in state ${stateId}`);
    }

    const elem = resolved.element;
    if (!appRef.pid || !Array.isArray(elem.ax_path)) {
      throw new ComputerUseError(
        `Element "${elem.name}" has no native AX path bound in state ${stateId}`,
        "operation_failed"
      );
    }

    const helperArgs = [
      "act-element",
      "--pid", String(appRef.pid),
      "--path", JSON.stringify(elem.ax_path),
      "--action", action,
      "--expected-role", elem.role,
    ];
    if (value !== undefined) {
      helperArgs.push("--value", value);
    }

    await this.runHelper(helperArgs);

    if (action === "setValue") {
      return {
        ok: true,
        action: "set_value",
        action_sent: true,
        receipt: `Set value of ${elem.role} "${elem.name}" to "${value}" (pid=${appRef.pid}, zero focus steal)`,
      };
    }

    return {
      ok: true,
      action: "perform_action",
      action_sent: true,
      receipt: `Executed ${action} on ${elem.role} "${elem.name}" (pid=${appRef.pid}, zero focus steal)`,
    };
  }

  async readClipboard(): Promise<string> {
    const { stdout } = await execFile("pbpaste", []);
    return stdout;
  }

  async writeClipboard(text: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const child = spawn("pbcopy");
      child.stdin.write(text, "utf8");
      child.stdin.end();
      child.on("close", (code) => {
        if (code === 0) resolve(true);
        else reject(new ComputerUseError(`pbcopy exited with code ${code}`, "operation_failed"));
      });
      child.on("error", (err) => reject(new ComputerUseError(`pbcopy failed: ${err.message}`, "operation_failed")));
    });
  }

  async checkPermissions(): Promise<PermissionReport> {
    try {
      const res = await this.runHelper<{ accessibility: boolean; screen_recording: boolean }>(["permissions"], 5000);
      return {
        accessibility: Boolean(res?.accessibility),
        screen_recording: Boolean(res?.screen_recording),
      };
    } catch {
      return { accessibility: false, screen_recording: false };
    }
  }

  async requestAccess(_types?: ("accessibility" | "screen_recording")[]): Promise<PermissionReport> {
    // Strictly read-only per zcode-computer-use contract: never pop System Settings windows
    return this.checkPermissions();
  }
}
