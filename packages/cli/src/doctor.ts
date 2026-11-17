import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type PlatformAdapter } from "@zov/core";
import { createPlatformAdapter, TOOLS_MANIFEST } from "@zov/mcp-server";

export interface DoctorReport {
  timestamp: string;
  overall_healthy: boolean;
  core_ready: boolean;
  real_gui_ready: boolean;
  missing_real_gui_prereqs: string[];
  checks: {
    runtime: {
      node_version: string;
      valid: boolean;
    };
    os: {
      platform: string;
      arch: string;
      supported: boolean;
    };
    permissions: {
      accessibility: boolean;
      screen_recording: boolean;
    };
    environment: {
      native_ax_helper: boolean;
      gui_session: boolean;
      window_server: boolean;
      coregraphics_ready: boolean;
      textedit_available: boolean;
    };
    mcp: {
      tools_count: number;
      available: boolean;
    };
  };
}

export async function runDoctor(customAdapter?: PlatformAdapter): Promise<DoctorReport> {
  const adapter = customAdapter || createPlatformAdapter();
  const isDarwin = adapter.platform === "darwin";
  const isWin32 = adapter.platform === "win32";

  const helperPath = typeof (adapter as any).helperPath === "string" ? (adapter as any).helperPath : undefined;
  const nativeAxHelperReady =
    isDarwin || isWin32 ? Boolean(helperPath && existsSync(helperPath)) : false;

  const perms = nativeAxHelperReady
    ? await adapter.checkPermissions().catch(() => ({
        accessibility: false,
        screen_recording: false,
      }))
    : { accessibility: false, screen_recording: false };

  let windowServerAlive = false;
  let guiSessionActive = false;
  let coregraphicsReady = false;
  let editorAvailable = false;

  if (process.platform === "darwin" && isDarwin) {
    try {
      const { execFileSync } = await import("node:child_process");
      try {
        execFileSync("pgrep", ["-x", "WindowServer"], { stdio: "ignore", timeout: 3000 });
        windowServerAlive = true;
      } catch {}

      if (nativeAxHelperReady) {
        const screenInfo = await adapter.getScreenInfo?.().catch(() => null);
        coregraphicsReady = Boolean(
          screenInfo && screenInfo.main_display.width > 0 && screenInfo.main_display.height > 0
        );
      }
      guiSessionActive =
        windowServerAlive &&
        coregraphicsReady &&
        !process.env.CI &&
        !process.env.GITHUB_ACTIONS;

      const textEditCandidates = [
        "/System/Applications/TextEdit.app",
        "/Applications/TextEdit.app",
        join(homedir(), "Applications/TextEdit.app"),
      ];
      editorAvailable = textEditCandidates.some((p) => existsSync(p));
    } catch {}
  } else if (process.platform === "win32" && isWin32) {
    try {
      if (nativeAxHelperReady) {
        const screenInfo = await adapter.getScreenInfo?.().catch(() => null);
        coregraphicsReady = Boolean(
          screenInfo && screenInfo.main_display.width > 0 && screenInfo.main_display.height > 0
        );
        windowServerAlive = coregraphicsReady;
      }
      guiSessionActive =
        windowServerAlive &&
        coregraphicsReady &&
        !process.env.CI &&
        !process.env.GITHUB_ACTIONS;

      const windir = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
      const notepadCandidates = [
        join(windir, "System32", "notepad.exe"),
        join(windir, "notepad.exe"),
      ];
      editorAvailable = notepadCandidates.some((p) => existsSync(p));
    } catch {}
  }

  const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
  const runtimeValid = nodeMajor >= 20;
  const osSupported = ["darwin", "win32"].includes(process.platform);
  const mcpValid = TOOLS_MANIFEST.length >= 47;

  const coreReady =
    runtimeValid &&
    mcpValid &&
    (["darwin", "win32"].includes(process.platform) ? nativeAxHelperReady : true);

  const missingRealGui: string[] = [];
  if (!osSupported) missingRealGui.push("supported_desktop_os");
  if (!nativeAxHelperReady) missingRealGui.push("native_ax_helper");
  if (!guiSessionActive) missingRealGui.push("interactive_gui");
  if (!windowServerAlive) missingRealGui.push("window_server");
  if (!perms.accessibility) missingRealGui.push("accessibility");
  if (!perms.screen_recording) missingRealGui.push("screen_recording");
  if (!coregraphicsReady) missingRealGui.push(isWin32 ? "display_gdi" : "coregraphics");
  if (!editorAvailable) missingRealGui.push(isWin32 ? "notepad" : "textedit");

  const realGuiReady = coreReady && missingRealGui.length === 0;

  return {
    timestamp: new Date().toISOString(),
    overall_healthy: coreReady,
    core_ready: coreReady,
    real_gui_ready: realGuiReady,
    missing_real_gui_prereqs: missingRealGui,
    checks: {
      runtime: {
        node_version: process.versions.node,
        valid: runtimeValid,
      },
      os: {
        platform: process.platform,
        arch: process.arch,
        supported: osSupported,
      },
      permissions: {
        accessibility: perms.accessibility,
        screen_recording: perms.screen_recording,
      },
      environment: {
        native_ax_helper: nativeAxHelperReady,
        gui_session: guiSessionActive,
        window_server: windowServerAlive,
        coregraphics_ready: coregraphicsReady,
        textedit_available: editorAvailable,
      },
      mcp: {
        tools_count: TOOLS_MANIFEST.length,
        available: mcpValid,
      },
    },
  };
}
