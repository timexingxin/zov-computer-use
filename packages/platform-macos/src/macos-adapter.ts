import { execFile as execFileCallback, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
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
  InvalidArgumentError,
  PermissionDeniedError,
  StaleHandleError,
  TimeoutError,
  WindowNotFoundError,
  assignHandlesToTree,
  resolveElementWithAmbiguity,
} from "@zov/core";

const execFile = promisify(execFileCallback);
const MAX_RETAINED_STATES = 64;
const EDITABLE_ROLES = new Set([
  "textfield",
  "textarea",
  "combobox",
  "searchfield",
  "securetextfield",
]);
const VALID_MODIFIERS = new Set([
  "cmd",
  "command",
  "meta",
  "super",
  "ctrl",
  "control",
  "alt",
  "option",
  "opt",
  "shift",
]);

function assertValidModifiers(modifiers: unknown[], context: string): string[] {
  const out: string[] = [];
  for (const mod of modifiers) {
    if (typeof mod !== "string") {
      throw new InvalidArgumentError(`${context}: modifier must be a string`);
    }
    const norm = mod.trim().toLowerCase();
    if (!VALID_MODIFIERS.has(norm)) {
      throw new InvalidArgumentError(
        `${context}: unrecognized modifier '${mod}' (expected cmd/ctrl/alt/option/shift)`
      );
    }
    out.push(norm);
  }
  return out;
}

function resolveNativeHelperPath(): string {
  const distDir = dirname(fileURLToPath(import.meta.url));
  return join(distDir, "bin", "macos-ax-helper");
}

function assertFiniteCoord(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 100_000) {
    throw new InvalidArgumentError(`${label} must be a finite number within [-100000, 100000]`);
  }
  return value;
}

function isEditableElement(elem: UIElement): boolean {
  return (
    elem.capabilities.includes("editable") ||
    EDITABLE_ROLES.has((elem.role || "").toLowerCase())
  );
}

export class MacOSAdapter implements PlatformAdapter {
  readonly platform = "darwin" as const;
  readonly status = "verified" as const;

  /** @internal */
  public activeStates = new Map<string, { appRef: AppRef; tree: UIElement[] }>();
  /** @internal */
  public helperPath = resolveNativeHelperPath();
  /** @internal */
  public helperArgsPrefix: string[] = [];

  private heldMouseButtons = new Set<"left" | "right" | "middle">();
  private activeChildPids = new Set<number>();
  private activeTempFiles = new Set<string>();

  /** @internal */
  public async runHelper<T>(args: string[], timeoutMs = 15000, isMutating = false): Promise<T> {
    if (!existsSync(this.helperPath)) {
      throw new ComputerUseError(
        `Native macOS AX helper binary not found at ${this.helperPath}. Run 'npm run build' on macOS with Xcode Command Line Tools installed.`,
        "operation_failed",
        false,
        false
      );
    }

    const actionLabel = args[0] || "helper";
    const fullArgs = [...this.helperArgsPrefix, ...args];

    return new Promise<T>((resolve, reject) => {
      const child = spawn(this.helperPath, fullArgs, {
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });

      const pid = child.pid;
      if (pid) this.activeChildPids.add(pid);

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let killEscalationTimer: NodeJS.Timeout | undefined;

      const terminateChildGroup = (sig: NodeJS.Signals) => {
        if (!pid) return;
        try {
          if (process.platform !== "win32") {
            process.kill(-pid, sig);
          } else {
            child.kill(sig);
          }
        } catch {
          try {
            child.kill(sig);
          } catch {}
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        terminateChildGroup("SIGTERM");
        killEscalationTimer = setTimeout(() => terminateChildGroup("SIGKILL"), 250);
        killEscalationTimer.unref?.();
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        if (stdout.length < 16 * 1024 * 1024) {
          stdout += chunk.toString("utf8");
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < 256 * 1024) {
          stderr += chunk.toString("utf8");
        }
      });

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killEscalationTimer) clearTimeout(killEscalationTimer);
        if (pid) this.activeChildPids.delete(pid);
        fn();
      };

      child.on("error", (err) => {
        finish(() => {
          reject(new ComputerUseError(`macOS AX helper failed to spawn: ${err.message}`, "operation_failed", false, false));
        });
      });

      child.on("close", (code, signal) => {
        finish(() => {
          if (timedOut) {
            reject(new TimeoutError(actionLabel, timeoutMs, isMutating));
            return;
          }
          if (signal) {
            reject(
              new ComputerUseError(
                `macOS AX helper terminated by signal ${signal} (${actionLabel})`,
                "operation_cancelled",
                true,
                isMutating
              )
            );
            return;
          }

          const trimmed = stdout.trim();
          if (code === 0) {
            if (!trimmed) {
              resolve(undefined as unknown as T);
              return;
            }
            try {
              resolve(JSON.parse(trimmed) as T);
              return;
            } catch (parseErr: any) {
              reject(
                new ComputerUseError(
                  `Invalid JSON from macOS AX helper (${actionLabel}): ${parseErr.message}`,
                  "operation_failed",
                  false,
                  isMutating
                )
              );
              return;
            }
          }

          if (trimmed) {
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed && typeof parsed === "object" && parsed.error) {
                const errMsg = String(parsed.error);
                switch (parsed.code) {
                  case "stale_handle":
                    reject(new StaleHandleError("ax_path", undefined));
                    return;
                  case "app_not_found":
                    reject(new AppNotFoundError(errMsg));
                    return;
                  case "window_not_found":
                    reject(new WindowNotFoundError(errMsg));
                    return;
                  case "invalid_argument":
                    reject(new InvalidArgumentError(errMsg));
                    return;
                  case "permission_denied":
                    reject(new PermissionDeniedError(errMsg));
                    return;
                  default:
                    reject(new ComputerUseError(errMsg, String(parsed.code || "operation_failed"), false, false));
                    return;
                }
              }
            } catch {
              // Fall through to generic failure below
            }
          }

          const detail = stderr.trim() || trimmed || `exit code ${code ?? "null"}`;
          reject(new ComputerUseError(`macOS AX helper failed (${actionLabel}): ${detail}`, "operation_failed", false, isMutating));
        });
      });
    });
  }

  async releaseHeldInputs(): Promise<void> {
    for (const pid of [...this.activeChildPids]) {
      try {
        if (process.platform !== "win32") {
          process.kill(-pid, "SIGTERM");
        } else {
          process.kill(pid, "SIGTERM");
        }
      } catch {}
      this.activeChildPids.delete(pid);
    }

    for (const tmp of [...this.activeTempFiles]) {
      try {
        unlinkSync(tmp);
      } catch {}
      this.activeTempFiles.delete(tmp);
    }

    const buttons = [...this.heldMouseButtons];
    this.heldMouseButtons.clear();
    await Promise.all(
      buttons.map((btn) =>
        this.runHelper(["pointer-op", "--op", "up", "--button", btn], 600, true).catch(() => {})
      )
    );
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

  private resolveTrackedElement(target: { type: "element"; state_id?: string; index?: number; handle?: string }): {
    appRef: AppRef;
    elem: UIElement;
    stateId: string;
  } {
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
    return { appRef, elem: resolved.element, stateId };
  }

  private async resolveAppFromAppRef(appRef?: AppRef): Promise<AppInfo | undefined> {
    if (!appRef) return undefined;
    const apps = await this.listApps();
    if (typeof appRef.pid === "number" && appRef.pid > 0) {
      const byPid = apps.find((a) => a.pid === appRef.pid);
      if (byPid) return byPid;
      throw new AppNotFoundError(String(appRef.pid));
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
    return this.runHelper<AppInfo[]>(["list-apps"], 10000, false);
  }

  async listWindows(appRef?: AppRef): Promise<WindowInfo[]> {
    if (appRef?.pid) {
      return this.runHelper<WindowInfo[]>(["list-windows", "--pid", String(appRef.pid)], 10000, false);
    }
    const windows = await this.runHelper<WindowInfo[]>(["list-windows"], 10000, false);
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
    }>(helperArgs, 12000, false);

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
      } catch {}
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
    scale_factor: number;
    point_width: number;
    point_height: number;
  }> {
    if (options.window_id !== undefined && options.display_id !== undefined) {
      throw new InvalidArgumentError("Specify either window_id or display_id for screenshot, not both");
    }

    const tempFile = join(tmpdir(), `zov-cap-${randomUUID().slice(0, 8)}.png`);
    const args = ["-x", "-t", "png"];

    if (options.window_id !== undefined) {
      if (!Number.isInteger(options.window_id) || options.window_id <= 0) {
        throw new InvalidArgumentError("window_id must be a positive integer");
      }
      args.push("-l", String(options.window_id));
    } else if (options.display_id !== undefined) {
      if (!Number.isInteger(options.display_id) || options.display_id < 1) {
        throw new InvalidArgumentError("display_id must be a 1-based positive display index");
      }
      args.push("-D", String(options.display_id));
    }
    args.push(tempFile);

    this.activeTempFiles.add(tempFile);
    try {
      await execFile("/usr/sbin/screencapture", args, { timeout: 10000 });
      const buffer = await readFile(tempFile);
      await unlink(tempFile).catch(() => {});
      this.activeTempFiles.delete(tempFile);

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

      const screenInfo = await this.getScreenInfo().catch(() => null);
      let scaleFactor =
        screenInfo?.main_display?.scale && screenInfo.main_display.scale > 0
          ? screenInfo.main_display.scale
          : 2;

      if (options.display_id !== undefined && Array.isArray(screenInfo?.displays_detail)) {
        const byDisp = screenInfo.displays_detail[options.display_id - 1];
        if (byDisp?.scale && byDisp.scale > 0) {
          scaleFactor = byDisp.scale;
        }
      } else if (options.window_id !== undefined && Array.isArray(screenInfo?.displays_detail)) {
        const winList = await this.listWindows().catch(() => []);
        const win = winList.find((w) => w.id === options.window_id);
        if (win?.bounds) {
          const cx = win.bounds.x + win.bounds.width / 2;
          const cy = win.bounds.y + win.bounds.height / 2;
          const matchDisp = screenInfo.displays_detail.find(
            (d) =>
              cx >= d.bounds.x &&
              cx <= d.bounds.x + d.bounds.width &&
              cy >= d.bounds.y &&
              cy <= d.bounds.y + d.bounds.height
          );
          if (matchDisp?.scale && matchDisp.scale > 0) {
            scaleFactor = matchDisp.scale;
          }
        }
      }

      return {
        base64: buffer.toString("base64"),
        width,
        height,
        scale_factor: scaleFactor,
        point_width: Math.round(width / scaleFactor),
        point_height: Math.round(height / scaleFactor),
      };
    } catch (err: any) {
      await unlink(tempFile).catch(() => {});
      this.activeTempFiles.delete(tempFile);
      if (err?.killed || err?.signal === "SIGTERM" || err?.code === "ETIMEDOUT") {
        throw new TimeoutError("screencapture", 10000, false);
      }
      throw new ComputerUseError(`Failed to take screenshot: ${err.message}`, "operation_failed");
    }
  }

  async getScreenInfo(): Promise<{
    displays: number;
    main_display: { width: number; height: number; scale: number; pixel_width?: number; pixel_height?: number };
    displays_detail?: Array<{
      id: number;
      is_main: boolean;
      bounds: { x: number; y: number; width: number; height: number };
      scale: number;
    }>;
    platform: string;
  }> {
    return this.runHelper(["screen-info"], 5000, false);
  }

  async launchApp(nameOrBundleId: string, activate = true): Promise<AppInfo> {
    if (!nameOrBundleId || typeof nameOrBundleId !== "string" || !nameOrBundleId.trim()) {
      throw new InvalidArgumentError("Application name or bundle identifier must be a non-empty string");
    }
    const isBundleId = /^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/.test(nameOrBundleId) && !nameOrBundleId.endsWith(".app");
    const openArgs = isBundleId ? ["-b", nameOrBundleId] : ["-a", nameOrBundleId];
    if (!activate) {
      openArgs.unshift("-g");
    }
    await execFile("open", openArgs, { timeout: 10000 });

    const cleaned = nameOrBundleId.replace(/\.app$/i, "").toLowerCase();
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((r) => setTimeout(r, 250));
      const apps = await this.listApps();
      const app = apps.find(
        (a) =>
          a.name.toLowerCase() === cleaned ||
          a.name.toLowerCase() === nameOrBundleId.toLowerCase() ||
          a.bundle_id?.toLowerCase() === nameOrBundleId.toLowerCase()
      );
      if (app) return app;
    }

    return { pid: 0, name: nameOrBundleId, active: false };
  }

  async focusApp(appRef: AppRef): Promise<boolean> {
    const pid = await this.resolvePidFromAppRef(appRef).catch(() => undefined);
    if (!pid) return false;
    const res = await this.runHelper<{ ok: boolean }>(["focus-app", "--pid", String(pid)], 5000, true);
    return Boolean(res?.ok);
  }

  private assertWindowId(windowId: number): number {
    if (typeof windowId !== "number" || !Number.isInteger(windowId) || windowId <= 0) {
      throw new InvalidArgumentError(`window_id must be a positive integer (got ${String(windowId)})`);
    }
    return windowId;
  }

  async focusWindow(windowId: number): Promise<boolean> {
    this.assertWindowId(windowId);
    const res = await this.runHelper<{ ok: boolean }>(
      ["window-op", "--op", "focus", "--window-id", String(windowId)],
      8000,
      true
    );
    return Boolean(res?.ok);
  }

  async moveWindow(windowId: number, x: number, y: number): Promise<boolean> {
    this.assertWindowId(windowId);
    assertFiniteCoord(x, "x");
    assertFiniteCoord(y, "y");
    const res = await this.runHelper<{ ok: boolean }>(
      ["window-op", "--op", "move", "--window-id", String(windowId), "--x", String(Math.round(x)), "--y", String(Math.round(y))],
      8000,
      true
    );
    return Boolean(res?.ok);
  }

  async resizeWindow(windowId: number, width: number, height: number): Promise<boolean> {
    this.assertWindowId(windowId);
    assertFiniteCoord(width, "width");
    assertFiniteCoord(height, "height");
    if (width <= 10 || height <= 10) {
      throw new InvalidArgumentError("Window width and height must be > 10");
    }
    const res = await this.runHelper<{ ok: boolean }>(
      [
        "window-op",
        "--op",
        "resize",
        "--window-id",
        String(windowId),
        "--width",
        String(Math.round(width)),
        "--height",
        String(Math.round(height)),
      ],
      8000,
      true
    );
    return Boolean(res?.ok);
  }

  async minimizeWindow(windowId: number): Promise<boolean> {
    this.assertWindowId(windowId);
    const res = await this.runHelper<{ ok: boolean }>(
      ["window-op", "--op", "minimize", "--window-id", String(windowId)],
      8000,
      true
    );
    return Boolean(res?.ok);
  }

  async maximizeWindow(windowId: number): Promise<boolean> {
    this.assertWindowId(windowId);
    const res = await this.runHelper<{ ok: boolean }>(
      ["window-op", "--op", "maximize", "--window-id", String(windowId)],
      8000,
      true
    );
    return Boolean(res?.ok);
  }

  async movePointer(x: number, y: number): Promise<ActionResult> {
    assertFiniteCoord(x, "x");
    assertFiniteCoord(y, "y");
    const rx = Math.round(x);
    const ry = Math.round(y);
    await this.runHelper(["pointer-op", "--op", "move", "--x", String(rx), "--y", String(ry)], 5000, true);
    return {
      ok: true,
      action: "move_pointer",
      action_sent: true,
      receipt: `Dispatched CoreGraphics mouse move to (${rx}, ${ry})`,
    };
  }

  async click(target: Target, options: ClickOptions = {}): Promise<ActionResult> {
    const button = options.button || "left";
    const clickCount = options.clickCount ?? 1;
    if (!Number.isInteger(clickCount) || clickCount < 1 || clickCount > 10) {
      throw new InvalidArgumentError("clickCount must be an integer between 1 and 10");
    }
    const strategy = options.strategy || "auto";
    const mods = options.modifiers || [];

    if (target.type === "element") {
      const { appRef, elem } = this.resolveTrackedElement(target);
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
          const axArgs = [
            "act-element",
            "--pid",
            String(appRef.pid),
            "--path",
            JSON.stringify(elem.ax_path),
            "--action",
            "AXPress",
            "--expected-role",
            elem.role,
          ];
          if (elem.identifier) axArgs.push("--expected-identifier", elem.identifier);
          if (elem.name) axArgs.push("--expected-name", elem.name);
          if (!elem.identifier && !elem.name && elem.bounds) {
            axArgs.push(
              "--expected-bounds",
              `${elem.bounds.x},${elem.bounds.y},${elem.bounds.width},${elem.bounds.height}`
            );
          }

          await this.runHelper(axArgs, 8000, true);
          return {
            ok: true,
            action: "click",
            action_sent: true,
            receipt: `Dispatched background AXPress on ${elem.role} "${elem.name}" (pid=${appRef.pid}, zero focus steal)`,
            target,
          };
        } catch (axErr: any) {
          if (
            axErr instanceof StaleHandleError ||
            axErr instanceof TimeoutError ||
            (axErr instanceof ComputerUseError && axErr.actionSent)
          ) {
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
        "--x",
        String(targetX),
        "--y",
        String(targetY),
        "--button",
        button,
        "--count",
        String(clickCount),
        "--restore-cursor",
        "1",
      ];
      if (mods.length > 0) {
        coordArgs.push("--modifiers", mods.join(","));
      }
      if (appRef.pid) {
        coordArgs.push("--require-pid", String(appRef.pid));
      }

      await this.runHelper(coordArgs, 10000, true);
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
      throw new InvalidArgumentError(`strategy="a11y" requires an element target`);
    }

    const cx = Math.round(assertFiniteCoord(target.x, "target.x"));
    const cy = Math.round(assertFiniteCoord(target.y, "target.y"));
    const coordArgs = [
      "click-coord",
      "--x",
      String(cx),
      "--y",
      String(cy),
      "--button",
      button,
      "--count",
      String(clickCount),
    ];
    if (mods.length > 0) {
      coordArgs.push("--modifiers", mods.join(","));
    }

    await this.runHelper(coordArgs, 10000, true);
    return {
      ok: true,
      action: "click",
      action_sent: true,
      receipt: `Dispatched CoreGraphics ${button} click (${clickCount}x) at (${cx}, ${cy})`,
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
    await this.runHelper(["pointer-op", "--op", "down", "--button", button], 5000, true);
    this.heldMouseButtons.add(button);
    return {
      ok: true,
      action: "mouse_down",
      action_sent: true,
      receipt: `Dispatched CoreGraphics mouse_down (${button})`,
    };
  }

  async mouseUp(button: "left" | "right" | "middle" = "left"): Promise<ActionResult> {
    await this.runHelper(["pointer-op", "--op", "up", "--button", button], 5000, true);
    this.heldMouseButtons.delete(button);
    return {
      ok: true,
      action: "mouse_up",
      action_sent: true,
      receipt: `Dispatched CoreGraphics mouse_up (${button})`,
    };
  }

  async drag(toX: number, toY: number, fromX?: number, fromY?: number): Promise<ActionResult> {
    const rToX = Math.round(assertFiniteCoord(toX, "toX"));
    const rToY = Math.round(assertFiniteCoord(toY, "toY"));
    const args = ["pointer-op", "--op", "drag", "--to-x", String(rToX), "--to-y", String(rToY)];
    if (fromX !== undefined || fromY !== undefined) {
      const rFromX = Math.round(assertFiniteCoord(fromX, "fromX"));
      const rFromY = Math.round(assertFiniteCoord(fromY, "fromY"));
      args.push("--from-x", String(rFromX), "--from-y", String(rFromY));
    }
    await this.runHelper(args, 10000, true);
    return {
      ok: true,
      action: "left_click_drag",
      action_sent: true,
      receipt: `Dragged pointer to (${rToX}, ${rToY})`,
    };
  }

  async scroll(options: ScrollOptions): Promise<ActionResult> {
    if (options.target) {
      if (options.target.type === "coordinate") {
        await this.movePointer(options.target.x, options.target.y);
      } else if (options.target.type === "element") {
        const { elem } = this.resolveTrackedElement(options.target);
        if (!elem.bounds || elem.bounds.width <= 0 || elem.bounds.height <= 0) {
          throw new ComputerUseError(
            `Element ${elem.role} "${elem.name}" lacks valid screen bounds for targeted scroll`,
            "action_unavailable",
            false,
            false
          );
        }
        await this.movePointer(
          Math.round(elem.bounds.x + elem.bounds.width / 2),
          Math.round(elem.bounds.y + elem.bounds.height / 2)
        );
      }
    }

    const rawDeltaY =
      options.deltaY ??
      options.delta ??
      (options.direction === "up" ? -100 : options.direction === "down" ? 100 : 0);
    const rawDeltaX =
      options.deltaX ?? (options.direction === "left" ? -100 : options.direction === "right" ? 100 : 0);

    const deltaY = Math.round(assertFiniteCoord(rawDeltaY, "deltaY"));
    const deltaX = Math.round(assertFiniteCoord(rawDeltaX, "deltaX"));

    await this.runHelper(
      ["pointer-op", "--op", "scroll", "--delta-y", String(deltaY), "--delta-x", String(deltaX)],
      5000,
      true
    );
    return {
      ok: true,
      action: "scroll",
      action_sent: true,
      receipt: `Dispatched CoreGraphics scroll: deltaY=${deltaY}, deltaX=${deltaX}`,
    };
  }

  async typeText(text: string, options?: TypeOptions, target?: Target): Promise<ActionResult> {
    if (target) {
      if (target.type === "element") {
        const { elem } = this.resolveTrackedElement(target);
        if (!isEditableElement(elem)) {
          throw new ComputerUseError(
            `Target element ${elem.role} "${elem.name}" is not editable; refusing to click non-editable control during typeText`,
            "not_settable",
            false,
            false
          );
        }

        if (options?.strategy !== "event") {
          try {
            return await this.setValue(target, text);
          } catch (setErr: any) {
            if (setErr instanceof StaleHandleError || setErr instanceof TimeoutError || options?.strategy === "a11y") {
              throw setErr;
            }
            // Editable custom control rejected AXValue write; focus element via click then type
            await this.click(target, { strategy: options?.strategy });
            await new Promise((r) => setTimeout(r, 80));
          }
        } else {
          await this.click(target, { strategy: "event" });
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

    if (options?.clearFirst) {
      await this.pressKey("a", ["cmd"], { appRef: options?.appRef, strategy: options?.strategy });
      await this.pressKey("backspace", [], { appRef: options?.appRef, strategy: options?.strategy });
    }

    const helperArgs = ["type-unicode", "--text", text];
    const useBackgroundPid = resolvedApp && !resolvedApp.active && options?.strategy !== "event";
    if (useBackgroundPid) {
      helperArgs.push("--pid", String(resolvedApp.pid));
    }

    const dynamicTimeoutMs = Math.min(60000, Math.max(15000, text.length * 8 + 5000));
    await this.runHelper(helperArgs, dynamicTimeoutMs, true);
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
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidArgumentError("key must be a non-empty string");
    }
    if (!Array.isArray(modifiers)) {
      throw new InvalidArgumentError("modifiers must be an array of modifier strings");
    }
    const cleanModifiers = assertValidModifiers(modifiers, "pressKey");

    if (options?.strategy === "a11y") {
      throw new ComputerUseError(
        `key/press_key does not support strategy="a11y"; use perform_action or strategy="auto"/"event"`,
        "action_unavailable",
        false,
        false
      );
    }

    if (options?.repeat !== undefined && (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 100)) {
      throw new InvalidArgumentError("repeat must be an integer between 1 and 100");
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
    if (cleanModifiers.length > 0) {
      helperArgs.push("--modifiers", cleanModifiers.join(","));
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

    await this.runHelper(helperArgs, 15000, true);
    const modDesc = cleanModifiers.length ? ` with ${cleanModifiers.join("+")}` : "";
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
    if (!Array.isArray(keys) || keys.length === 0) {
      throw new InvalidArgumentError("Hotkey requires at least one key");
    }
    for (const k of keys) {
      if (typeof k !== "string" || k.length === 0) {
        throw new InvalidArgumentError("Every key in hotkey 'keys' array must be a non-empty string");
      }
    }
    const mainKey = keys[keys.length - 1];
    const modifiers = keys.slice(0, keys.length - 1);
    return this.pressKey(mainKey, modifiers, options);
  }

  async setValue(target: Target, value: string): Promise<ActionResult> {
    if (target.type !== "element") {
      throw new InvalidArgumentError("setValue requires an element target");
    }
    return this.performElementAction(target, "setValue", value);
  }

  async performAction(target: Target, actionName: string): Promise<ActionResult> {
    if (target.type !== "element") {
      throw new InvalidArgumentError("performAction requires an element target");
    }
    return this.performElementAction(target, actionName);
  }

  private async performElementAction(
    target: { type: "element"; state_id?: string; index?: number; handle?: string },
    action: string,
    value?: string
  ): Promise<ActionResult> {
    const { appRef, elem, stateId } = this.resolveTrackedElement(target);
    if (!appRef.pid || !Array.isArray(elem.ax_path)) {
      throw new ComputerUseError(
        `Element "${elem.name}" has no native AX path bound in state ${stateId}`,
        "operation_failed"
      );
    }

    const helperArgs = [
      "act-element",
      "--pid",
      String(appRef.pid),
      "--path",
      JSON.stringify(elem.ax_path),
      "--action",
      action,
      "--expected-role",
      elem.role,
    ];
    if (elem.identifier) {
      helperArgs.push("--expected-identifier", elem.identifier);
    }
    if (elem.name) {
      helperArgs.push("--expected-name", elem.name);
    }
    if (!elem.identifier && !elem.name && elem.bounds) {
      helperArgs.push(
        "--expected-bounds",
        `${elem.bounds.x},${elem.bounds.y},${elem.bounds.width},${elem.bounds.height}`
      );
    }
    if (value !== undefined) {
      helperArgs.push("--value", value);
    }

    await this.runHelper(helperArgs, 8000, true);

    if (action === "setValue") {
      return {
        ok: true,
        action: "set_value",
        action_sent: true,
        receipt: `Set value of ${elem.role} "${elem.name}" (${(value ?? "").length} chars, pid=${appRef.pid}, zero focus steal)`,
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
    const { stdout } = await execFile("pbpaste", [], { timeout: 5000 });
    return stdout;
  }

  async writeClipboard(text: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const child = spawn("pbcopy");
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new TimeoutError("pbcopy", 5000, true));
      }, 5000);
      child.stdin.write(text, "utf8");
      child.stdin.end();
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(true);
        else reject(new ComputerUseError(`pbcopy exited with code ${code}`, "operation_failed"));
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new ComputerUseError(`pbcopy failed: ${err.message}`, "operation_failed"));
      });
    });
  }

  async checkPermissions(): Promise<PermissionReport> {
    try {
      const res = await this.runHelper<{ accessibility: boolean; screen_recording: boolean }>(["permissions"], 5000, false);
      return {
        accessibility: Boolean(res?.accessibility),
        screen_recording: Boolean(res?.screen_recording),
      };
    } catch {
      return { accessibility: false, screen_recording: false };
    }
  }

  async requestAccess(_types?: ("accessibility" | "screen_recording")[]): Promise<PermissionReport> {
    // Strictly read-only per zov-computer-use contract: never pop System Settings windows
    return this.checkPermissions();
  }
}
