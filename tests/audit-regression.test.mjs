import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TimeoutError,
  UnsupportedPlatformError,
  assignHandlesToTree,
  computeStateDiff,
} from "../packages/core/dist/index.js";
import { MCPServer, TOOLS_MANIFEST } from "../packages/mcp-server/dist/index.js";
import { MacOSAdapter } from "../packages/platform-macos/dist/index.js";
import { WindowsAdapter } from "../packages/platform-windows/dist/index.js";
import { LinuxAdapter } from "../packages/platform-linux/dist/index.js";
import { runDoctor } from "../packages/cli/dist/index.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test("C1 + R13 + B1: Password redaction holds across full/compact/diff and all return_state paths; set_value receipt hides plaintext", async () => {
  const mockAdapter = {
    platform: "darwin",
    async getAppState() {
      return {
        state_id: "s_login_1",
        app: { pid: 500, name: "AuthApp", active: true },
        tree: [
          {
            index: 0,
            handle: "h_sec",
            role: "textfield",
            subrole: "securetextfield",
            name: "System Password",
            value: "NativeSecret999!",
            capabilities: ["editable"],
            actions: [],
          },
          {
            index: 1,
            handle: "h_web_pwd",
            role: "textfield",
            name: "Account Password",
            value: "WebDomSecret888!",
            capabilities: ["editable"],
            actions: [],
          },
          {
            index: 2,
            handle: "h_cn_pwd",
            role: "textfield",
            description: "请输入登录密码",
            name: "",
            value: "CnSecret777!",
            capabilities: ["editable"],
            actions: [],
          },
        ],
        element_count: 3,
        timestamp: Date.now(),
      };
    },
    async click(target) {
      return { ok: true, action: "click", action_sent: true, receipt: "Clicked", target };
    },
    async typeText() {
      return { ok: true, action: "type_text", action_sent: true, receipt: "Typed" };
    },
    async pressKey() {
      return { ok: true, action: "press_key", action_sent: true, receipt: "Pressed" };
    },
    async setValue(target) {
      return { ok: true, action: "set_value", action_sent: true, receipt: "Set value (redacted)", target };
    },
  };

  const server = new MCPServer(mockAdapter);
  const compactRes = await server.handleCallTool("get_app_state", { app_ref: { pid: 500 }, detail: "compact" });
  for (const secret of ["NativeSecret999!", "WebDomSecret888!", "CnSecret777!"]) {
    assert.ok(!compactRes.content[0].text.includes(secret), `get_app_state(compact) leaked ${secret}`);
  }

  // N-15: Verify detail="diff" also redacts modified password values
  let pwdVersion = 1;
  mockAdapter.getAppState = async () => ({
    state_id: `s_login_diff_${pwdVersion}`,
    app: { pid: 500, name: "AuthApp", active: true },
    tree: [
      {
        index: 0,
        handle: "h_sec",
        role: "textfield",
        subrole: "securetextfield",
        name: "System Password",
        value: pwdVersion++ === 1 ? "UpdatedSecretAlpha!" : "NativeSecret999!",
        capabilities: ["editable"],
        actions: [],
      },
      {
        index: 1,
        handle: "h_web_pwd",
        role: "textfield",
        name: "Account Password",
        value: "WebDomSecret888!",
        capabilities: ["editable"],
        actions: [],
      },
      {
        index: 2,
        handle: "h_cn_pwd",
        role: "textfield",
        description: "请输入登录密码",
        name: "",
        value: "CnSecret777!",
        capabilities: ["editable"],
        actions: [],
      },
    ],
    element_count: 3,
    timestamp: Date.now(),
  });
  const diffRes = await server.handleCallTool("get_app_state", { app_ref: { pid: 500 }, detail: "diff" });
  assert.ok(!diffRes.content[0].text.includes("UpdatedSecretAlpha!"), "detail=diff leaked updated password");
  assert.ok(!diffRes.content[0].text.includes("NativeSecret999!"), "detail=diff leaked original password");

  for (const [tool, callArgs] of [
    ["left_click", { target: { type: "element", state_id: "s_login_1", index: 0 }, return_state: "full" }],
    ["type", { text: "x", app_ref: { pid: 500 }, return_state: "full" }],
    ["key", { text: "tab", app_ref: { pid: 500 }, return_state: "full" }],
    ["set_value", { target: { type: "element", state_id: "s_login_1", index: 1 }, value: "NewPass!", return_state: "full" }],
  ]) {
    const res = await server.handleCallTool(tool, callArgs);
    assert.equal(res.isError, undefined, `${tool} should succeed`);
    for (const secret of ["NativeSecret999!", "WebDomSecret888!", "CnSecret777!"]) {
      assert.ok(!res.content[0].text.includes(secret), `${tool} return_state=full leaked ${secret}`);
    }
  }

  // Verify MacOSAdapter.setValue receipt never echoes plaintext secret
  const realMac = new MacOSAdapter();
  realMac.runHelper = async () => ({ ok: true, ax_error: 0 });
  realMac.activeStates.set("s_val_sec", {
    appRef: { pid: 500, name: "AuthApp" },
    tree: assignHandlesToTree(500, [
      {
        index: 0,
        handle: "",
        role: "securetextfield",
        name: "Password",
        capabilities: ["editable"],
        actions: [],
        ax_path: [0, 1],
      },
    ]),
  });
  const setReceipt = await realMac.setValue({ type: "element", state_id: "s_val_sec", index: 0 }, "TopSecretValue42!");
  assert.ok(!setReceipt.receipt.includes("TopSecretValue42!"), "set_value receipt must never echo plaintext value");
});

test("C2 + B2: Mutating helper timeout throws TimeoutError with actionSent=true; read-only timeout sets actionSent=false", async () => {
  const adapter = new MacOSAdapter();
  const tmpDir = mkdtempSync(join(tmpdir(), "cua-timeout-test-"));
  const slowScript = join(tmpDir, "slow-helper.mjs");
  writeFileSync(slowScript, "setTimeout(() => {}, 4000);\n", "utf-8");
  try {
    adapter.helperPath = process.execPath;
    adapter.helperArgsPrefix = [slowScript];

    await assert.rejects(
      () => adapter.runHelper(["click-coord", "--x", "10", "--y", "10"], 80, true),
      (err) => {
        assert.ok(err instanceof TimeoutError);
        assert.equal(err.code, "timeout");
        assert.equal(err.actionSent, true, "Mutating timeout MUST mark actionSent=true");
        return true;
      }
    );

    await assert.rejects(
      () => adapter.runHelper(["inspect", "--pid", "1"], 80, false),
      (err) => {
        assert.ok(err instanceof TimeoutError);
        assert.equal(err.actionSent, false, "Read-only timeout MUST mark actionSent=false");
        return true;
      }
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("C3 + B12: WindowsAdapter never invokes PowerShell/CMD on injection payloads; unimplemented LinuxAdapter fails closed", async () => {
  const win = new WindowsAdapter();
  const capturedArgv = [];
  const tmpDir = mkdtempSync(join(tmpdir(), "zov-win-argv-"));
  const echoHelper = join(tmpDir, "echo-argv.mjs");
  writeFileSync(
    echoHelper,
    `const args = process.argv.slice(2);
if (args[0] === "list-apps") {
  console.log("[]");
} else {
  console.log(JSON.stringify({ ok: true, pid: 0, argv: args }));
}
`,
    "utf-8"
  );
  try {
    win.helperPath = process.execPath;
    win.helperArgsPrefix = [echoHelper];
    const origRunHelper = win.runHelper.bind(win);
    win.runHelper = async (args, timeoutMs, isMutating) => {
      capturedArgv.push(args);
      return origRunHelper(args, timeoutMs, isMutating);
    };

    const evilPayload = 'calc"; Invoke-Expression "evil"; & calc.exe | powershell -enc AAA';
    await win.launchApp(evilPayload, false);
    assert.deepEqual(capturedArgv[0], ["launch-app", "--target", evilPayload, "--activate", "0"]);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  const linux = new LinuxAdapter();
  await assert.rejects(() => linux.launchApp("gedit"), UnsupportedPlatformError);
  await assert.rejects(() => linux.listApps(), UnsupportedPlatformError);
  await assert.rejects(() => linux.listWindows(), UnsupportedPlatformError);

  const server = new MCPServer(linux);
  for (const [tool, args] of [
    ["launch_app", { name: "gedit" }],
    ["focus_app", { app_ref: { name: "gedit" } }],
  ]) {
    const res = await server.handleCallTool(tool, args);
    assert.equal(res.isError, true);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.code, "unsupported_platform");
    assert.equal(payload.action_sent, false);
  }
});

test("R4 + R5 + R14 + B14: Runtime schema validation rejects NaN/missing coordinates, out-of-range clickCount/repeat/wait, and bad enums", async () => {
  const server = new MCPServer(new MacOSAdapter());

  const invalidCases = [
    ["move_pointer", {}],
    ["move_pointer", { x: Number.NaN, y: 10 }],
    ["click", { target: { type: "coordinate", x: 1e308, y: 10 } }],
    ["click", { target: { type: "coordinate", x: 10, y: 10 }, clickCount: 10000 }],
    ["click", { target: { type: "coordinate", x: 10, y: 10 }, strategy: "telepathy" }],
    ["left_click_drag", {}],
    ["left_click_drag", { toX: 100, toY: 100, fromX: 10 }], // missing fromY
    ["key", { text: "a", repeat: -1 }],
    ["key", { text: "a", repeat: 500 }],
    ["wait", { ms: 999999999 }],
    ["minimize_window", { window_id: 0 }],
  ];

  for (const [tool, badArgs] of invalidCases) {
    const res = await server.handleCallTool(tool, badArgs);
    assert.equal(res.isError, true, `${tool} with ${JSON.stringify(badArgs)} must fail closed`);
    assert.equal(JSON.parse(res.content[0].text).code, "invalid_argument", `${tool} must return invalid_argument`);
  }
});

test("R6 + B6 + B9: clearFirst, scroll.target/delta, and exact element center coordinates are honored", async () => {
  const adapter = new MacOSAdapter();
  const calls = [];
  adapter.runHelper = async (args) => {
    calls.push(args);
    return { ok: true };
  };
  adapter.activeStates.set("s_r6", {
    appRef: { pid: 300, name: "ScrollApp" },
    tree: assignHandlesToTree(300, [
      {
        index: 0,
        handle: "",
        role: "scrollarea",
        name: "DocPane",
        bounds: { x: 100, y: 200, width: 400, height: 300 },
        capabilities: [],
        actions: [],
        ax_path: [0, 0],
      },
    ]),
  });

  // scroll with element target moves to exact center (300, 350) and uses legacy delta
  await adapter.scroll({
    target: { type: "element", state_id: "s_r6", index: 0 },
    delta: 120,
  });
  assert.deepEqual(calls[0], ["pointer-op", "--op", "move", "--x", "300", "--y", "350"]);
  assert.deepEqual(calls[1], ["pointer-op", "--op", "scroll", "--delta-y", "120", "--delta-x", "0"]);

  // clearFirst dispatches cmd+a and backspace before type-unicode
  calls.length = 0;
  await adapter.typeText("fresh", { clearFirst: true });
  assert.deepEqual(calls[0], ["key", "--key", "a", "--modifiers", "cmd"]);
  assert.deepEqual(calls[1], ["key", "--key", "backspace"]);
  assert.deepEqual(calls[2], ["type-unicode", "--text", "fresh"]);
});

test("R7 + R11 + R15 + R18: role filter on click/set_element_value, secondary TOCTOU flags, fake-pid rejection, and non-editable typeText guard", async () => {
  const mockAdapter = {
    platform: "darwin",
    async listApps() {
      return [{ pid: 100, name: "Finder", active: true }];
    },
    async getAppState() {
      return {
        state_id: "s_r7",
        app: { pid: 100, name: "Finder", active: true },
        tree: [
          {
            index: 0,
            handle: "h_txt_save",
            role: "statictext",
            name: "Save changes before closing?",
            capabilities: [],
            actions: [],
          },
        ],
        element_count: 1,
        timestamp: Date.now(),
      };
    },
    async click() {
      throw new Error("Should NOT click statictext when role='button' requested");
    },
    async setValue() {
      throw new Error("Should NOT setValue on statictext when role='textfield' requested");
    },
  };
  const server = new MCPServer(mockAdapter);

  const r7Click = await server.handleCallTool("click_element", { app_ref: { pid: 100 }, name: "Save", role: "button" });
  assert.equal(r7Click.isError, true);
  assert.equal(JSON.parse(r7Click.content[0].text).code, "element_not_found");

  const r7Set = await server.handleCallTool("set_element_value", {
    app_ref: { pid: 100 },
    name: "Save",
    role: "textfield",
    value: "abc",
  });
  assert.equal(r7Set.isError, true);
  assert.equal(JSON.parse(r7Set.content[0].text).code, "element_not_found");

  const r7Find = await server.handleCallTool("find_element", {
    app_ref: { pid: 100 },
    name: "Save",
    role: "button",
  });
  assert.equal(JSON.parse(r7Find.content[0].text).not_found, true);

  // R15: non-existent PID 999999 must return app_not_found
  const r15 = await server.handleCallTool("open_application", { pid: 999999 });
  assert.equal(r15.isError, true);
  assert.equal(JSON.parse(r15.content[0].text).code, "app_not_found");

  // R11 + R18 on MacOSAdapter
  const adapter = new MacOSAdapter();
  const helperArgsSeen = [];
  adapter.runHelper = async (args) => {
    helperArgsSeen.push(args);
    return { ok: true, ax_error: 0 };
  };
  adapter.activeStates.set("s_r11_r18", {
    appRef: { pid: 100, name: "Finder" },
    tree: assignHandlesToTree(100, [
      {
        index: 0,
        handle: "",
        role: "button",
        identifier: "btn_delete_id",
        name: "Delete",
        capabilities: ["pressable"],
        actions: ["AXPress"],
        ax_path: [0, 0],
      },
    ]),
  });

  // R18: typeText on non-editable button must reject BEFORE any helper call
  await assert.rejects(
    () => adapter.typeText("hello", undefined, { type: "element", state_id: "s_r11_r18", index: 0 }),
    (err) => err.code === "not_settable"
  );
  assert.equal(helperArgsSeen.length, 0, "R18: typeText must never click a non-editable button");

  // R11: click passes --expected-identifier and --expected-name to act-element
  await adapter.click({ type: "element", state_id: "s_r11_r18", index: 0 });
  assert.equal(helperArgsSeen.length, 1);
  assert.ok(helperArgsSeen[0].includes("--expected-identifier"));
  assert.ok(helperArgsSeen[0].includes("btn_delete_id"));
  assert.ok(helperArgsSeen[0].includes("--expected-name"));
  assert.ok(helperArgsSeen[0].includes("Delete"));
});

test("R8 + B7: Kill switch halts read & write tools (allowing get_capabilities/wait) and releases held mouse buttons", async () => {
  const adapter = new MacOSAdapter();
  const calls = [];
  adapter.runHelper = async (args) => {
    calls.push(args);
    return { ok: true };
  };
  const server = new MCPServer(adapter);

  await server.handleCallTool("mouse_down", { button: "left" });
  assert.deepEqual(calls, [["pointer-op", "--op", "down", "--button", "left"]]);

  const stopRes = await server.handleCallTool("stop_computer_control", {});
  assert.equal(stopRes.isError, undefined);
  assert.deepEqual(calls[1], ["pointer-op", "--op", "up", "--button", "left"], "Kill switch must release held mouse button");

  for (const blockedTool of ["list_apps", "read_clipboard"]) {
    const res = await server.handleCallTool(blockedTool, {});
    assert.equal(res.isError, true, `${blockedTool} must fail closed after stop_computer_control`);
  }

  const capsRes = await server.handleCallTool("get_capabilities", {});
  assert.equal(capsRes.isError, undefined, "get_capabilities remains available after stop");
  const waitRes = await server.handleCallTool("wait", { ms: 5 });
  assert.equal(waitRes.isError, undefined, "wait remains available after stop");
});

test("R9 + B11 + B15: Doctor fails core_ready when native_ax_helper binary is missing on Darwin", async () => {
  const brokenDarwinAdapter = new MacOSAdapter();
  brokenDarwinAdapter.helperPath = "/nonexistent/path/to/macos-ax-helper";
  const report = await runDoctor(brokenDarwinAdapter);
  assert.equal(report.checks.environment.native_ax_helper, false);
  assert.equal(report.core_ready, false);
  assert.equal(report.overall_healthy, false);
  assert.ok(report.missing_real_gui_prereqs.includes("native_ax_helper"));
});

test("R10 + B10: Installer aborts on malformed JSON before touching skills, backs up full skill directories, and honors .kit-owned.json on uninstall", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "zov-cua-r10-"));
  try {
    const agyDir = join(fakeHome, ".gemini", "config");
    const userSkillDir = join(agyDir, "skills", "zov-computer-use");
    mkdirSync(join(userSkillDir, "scripts"), { recursive: true });
    writeFileSync(join(userSkillDir, "SKILL.md"), "---\nname: zov-computer-use\n---\nUSER_AUTHORED", "utf-8");
    writeFileSync(join(userSkillDir, "scripts", "my-custom-helper.sh"), "#!/bin/sh\necho custom\n", "utf-8");
    const mcpCfgPath = join(agyDir, "mcp_config.json");
    writeFileSync(mcpCfgPath, "{ invalid json trailing comma, }", "utf-8");

    // 1. Malformed JSON must abort before modifying user skills
    assert.throws(() => {
      execFileSync(
        process.execPath,
        [join(repoRoot, "scripts", "install.mjs"), "--home", fakeHome, "--client", "antigravity", "--skip-probe"],
        { cwd: repoRoot, stdio: "pipe" }
      );
    });
    assert.equal(readFileSync(join(userSkillDir, "SKILL.md"), "utf-8"), "---\nname: zov-computer-use\n---\nUSER_AUTHORED");

    // 2. Uninstall must NOT delete a skill directory that lacks .kit-owned.json
    writeFileSync(mcpCfgPath, "{}", "utf-8");
    execFileSync(
      process.execPath,
      [join(repoRoot, "scripts", "install.mjs"), "--home", fakeHome, "--client", "antigravity", "--uninstall"],
      { cwd: repoRoot, stdio: "pipe" }
    );
    assert.equal(existsSync(join(userSkillDir, "scripts", "my-custom-helper.sh")), true);

    // 3. Install over pre-existing user skill directory backs up the ENTIRE directory (preserving my-custom-helper.sh)
    execFileSync(
      process.execPath,
      [join(repoRoot, "scripts", "install.mjs"), "--home", fakeHome, "--client", "antigravity", "--skip-probe"],
      { cwd: repoRoot, stdio: "pipe" }
    );
    const skillSiblings = readdirSync(join(agyDir, "skills"));
    const bakDirName = skillSiblings.find((n) => n.startsWith("zov-computer-use.bak-"));
    assert.ok(bakDirName, "Full directory backup must be created before replacing user skill dir");
    assert.equal(existsSync(join(agyDir, "skills", bakDirName, "scripts", "my-custom-helper.sh")), true);
    assert.equal(existsSync(join(userSkillDir, ".kit-owned.json")), true);
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("R12 + B8 + B13: computeStateDiff handles duplicate weak handles accurately and 64-state eviction stays bounded", async () => {
  const baseTree = assignHandlesToTree(10, [
    {
      index: 0,
      handle: "",
      role: "window",
      name: "Win",
      capabilities: [],
      actions: [],
      children: [
        { index: 1, handle: "", role: "textfield", name: "Notes", value: "first", capabilities: ["editable"], actions: [] },
        { index: 2, handle: "", role: "textfield", name: "Notes", value: "second", capabilities: ["editable"], actions: [] },
      ],
    },
  ]);
  const nextTree = assignHandlesToTree(10, [
    {
      index: 0,
      handle: "",
      role: "window",
      name: "Win",
      capabilities: [],
      actions: [],
      children: [
        { index: 1, handle: "", role: "textfield", name: "Notes", value: "first", capabilities: ["editable"], actions: [] },
      ],
    },
  ]);

  const diff = computeStateDiff(
    { state_id: "s1", app: { pid: 1, name: "A", active: true }, tree: baseTree, element_count: 3, timestamp: 1 },
    { state_id: "s2", app: { pid: 1, name: "A", active: true }, tree: nextTree, element_count: 2, timestamp: 2 }
  );
  assert.equal(diff.removed_handles.length, 1);
  assert.equal(diff.modified_elements.length, 0);

  // B13: diff without baseline returns diff_baseline_missing: true
  const server = new MCPServer({
    platform: "darwin",
    async getAppState(appRef) {
      return { state_id: `s_${appRef.pid}`, app: { pid: appRef.pid, name: "App", active: true }, tree: [], element_count: 0, timestamp: 1 };
    },
  });
  const noBaseline = await server.handleCallTool("get_app_state", { app_ref: { pid: 777 }, detail: "diff" });
  assert.equal(JSON.parse(noBaseline.content[0].text).diff_baseline_missing, true);

  // N-15 + B13: Push 70 states into MacOSAdapter (> 64 limit) and verify oldest state is evicted cleanly
  const evictAdapter = new MacOSAdapter();
  let seq = 0;
  evictAdapter.runHelper = async (args) => {
    if (args[0] === "list-apps") return [{ pid: 900, name: "EvictApp", active: true }];
    return {
      app: { pid: 900, name: "EvictApp", active: true },
      elements: [{ role: "button", name: `Btn${seq++}`, capabilities: ["pressable"], actions: ["AXPress"], ax_path: [0], enabled: true, focused: false }],
    };
  };
  const stateIds = [];
  for (let i = 0; i < 70; i++) {
    const st = await evictAdapter.getAppState({ pid: 900 });
    stateIds.push(st.state_id);
  }
  assert.equal(evictAdapter.activeStates.size, 64, "activeStates must stay bounded at 64");
  await assert.rejects(
    () => evictAdapter.click({ type: "element", state_id: stateIds[0], index: 0 }),
    (err) => err.code === "stale_handle"
  );
});

test("B3 + O11 + O12: Stdio JSON-RPC serializes FIFO, whitelists protocolVersion, rejects >2 MiB lines, and exits cleanly", async () => {
  const serverPath = join(repoRoot, "packages", "mcp-server", "dist", "bin", "server.js");
  const proc = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = [];
  let buf = "";
  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const l = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (l) lines.push(JSON.parse(l));
      nl = buf.indexOf("\n");
    }
  });

  const oversizedLine = JSON.stringify({ jsonrpc: "2.0", id: 99, method: "ping", pad: "x".repeat(2 * 1024 * 1024 + 256) });
  const batch =
    [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "9999-invalid-proto" } }),
      oversizedLine,
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "wait", arguments: { ms: 20 } } }),
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping", params: {} }),
    ].join("\n") + "\n";

  proc.stdin.write(batch);
  proc.stdin.end();

  const exitCode = await new Promise((resolve) => proc.on("close", resolve));
  assert.equal(exitCode, 0);

  const expectedMcpVersion = JSON.parse(
    readFileSync(join(repoRoot, "packages", "mcp-server", "package.json"), "utf-8")
  ).version;

  // Response 0: initialize falls back to 2024-11-05 (not 2026-07-28) and reports dynamic package version
  assert.equal(lines[0].id, 1);
  assert.equal(lines[0].result.protocolVersion, "2024-11-05");
  assert.equal(lines[0].result.serverInfo.version, expectedMcpVersion);

  // Response 1: oversized line rejected with -32600 without crashing stream
  assert.equal(lines[1].error.code, -32600);

  // Subsequent pipelined requests still arrive strictly in FIFO order
  assert.deepEqual(
    lines.slice(2).map((m) => m.id),
    [2, 3]
  );
});

test(
  "B4 + R1 + R2 + R3 + O10: Native Swift macos-ax-helper CLI golden checks (zero GUI input events)",
  { skip: process.platform !== "darwin" },
  () => {
    const helperBin = join(repoRoot, "packages", "platform-macos", "dist", "bin", "macos-ax-helper");
    assert.equal(existsSync(helperBin), true, "Compiled macos-ax-helper binary must exist on Darwin");

    const run = (args) => spawnSync(helperBin, args, { encoding: "utf-8", timeout: 5000 });

    // R2: cmd+G must NOT auto-add shift
    const cmdG = JSON.parse(run(["key", "--key", "cmd+G", "--dry-run", "1"]).stdout);
    assert.equal(cmdG.ok, true);
    assert.equal(cmdG.key, "g");
    assert.deepEqual(cmdG.modifiers, ["cmd"]);

    // R2: standalone uppercase G DOES auto-add shift
    const upperG = JSON.parse(run(["key", "--key", "G", "--dry-run", "1"]).stdout);
    assert.equal(upperG.key, "g");
    assert.deepEqual(upperG.modifiers, ["shift"]);

    // R3: "cmd++" parses cleanly as '+' with cmd+shift, whereas malformed "cmd+" fails closed
    const cmdPlus = JSON.parse(run(["key", "--key", "cmd++", "--dry-run", "1"]).stdout);
    assert.equal(cmdPlus.ok, true);
    assert.equal(cmdPlus.key, "+");
    assert.ok(cmdPlus.modifiers.includes("cmd"));

    const badChord = run(["key", "--key", "cmd+", "--dry-run", "1"]);
    assert.notEqual(badChord.status, 0);
    assert.equal(JSON.parse(badChord.stdout).code, "invalid_argument");

    // O10: sequential flag parser handles value equal to flag name ("--pid") without misparsing
    const dashVal = JSON.parse(run(["key", "--key", "--pid", "--dry-run", "1"]).stdout);
    assert.equal(dashVal.ok, true);
    assert.equal(dashVal.key, "--pid");

    // R1: window-op with invalid/nonexistent window-id fails closed with window_not_found (never touches arbitrary windows)
    const winZero = run(["window-op", "--op", "minimize", "--window-id", "0"]);
    assert.equal(winZero.status, 1);
    assert.equal(JSON.parse(winZero.stdout).code, "window_not_found");

    const winMissing = run(["window-op", "--op", "minimize", "--window-id", "999999999"]);
    assert.equal(winMissing.status, 1);
    assert.equal(JSON.parse(winMissing.stdout).code, "window_not_found");

    // R4: NaN coordinates and Int32 overflow scroll deltas exit cleanly with JSON invalid_argument (never SIGTRAP 133)
    const nanClick = run(["click-coord", "--x", "NaN", "--y", "10"]);
    assert.equal(nanClick.status, 1);
    assert.equal(JSON.parse(nanClick.stdout).code, "invalid_argument");

    const hugeScroll = run(["pointer-op", "--op", "scroll", "--delta-y", "3000000000"]);
    assert.equal(hugeScroll.status, 1);
    assert.equal(JSON.parse(hugeScroll.stdout).code, "invalid_argument");

    // N-3: Unknown modifier names in chord ("ctl+a", "a+b") must fail closed instead of silently dropping modifiers
    for (const badModChord of ["ctl+a", "a+b", "superkey+c"]) {
      const badModRes = run(["key", "--key", badModChord, "--dry-run", "1"]);
      assert.equal(badModRes.status, 1, `Chord '${badModChord}' must exit 1`);
      assert.equal(JSON.parse(badModRes.stdout).code, "invalid_argument");
    }
  }
);

test("N-1 + N-2 + N-3 + N-8 + N-13: Round-2 array item validation, AXPress post-send no-fallback guard, modifier whitelist, and anonymous bounds TOCTOU", async () => {
  // N-1 + N-13: Safe mock adapter ensures zero real OS side effects even before fix
  const trapAdapter = {
    platform: "darwin",
    async hotkey() {
      throw new Error("UNSAFE_REACHED_HOTKEY");
    },
    async pressKey() {
      throw new Error("UNSAFE_REACHED_PRESSKEY");
    },
    async getAppState() {
      throw new Error("UNSAFE_REACHED_GETAPPSTATE");
    },
    async requestAccess() {
      throw new Error("UNSAFE_REACHED_REQUESTACCESS");
    },
  };
  const server = new MCPServer(trapAdapter);

  for (const [tool, badArgs] of [
    ["hotkey", { keys: [123] }],
    ["hotkey", { keys: [""] }],
    ["press_key", { key: "a", modifiers: [123] }],
    ["press_key", { key: "a", modifiers: ["ctl"] }],
    ["press_key", { key: "a", modifiers: ["cmd+shift"] }],
    ["request_access", { types: ["camera"] }],
    ["get_app_state", { app_ref: { name: 123 } }],
    ["get_app_state", { app_ref: { pid: 100, window_id: -5 } }],
  ]) {
    const res = await server.handleCallTool(tool, badArgs);
    assert.equal(res.isError, true, `${tool} ${JSON.stringify(badArgs)} must fail closed`);
    assert.equal(JSON.parse(res.content[0].text).code, "invalid_argument", `${tool} must return invalid_argument`);
  }

  // Direct MacOSAdapter string & modifier guards
  const mac = new MacOSAdapter();
  mac.runHelper = async () => {
    throw new Error("Should not spawn helper on invalid key/modifier");
  };
  await assert.rejects(() => mac.hotkey([123]), (err) => err.code === "invalid_argument");
  await assert.rejects(() => mac.pressKey("a", ["ctl"]), (err) => err.code === "invalid_argument");
  await assert.rejects(() => mac.pressKey("a", ["cmd+shift"]), (err) => err.code === "invalid_argument");

  // N-2: If act-element fails AFTER sending action (actionSent=true), click MUST NOT fall through to click-coord
  const n2Calls = [];
  const { ComputerUseError } = await import("../packages/core/dist/index.js");
  mac.runHelper = async (args) => {
    n2Calls.push(args[0]);
    if (args[0] === "act-element") {
      throw new ComputerUseError("helper crashed after AXPress", "operation_failed", false, true);
    }
    return { ok: true };
  };
  mac.activeStates.set("s_n2", {
    appRef: { pid: 222, name: "TestApp" },
    tree: assignHandlesToTree(222, [
      {
        index: 0,
        handle: "",
        role: "button",
        name: "Submit",
        bounds: { x: 50, y: 50, width: 80, height: 30 },
        capabilities: ["pressable"],
        actions: ["AXPress"],
        ax_path: [0, 1],
      },
    ]),
  });
  await assert.rejects(
    () => mac.click({ type: "element", state_id: "s_n2", index: 0 }, { strategy: "auto" }),
    (err) => err.actionSent === true
  );
  assert.deepEqual(n2Calls, ["act-element"], "N-2: Must NEVER fall back to click-coord when actionSent=true");

  // N-8: Anonymous element (empty name, no identifier) passes --expected-bounds to act-element
  const n8Calls = [];
  mac.runHelper = async (args) => {
    n8Calls.push(args);
    return { ok: true, ax_error: 0 };
  };
  mac.activeStates.set("s_n8", {
    appRef: { pid: 222, name: "TestApp" },
    tree: assignHandlesToTree(222, [
      {
        index: 0,
        handle: "",
        role: "button",
        name: "",
        bounds: { x: 120, y: 240, width: 44, height: 28 },
        capabilities: ["pressable"],
        actions: ["AXPress"],
        ax_path: [0, 2],
      },
    ]),
  });
  await mac.click({ type: "element", state_id: "s_n8", index: 0 });
  assert.ok(n8Calls[0].includes("--expected-bounds"), "N-8: Anonymous element must pass --expected-bounds");
  assert.ok(n8Calls[0].includes("120,240,44,28"));
});
