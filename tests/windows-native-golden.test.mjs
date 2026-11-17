import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TimeoutError,
  assignHandlesToTree,
} from "../packages/core/dist/index.js";
import { MCPServer } from "../packages/mcp-server/dist/index.js";
import { WindowsAdapter } from "../packages/platform-windows/dist/index.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const winHelperBin = join(
  repoRoot,
  "packages",
  "platform-windows",
  "dist",
  "bin",
  "windows-uia-helper.exe"
);

test("WindowsAdapter: semantic UIA Invoke, background setValue, IsPassword redaction, and Ctrl+A clearFirst", async () => {
  const win = new WindowsAdapter();
  const calls = [];
  win.runHelper = async (args) => {
    calls.push(args);
    switch (args[0]) {
      case "list-apps":
        return [{ pid: 7001, name: "notepad", bundle_id: "notepad.exe", active: true, windows_count: 1 }];
      case "inspect":
        return {
          app: { pid: 7001, name: "notepad", bundle_id: "notepad.exe", active: true, windows_count: 1 },
          active_window: {
            id: 131072,
            pid: 7001,
            title: "Untitled - Notepad",
            app_name: "notepad",
            bundle_id: "notepad.exe",
            bounds: { x: 100, y: 100, width: 800, height: 600 },
            is_minimized: false,
            is_focused: true,
          },
          elements: [
            {
              index: 0,
              handle: "",
              role: "window",
              name: "Untitled - Notepad",
              capabilities: [],
              actions: [],
              ax_path: [131072],
              children: [
                {
                  index: 1,
                  handle: "",
                  role: "button",
                  identifier: "SaveBtn",
                  name: "Save",
                  bounds: { x: 120, y: 140, width: 80, height: 30 },
                  capabilities: ["pressable"],
                  actions: ["AXPress"],
                  ax_path: [131072, 0],
                },
                {
                  index: 2,
                  handle: "",
                  role: "textarea",
                  identifier: "RichEditD2DPT",
                  name: "Text Editor",
                  value: "Initial",
                  bounds: { x: 100, y: 180, width: 800, height: 500 },
                  capabilities: ["editable"],
                  actions: ["setValue"],
                  ax_path: [131072, 1],
                },
                {
                  index: 3,
                  handle: "",
                  role: "securetextfield",
                  subrole: "securetextfield",
                  identifier: "PwdBox",
                  name: "PIN",
                  value: "MyWindowsSecret99!",
                  capabilities: ["editable"],
                  actions: ["setValue"],
                  ax_path: [131072, 2],
                },
              ],
            },
          ],
        };
      case "act-element":
      case "key":
      case "type-unicode":
        return { ok: true };
      default:
        throw new Error(`Unexpected helper subcommand: ${args[0]}`);
    }
  };

  const server = new MCPServer(win);

  // 1. Observe state & confirm Windows IsPassword field is redacted in full & compact modes
  const stateRes = await server.handleCallTool("get_app_state", {
    app_ref: { name: "notepad" },
    detail: "full",
  });
  assert.equal(stateRes.isError, undefined);
  const fullState = JSON.parse(stateRes.content[0].text);
  assert.ok(!stateRes.content[0].text.includes("MyWindowsSecret99!"));
  assert.equal(fullState.tree[0].children[2].value, "[REDACTED_PASSWORD]");

  // 2. Semantic left_click dispatches zero-focus UIA act-element AXPress + atomic return_state="compact"
  const saveBtn = fullState.tree[0].children[0];
  const clickRes = await server.handleCallTool("left_click", {
    target: { type: "element", state_id: fullState.state_id, handle: saveBtn.handle },
    return_state: "compact",
  });
  assert.equal(clickRes.isError, undefined);
  const clickPayload = JSON.parse(clickRes.content[0].text);
  assert.equal(clickPayload.ok, true);
  assert.ok(clickPayload.compact_state?.state_id);
  const actCall = calls.find((c) => c[0] === "act-element" && c.includes("AXPress"));
  assert.ok(actCall, "Must dispatch act-element AXPress");
  assert.ok(actCall.includes("--expected-identifier") && actCall.includes("SaveBtn"));

  // 3. type_text on editable element uses background UIA setValue without SendInput keystrokes
  const editorNode = fullState.tree[0].children[1];
  calls.length = 0;
  const typeElemRes = await server.handleCallTool("type_text", {
    target: { type: "element", state_id: fullState.state_id, handle: editorNode.handle },
    text: "Hello Windows UIA",
  });
  assert.equal(typeElemRes.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "act-element");
  assert.ok(calls[0].includes("setValue"));

  // 4. clearFirst on raw type_text uses Windows Ctrl+A (not macOS Cmd+A)
  calls.length = 0;
  const clearRes = await server.handleCallTool("type_text", {
    text: "Fresh line",
    clearFirst: true,
    app_ref: { pid: 7001 },
  });
  assert.equal(clearRes.isError, undefined);
  const keyCalls = calls.filter((c) => c[0] === "key");
  assert.equal(keyCalls.length, 2);
  assert.deepEqual(keyCalls[0], ["key", "--key", "a", "--modifiers", "ctrl"]);
  assert.deepEqual(keyCalls[1], ["key", "--key", "backspace"]);
});

test("WindowsAdapter: mutating timeout reports actionSent=true and post-send UIA failure never double-clicks via fallback", async () => {
  const win = new WindowsAdapter();
  const tmpDir = mkdtempSync(join(tmpdir(), "zov-win-timeout-"));
  const slowScript = join(tmpDir, "slow.mjs");
  writeFileSync(slowScript, "setTimeout(() => {}, 4000);\n", "utf-8");
  try {
    win.helperPath = process.execPath;
    win.helperArgsPrefix = [slowScript];
    await assert.rejects(
      () => win.runHelper(["click-coord", "--x", "50", "--y", "50"], 80, true),
      (err) => {
        assert.ok(err instanceof TimeoutError);
        assert.equal(err.actionSent, true);
        return true;
      }
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // N-2 parity: if act-element fails AFTER dispatching (actionSent=true), click() must NOT fall back to click-coord
  const win2 = new WindowsAdapter();
  const invoked = [];
  win2.activeStates.set("s_win_n2", {
    appRef: { pid: 900, name: "calc" },
    tree: assignHandlesToTree(900, [
      {
        index: 0,
        handle: "",
        role: "button",
        name: "Equals",
        bounds: { x: 200, y: 300, width: 50, height: 40 },
        capabilities: ["pressable"],
        actions: ["AXPress"],
        ax_path: [900, 0],
      },
    ]),
  });
  win2.runHelper = async (args) => {
    invoked.push(args[0]);
    throw new TimeoutError("act-element", 8000, true);
  };
  await assert.rejects(
    () => win2.click({ type: "element", state_id: "s_win_n2", index: 0 }, { strategy: "auto" }),
    TimeoutError
  );
  assert.deepEqual(invoked, ["act-element"], "Must NOT invoke click-coord after uncertain UIA Invoke timeout");
});

test(
  "Native windows-uia-helper.exe binary golden verification (permissions, screen-info, list-apps, dry-run parser)",
  { skip: process.platform !== "win32" },
  () => {
    assert.ok(existsSync(winHelperBin), `Compiled windows-uia-helper.exe must exist at ${winHelperBin}`);

    const runBin = (args) =>
      spawnSync(winHelperBin, args, { encoding: "utf-8", timeout: 10000 });

    const perms = runBin(["permissions"]);
    assert.equal(perms.status, 0, perms.stderr || perms.stdout);
    const permsJson = JSON.parse(perms.stdout.trim());
    assert.equal(typeof permsJson.accessibility, "boolean");
    assert.equal(typeof permsJson.screen_recording, "boolean");

    const screen = runBin(["screen-info"]);
    assert.equal(screen.status, 0, screen.stderr || screen.stdout);
    const screenJson = JSON.parse(screen.stdout.trim());
    assert.equal(screenJson.platform, "win32");
    assert.ok(Array.isArray(screenJson.displays_detail));

    const apps = runBin(["list-apps"]);
    assert.equal(apps.status, 0, apps.stderr || apps.stdout);
    assert.ok(Array.isArray(JSON.parse(apps.stdout.trim())));

    // Key chord & modifier dry-run validation
    const ctrlPlus = runBin(["key", "--key", "ctrl++", "--dry-run"]);
    assert.equal(ctrlPlus.status, 0, ctrlPlus.stdout);
    const ctrlPlusJson = JSON.parse(ctrlPlus.stdout.trim());
    assert.equal(ctrlPlusJson.key, "+");
    assert.ok(ctrlPlusJson.modifiers.includes("ctrl"));

    const ctrlUpperG = runBin(["key", "--key", "G", "--modifiers", "ctrl", "--dry-run"]);
    assert.equal(ctrlUpperG.status, 0);
    assert.deepEqual(JSON.parse(ctrlUpperG.stdout.trim()).modifiers, ["ctrl"]);

    const soloUpperG = runBin(["key", "--key", "G", "--dry-run"]);
    assert.equal(soloUpperG.status, 0);
    assert.deepEqual(JSON.parse(soloUpperG.stdout.trim()).modifiers, ["shift"]);

    for (const bad of [
      ["key", "--key", "++", "--dry-run"],
      ["key", "--key", "ctrl+", "--dry-run"],
      ["key", "--key", "+a", "--dry-run"],
      ["key", "--key", "a", "--modifiers", "hyper", "--dry-run"],
      ["window-op", "--op", "focus", "--window-id", "0", "--dry-run"],
      ["window-op", "--op", "focus", "--window-id", "999999999"],
    ]) {
      const r = runBin(bad);
      assert.notEqual(r.status, 0, `Expected non-zero exit for ${bad.join(" ")}`);
      assert.ok(JSON.parse(r.stdout.trim()).code);
    }

    // Flag value edge case: typing literal "--dry-run" with explicit "--dry-run 1"
    const flagEdge = runBin(["type-unicode", "--text", "--dry-run", "--dry-run", "1"]);
    assert.equal(flagEdge.status, 0);
    const flagEdgeJson = JSON.parse(flagEdge.stdout.trim());
    assert.equal(flagEdgeJson.dry_run, true);
    assert.equal(flagEdgeJson.length, 9);
  }
);
