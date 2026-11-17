import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MCPServer, createPlatformAdapter } from "@zov/mcp-server";
import { runDoctor } from "./doctor.js";

function getCliVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
  if (typeof pkg.version !== "string" || !pkg.version) {
    throw new Error("CLI package metadata has no version");
  }
  return pkg.version;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const cmd = argv[0] || "help";

  switch (cmd) {
    case "doctor": {
      const isJson = argv.includes("--json");
      const requireRealGui = argv.includes("--require-real-gui");
      const report = await runDoctor();
      if (isJson) {
        console.log(JSON.stringify(report, null, 2));
        if (requireRealGui && !report.real_gui_ready) {
          process.exit(1);
        }
        if (!report.core_ready) {
          process.exit(1);
        }
        return;
      }

      const isWin = report.checks.os.platform === "win32";
      const helperLabel = isWin ? "Native UIA Helper" : "Native AX Helper";
      const wsLabel = isWin ? "Desktop Window Manager" : "WindowServer";
      const dispLabel = isWin ? "Win32 / GDI Display" : "CoreGraphics Display";
      const editorLabel = isWin ? "Notepad Availability" : "TextEdit Availability";

      console.log("\n=======================================================");
      console.log(" Zov Computer Use (CUA) Diagnostic Doctor Report");
      console.log("=======================================================\n");

      console.log(`[${report.checks.runtime.valid ? "PASS" : "FAIL"}] Node.js Runtime: v${report.checks.runtime.node_version} (>= 20 required)`);
      console.log(`[${report.checks.os.supported ? "PASS" : "WARN"}] Operating System: ${report.checks.os.platform} (${report.checks.os.arch})`);
      console.log(`[${report.checks.environment.native_ax_helper ? "PASS" : "FAIL"}] ${helperLabel}: ${report.checks.environment.native_ax_helper ? "Compiled & Ready" : "Missing (run npm run build)"}`);
      console.log(`[${report.checks.permissions.accessibility ? "PASS" : "WARN"}] Accessibility / UIA Permission: ${report.checks.permissions.accessibility ? "Granted" : "Not Granted / Untrusted"}`);
      console.log(`[${report.checks.permissions.screen_recording ? "PASS" : "WARN"}] Screen Capture Readiness: ${report.checks.permissions.screen_recording ? "Granted" : "Not Granted"}`);
      console.log(`[${report.checks.environment.gui_session ? "PASS" : "WARN"}] GUI Session: ${report.checks.environment.gui_session ? "Active Desktop Session" : "Headless / CI Session"}`);
      console.log(`[${report.checks.environment.window_server ? "PASS" : "WARN"}] ${wsLabel}: ${report.checks.environment.window_server ? "Running" : "Not detected"}`);
      console.log(`[${report.checks.environment.coregraphics_ready ? "PASS" : "WARN"}] ${dispLabel}: ${report.checks.environment.coregraphics_ready ? "Ready" : "Unavailable"}`);
      console.log(`[${report.checks.environment.textedit_available ? "PASS" : "INFO"}] ${editorLabel}: ${report.checks.environment.textedit_available ? "Available (Ready for GUI E2E)" : "Not Found"}`);
      console.log(`[${report.checks.mcp.available ? "PASS" : "FAIL"}] MCP Tool Registry: ${report.checks.mcp.tools_count} standard tools loaded\n`);

      console.log(`Core Engine Status: ${report.core_ready ? "PASS (Ready for Agent automation)" : "FAIL"}`);
      console.log(`Real GUI E2E Status: ${report.real_gui_ready ? "PASS (Ready for Real Desktop GUI E2E)" : "NOT READY"}`);
      if (report.missing_real_gui_prereqs.length > 0) {
        console.log(`Missing Real GUI Prerequisites: ${report.missing_real_gui_prereqs.join(", ")}`);
      }
      console.log(`Overall Health Status: ${report.overall_healthy ? "HEALTHY - Ready for Agent automation" : "ATTENTION REQUIRED"}\n`);

      if (requireRealGui && !report.real_gui_ready) {
        console.error(`\n[cua doctor] Preflight Failed: Missing required real GUI prerequisites: ${report.missing_real_gui_prereqs.join(", ")}`);
        process.exit(1);
      }
      if (!report.core_ready) {
        process.exit(1);
      }
      break;
    }

    case "mcp": {
      const server = new MCPServer();
      server.startStdio();
      break;
    }

    case "list-apps": {
      const adapter = createPlatformAdapter();
      const apps = await adapter.listApps();
      console.log(JSON.stringify(apps, null, 2));
      break;
    }

    case "screenshot": {
      const adapter = createPlatformAdapter();
      const outIdx = argv.indexOf("--output");
      const outPath = outIdx !== -1 && argv[outIdx + 1] ? resolve(argv[outIdx + 1]) : null;

      const shot = await adapter.takeScreenshot();
      if (outPath) {
        await writeFile(outPath, Buffer.from(shot.base64, "base64"));
        console.log(`Screenshot saved to: ${outPath} (${shot.width}x${shot.height})`);
      } else {
        console.log(JSON.stringify({ width: shot.width, height: shot.height, base64_length: shot.base64.length }));
      }
      break;
    }

    case "version":
    case "-v":
    case "--version": {
      console.log(`zov-computer-use v${getCliVersion()}`);
      break;
    }

    case "help":
    case "-h":
    case "--help":
    default: {
      console.log(`
Zov Computer Use CLI (cua) v${getCliVersion()}
Native macOS (AX/CoreGraphics) & Windows (UI Automation/Win32) Computer Use runtime for AI agents.

Usage:
  cua doctor [--json] [--require-real-gui] Run environment, permissions, and tool diagnostics
  cua mcp                                   Start the stdio Model Context Protocol (MCP) server
  cua list-apps                             List running desktop applications
  cua screenshot [--output file]            Take a diagnostic desktop screenshot
  cua version                               Print version info
  cua help                                  Show this help message
`);
      break;
    }
  }
}
