#!/usr/bin/env node
/**
 * ZCode CUA MCP Bridge (Background Zero-Focus Mode)
 *
 * Bridges a locally installed ZCode computer-use plugin (zcode-cua MCP server)
 * into any MCP host (Antigravity, Claude Code, Cursor) with full lifecycle
 * management of the native Helper daemon.
 *
 * Architecture & Safety Guarantees:
 * - Automatically re-executes under code-signed ZCode.app binary on macOS to satisfy Helper verification.
 * - Dynamically resolves installed ZCode plugin versions (with optional strict pinning).
 * - Generates cryptographically secure per-session token (mode 0600) and user-owned Unix socket.
 * - Performs immediate one-shot broker_info claim to lift the 90s startup watchdog.
 * - Keeps stdout strictly pure for MCP JSON-RPC; routes all diagnostics to stderr.
 * - Cleans up child daemons and temporary sockets on SIGINT, SIGTERM, SIGHUP, and stdin EOF.
 */

import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function resolveZCodeBinary() {
  if (process.env.ZCODE_APP_PATH) {
    const custom = process.env.ZCODE_APP_PATH.trim();
    const bin = custom.endsWith(".app") ? join(custom, "Contents/MacOS/ZCode") : custom;
    if (existsSync(bin)) return bin;
  }
  const candidates = [
    "/Applications/ZCode.app/Contents/MacOS/ZCode",
    join(homedir(), "Applications/ZCode.app/Contents/MacOS/ZCode"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

const ZCODE_APP_BINARY = resolveZCodeBinary();
const PREFERRED_PLUGIN_VERSION = process.env.ZCODE_CUA_PINNED_VERSION || "0.5.14";

// ---------------------------------------------------------------------------
// 1. Re-exec Guard: Ensure process runs under code-signed ZCode executable
// ---------------------------------------------------------------------------
if (process.platform === "darwin") {
  const isSignedZCode = process.execPath === ZCODE_APP_BINARY && process.env.ELECTRON_RUN_AS_NODE === "1";
  if (!isSignedZCode && existsSync(ZCODE_APP_BINARY)) {
    const currentScript = fileURLToPath(import.meta.url);
    const child = spawn(ZCODE_APP_BINARY, [currentScript, ...process.argv.slice(2)], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: "inherit",
    });

    child.on("exit", (code, signal) => {
      process.exit(code ?? (signal ? 1 : 0));
    });

    child.on("error", (err) => {
      process.stderr.write(`[zcode-cua-bridge] Failed to spawn ZCode runner: ${err.message}\n`);
      process.exit(1);
    });

    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(sig, () => {
        if (!child.killed) {
          try {
            child.kill(sig);
          } catch {}
        }
      });
    }

    await new Promise(() => {});
  }
}

// ---------------------------------------------------------------------------
// 2. Version & Path Discovery
// ---------------------------------------------------------------------------
function compareSemverLike(a, b) {
  const pa = a.split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = b.split(/[^0-9]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return a.localeCompare(b);
}

function resolvePluginDir() {
  if (process.env.ZCODE_CUA_PLUGIN_DIR) {
    return process.env.ZCODE_CUA_PLUGIN_DIR.trim();
  }

  const cacheBase = join(homedir(), ".zcode/cli/plugins/cache/zcode-plugins-official/computer-use");
  if (!existsSync(cacheBase)) {
    throw new Error(`ZCode computer-use plugin cache not found: ${cacheBase}`);
  }

  const versions = readdirSync(cacheBase).filter((name) => {
    try {
      return (
        statSync(join(cacheBase, name)).isDirectory() &&
        existsSync(join(cacheBase, name, "dist/mcp/server.js"))
      );
    } catch {
      return false;
    }
  });

  if (versions.length === 0) {
    throw new Error(`No valid computer-use plugin versions found in ${cacheBase}`);
  }

  if (versions.includes(PREFERRED_PLUGIN_VERSION)) {
    return join(cacheBase, PREFERRED_PLUGIN_VERSION);
  }

  if (process.env.ZCODE_CUA_STRICT_VERSION === "1") {
    throw new Error(
      `Pinned plugin version "${PREFERRED_PLUGIN_VERSION}" not found in ${cacheBase}. Found: [${versions.join(", ")}].`
    );
  }

  versions.sort(compareSemverLike);
  const newest = versions[versions.length - 1];
  process.stderr.write(
    `[zcode-cua-bridge] Using discovered ZCode CUA plugin version "${newest}".\n`
  );
  return join(cacheBase, newest);
}

function resolveHelperExecutable() {
  if (process.env.ZCODE_CUA_HELPER_APP) {
    const custom = process.env.ZCODE_CUA_HELPER_APP.trim();
    const exec = join(custom, "Contents/MacOS/ZCode Computer Use");
    if (existsSync(exec)) return exec;
    throw new Error(`Custom ZCODE_CUA_HELPER_APP executable not found: ${exec}`);
  }

  const candidates = [
    join(homedir(), ".zcode/computer-use/ZCode Computer Use.app/Contents/MacOS/ZCode Computer Use"),
    "/Applications/ZCode.app/Contents/Resources/cua-helper/ZCode Computer Use.app/Contents/MacOS/ZCode Computer Use",
    join(homedir(), "Applications/ZCode.app/Contents/Resources/cua-helper/ZCode Computer Use.app/Contents/MacOS/ZCode Computer Use"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  throw new Error("ZCode Computer Use helper executable not found in ~/.zcode or ZCode.app");
}

const pluginDir = resolvePluginDir();
const serverJsPath = join(pluginDir, "dist/mcp/server.js");
if (!existsSync(serverJsPath)) {
  throw new Error(`MCP server entrypoint not found: ${serverJsPath}`);
}
const helperExecutable = resolveHelperExecutable();

// ---------------------------------------------------------------------------
// 3. Temporary Socket and One-Shot Token Initialization
// ---------------------------------------------------------------------------
const sessionId = randomUUID().slice(0, 8);
const socketPath = join(tmpdir(), `zcode-cua-${sessionId}.sock`);
const tokenFilePath = join(tmpdir(), `zcode-cua-token-${sessionId}.txt`);
const token = randomBytes(32).toString("hex");

await writeFile(tokenFilePath, token, { mode: 0o600 });

let helperProc = null;
let mcpProc = null;
let isShuttingDown = false;

async function cleanup() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const procsToKill = [];
  if (mcpProc && !mcpProc.killed) {
    try {
      mcpProc.kill("SIGTERM");
      procsToKill.push(mcpProc);
    } catch {}
  }

  if (helperProc && !helperProc.killed) {
    try {
      helperProc.kill("SIGTERM");
      procsToKill.push(helperProc);
    } catch {}
  }

  if (procsToKill.length > 0) {
    await Promise.race([
      Promise.all(
        procsToKill.map((p) =>
          p.exitCode !== null || p.signalCode !== null
            ? Promise.resolve()
            : new Promise((resolve) => p.once("exit", resolve))
        )
      ),
      new Promise((resolve) => setTimeout(resolve, 600)),
    ]);
    for (const p of procsToKill) {
      if (p.exitCode === null && p.signalCode === null) {
        try {
          p.kill("SIGKILL");
        } catch {}
      }
    }
  }

  try { rmSync(tokenFilePath, { force: true }); } catch {}
  try { rmSync(socketPath, { force: true }); } catch {}
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, async () => {
    await cleanup();
    process.exit(0);
  });
}
process.on("exit", () => {
  void cleanup();
});
process.on("uncaughtException", async (err) => {
  process.stderr.write(`[zcode-cua-bridge] Uncaught exception: ${err.stack || err.message}\n`);
  await cleanup();
  process.exit(1);
});
process.on("unhandledRejection", async (reason) => {
  process.stderr.write(`[zcode-cua-bridge] Unhandled rejection: ${reason}\n`);
  await cleanup();
  process.exit(1);
});
process.stdin.on("end", () => {
  void cleanup().then(() => process.exit(0));
});
process.stdin.on("close", () => {
  void cleanup().then(() => process.exit(0));
});

// ---------------------------------------------------------------------------
// 4. Launch Native Helper Daemon
// ---------------------------------------------------------------------------
const helperArgs = [
  "--socket", socketPath,
  "--token-file", tokenFilePath,
  "--launcher-pid", String(process.pid),
];

helperProc = spawn(helperExecutable, helperArgs, {
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});

helperProc.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

helperProc.stdout.on("data", () => {});

helperProc.on("error", (err) => {
  process.stderr.write(`[zcode-cua-bridge] Helper process error: ${err.message}\n`);
  void cleanup().then(() => process.exit(1));
});

helperProc.on("exit", (code, signal) => {
  if (!isShuttingDown) {
    process.stderr.write(
      `[zcode-cua-bridge] Helper exited unexpectedly (code: ${code}, signal: ${signal})\n`
    );
    void cleanup().then(() => process.exit(code ?? 1));
  }
});

// ---------------------------------------------------------------------------
// 5. Poll Socket Readiness & Execute broker_info Claim
// ---------------------------------------------------------------------------
async function waitForSocket(path, timeoutMs = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) {
      try {
        await new Promise((resolve, reject) => {
          const s = createConnection(path);
          s.once("connect", () => {
            s.destroy();
            resolve();
          });
          s.once("error", reject);
        });
        return true;
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

const isSocketReady = await waitForSocket(socketPath);
if (!isSocketReady) {
  process.stderr.write(`[zcode-cua-bridge] Timeout waiting for CUA broker socket at ${socketPath}\n`);
  await cleanup();
  process.exit(1);
}

async function performBrokerClaim() {
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath);
    let buf = "";

    const claimTimeout = setTimeout(() => {
      client.destroy();
      reject(new Error("Claim timeout waiting for broker_info reply"));
    }, 5000);

    client.on("connect", () => {
      client.write(JSON.stringify({ id: 0, method: "authenticate", params: { token } }) + "\n");
    });

    client.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (!line.trim()) continue;

        try {
          const msg = JSON.parse(line);
          if (msg.id === 0 && msg.ok) {
            client.write(JSON.stringify({ id: 1, method: "broker_info", params: {} }) + "\n");
          } else if (msg.id === 1 && msg.ok) {
            clearTimeout(claimTimeout);
            client.destroy();
            resolve(msg.result);
            return;
          } else if (!msg.ok) {
            clearTimeout(claimTimeout);
            client.destroy();
            reject(new Error(`Broker claim failed: ${msg.error?.message || JSON.stringify(msg)}`));
            return;
          }
        } catch (err) {
          clearTimeout(claimTimeout);
          client.destroy();
          reject(err);
          return;
        }
      }
    });

    client.on("error", (err) => {
      clearTimeout(claimTimeout);
      reject(err);
    });
  });
}

try {
  const brokerInfo = await performBrokerClaim();
  process.stderr.write(
    `[zcode-cua-bridge] Connected to ZCode CUA Helper (v${brokerInfo.version}, pid: ${brokerInfo.pid}). Watchdog claimed.\n`
  );
} catch (err) {
  process.stderr.write(`[zcode-cua-bridge] Initial claim failed: ${err.message}\n`);
  await cleanup();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 6. Launch MCP Server Child and Bridge Stdio
// ---------------------------------------------------------------------------
const mcpArgs = [serverJsPath, "--permission-broker-socket", socketPath];
const mcpEnv = {
  ...process.env,
  ZCODE_CUA_PERMISSION_BROKER_TOKEN: token,
  ELECTRON_RUN_AS_NODE: "1",
};

mcpProc = spawn(process.execPath, mcpArgs, {
  stdio: ["pipe", "pipe", "inherit"],
  env: mcpEnv,
});

process.stdin.pipe(mcpProc.stdin);
mcpProc.stdout.pipe(process.stdout);

mcpProc.on("exit", async (code, signal) => {
  await cleanup();
  process.exit(code ?? (signal ? 1 : 0));
});

mcpProc.on("error", async (err) => {
  process.stderr.write(`[zcode-cua-bridge] Failed to spawn MCP server: ${err.message}\n`);
  await cleanup();
  process.exit(1);
});
