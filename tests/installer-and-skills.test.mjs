import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MCPServer } from "../packages/mcp-server/dist/index.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test("Subagent metadata guard returns SUBAGENT_COMPUTER_USE_UNAVAILABLE", async () => {
  const server = new MCPServer();
  const res = await server.handleCallTool(
    "request_access",
    {},
    { "com.zcode/request-context": { runtime_scope: "subagent" } }
  );
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent?.code, "SUBAGENT_COMPUTER_USE_UNAVAILABLE");
});

test("Atomic return_state='compact' refreshes state in a single roundtrip", async () => {
  let stateCounter = 1;
  const mockAdapter = {
    platform: "darwin",
    async getAppState(appRef) {
      return {
        state_id: `s_atomic_${stateCounter++}`,
        app: { pid: appRef?.pid || 42, name: "Notes", active: true },
        tree: [
          {
            index: 0,
            handle: "h_new_note",
            role: "button",
            name: "New Note",
            capabilities: ["pressable"],
            actions: ["AXPress"],
          },
        ],
        element_count: 1,
        timestamp: Date.now(),
      };
    },
    async click(target) {
      return { ok: true, action: "click", action_sent: true, target };
    },
  };

  const server = new MCPServer(mockAdapter);
  const initialRes = await server.handleCallTool("get_app_state", {
    app_ref: { pid: 42, name: "Notes" },
    detail: "compact",
  });
  const initialState = JSON.parse(initialRes.content[0].text);
  assert.equal(initialState.state_id, "s_atomic_1");

  const clickRes = await server.handleCallTool("left_click", {
    target: { type: "element", state_id: "s_atomic_1", index: 0 },
    return_state: "compact",
  });
  assert.equal(clickRes.isError, undefined);
  const clickPayload = JSON.parse(clickRes.content[0].text);
  assert.equal(clickPayload.ok, true);
  assert.equal(clickPayload.compact_state?.state_id, "s_atomic_2");
});

test("Turnkey installer deploys skills, open-source MCP runtime, runs live stdio probe, and uninstalls cleanly", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "macos-cua-kit-e2e-"));
  try {
    // Seed an existing MCP server to ensure non-destructive config merge
    const agyConfigDir = join(fakeHome, ".gemini", "config");
    mkdirSync(agyConfigDir, { recursive: true });
    const mcpCfgPath = join(agyConfigDir, "mcp_config.json");
    writeFileSync(
      mcpCfgPath,
      JSON.stringify(
        {
          mcpServers: {
            "existing-user-server": { command: "echo", args: ["keep-me"] },
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    // 1. Run full turnkey install (including real Python stdio rpc_probe.py --guard!)
    const out = execFileSync(
      process.execPath,
      [join(repoRoot, "scripts", "install.mjs"), "--home", fakeHome, "--client", "all", "--mode", "open"],
      { cwd: repoRoot, encoding: "utf-8" }
    );
    assert.match(out, /"status":\s*"PASS"/, "Live rpc_probe.py handshake + guard must PASS");

    // 2. Verify skills and merged config
    assert.ok(existsSync(join(agyConfigDir, "skills", "computer-use-orchestrator", "SKILL.md")));
    assert.ok(existsSync(join(agyConfigDir, "skills", "zcode-computer-use", "SKILL.md")));
    assert.ok(existsSync(join(agyConfigDir, "skills", "zcode-computer-use", "scripts", "rpc_probe.py")));
    assert.ok(existsSync(join(fakeHome, ".claude", "skills", "computer-use-orchestrator", "SKILL.md")));
    assert.ok(existsSync(join(fakeHome, ".cursor", "skills", "zcode-computer-use", "SKILL.md")));

    const mergedCfg = JSON.parse(readFileSync(mcpCfgPath, "utf-8"));
    assert.deepEqual(mergedCfg.mcpServers["existing-user-server"], { command: "echo", args: ["keep-me"] });
    assert.ok(mergedCfg.mcpServers["zcode-cua"], "zcode-cua server must be registered");

    // 3. Verify clean uninstall preserves user's pre-existing servers
    execFileSync(
      process.execPath,
      [join(repoRoot, "scripts", "install.mjs"), "--home", fakeHome, "--client", "all", "--uninstall"],
      { cwd: repoRoot, encoding: "utf-8" }
    );

    assert.equal(existsSync(join(agyConfigDir, "skills", "computer-use-orchestrator")), false);
    assert.equal(existsSync(join(agyConfigDir, "skills", "zcode-computer-use")), false);
    const afterUninstallCfg = JSON.parse(readFileSync(mcpCfgPath, "utf-8"));
    assert.equal(afterUninstallCfg.mcpServers["zcode-cua"], undefined);
    assert.deepEqual(afterUninstallCfg.mcpServers["existing-user-server"], { command: "echo", args: ["keep-me"] });
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});
