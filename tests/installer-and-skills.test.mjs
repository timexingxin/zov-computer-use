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
    { "com.zov/request-context": { runtime_scope: "subagent" } }
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

test("Turnkey installer deploys zov-computer-use skills, native MCP runtime, runs live stdio probe, and uninstalls cleanly", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "zov-cua-e2e-"));
  try {
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

    const out = execFileSync(
      process.execPath,
      [join(repoRoot, "scripts", "install.mjs"), "--home", fakeHome, "--client", "all"],
      { cwd: repoRoot, encoding: "utf-8" }
    );
    assert.match(out, /"status":\s*"PASS"/, "Live rpc_probe.py handshake + guard must PASS");

    assert.ok(existsSync(join(agyConfigDir, "skills", "computer-use-orchestrator", "SKILL.md")));
    assert.ok(existsSync(join(agyConfigDir, "skills", "zov-computer-use", "SKILL.md")));
    assert.ok(existsSync(join(agyConfigDir, "skills", "zov-computer-use", "scripts", "rpc_probe.py")));
    assert.ok(existsSync(join(fakeHome, ".claude", "skills", "computer-use-orchestrator", "SKILL.md")));
    assert.ok(existsSync(join(fakeHome, ".cursor", "skills", "zov-computer-use", "SKILL.md")));

    const mergedCfg = JSON.parse(readFileSync(mcpCfgPath, "utf-8"));
    assert.deepEqual(mergedCfg.mcpServers["existing-user-server"], { command: "echo", args: ["keep-me"] });
    assert.ok(mergedCfg.mcpServers["zov-cua"], "zov-cua server must be registered");

    execFileSync(
      process.execPath,
      [join(repoRoot, "scripts", "install.mjs"), "--home", fakeHome, "--client", "all", "--uninstall"],
      { cwd: repoRoot, encoding: "utf-8" }
    );

    assert.equal(existsSync(join(agyConfigDir, "skills", "computer-use-orchestrator")), false);
    assert.equal(existsSync(join(agyConfigDir, "skills", "zov-computer-use")), false);
    const afterUninstallCfg = JSON.parse(readFileSync(mcpCfgPath, "utf-8"));
    assert.equal(afterUninstallCfg.mcpServers["zov-cua"], undefined);
    assert.deepEqual(afterUninstallCfg.mcpServers["existing-user-server"], { command: "echo", args: ["keep-me"] });
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("Installer honors --preserve-skills without overwriting customized SKILL.md", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "zov-cua-preserve-"));
  try {
    const agySkillsDir = join(fakeHome, ".gemini", "config", "skills", "zov-computer-use");
    mkdirSync(agySkillsDir, { recursive: true });
    const customSkillText = "---\nname: zov-computer-use\ndescription: Custom\n---\nCUSTOM_USER_RULES";
    writeFileSync(join(agySkillsDir, "SKILL.md"), customSkillText, "utf-8");

    const mcpCfgPath = join(fakeHome, ".gemini", "config", "mcp_config.json");
    writeFileSync(mcpCfgPath, "{}", "utf-8");

    execFileSync(
      process.execPath,
      [join(repoRoot, "scripts", "install.mjs"), "--home", fakeHome, "--client", "antigravity", "--preserve-skills", "--skip-probe"],
      { cwd: repoRoot, encoding: "utf-8" }
    );

    const updatedCfg = JSON.parse(readFileSync(mcpCfgPath, "utf-8"));
    const normalizedArg0 = updatedCfg.mcpServers["zov-cua"].args[0].replace(/\\/g, "/");
    assert.ok(normalizedArg0.endsWith("runtime/dist/bin/server.js"));
    assert.equal(readFileSync(join(agySkillsDir, "SKILL.md"), "utf-8"), customSkillText, "Custom SKILL.md must be preserved");
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});
