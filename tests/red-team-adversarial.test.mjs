import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignHandlesToTree,
  resolveElementWithAmbiguity,
  AmbiguousElementError,
  StaleHandleError,
  UnsupportedPlatformError,
} from "../packages/core/dist/index.js";
import { MCPServer } from "../packages/mcp-server/dist/index.js";
import { MacOSAdapter } from "../packages/platform-macos/dist/index.js";
import { WindowsAdapter } from "../packages/platform-windows/dist/index.js";
import { LinuxAdapter } from "../packages/platform-linux/dist/index.js";

test("Red Team 1: Duplicate element names trigger AmbiguousElementError and prevent blind action", async () => {
  const duplicateTree = [
    {
      index: 0,
      handle: "",
      role: "window",
      name: "Preferences",
      capabilities: ["focused"],
      actions: [],
      children: [
        {
          index: 1,
          handle: "",
          role: "button",
          name: "Save",
          capabilities: ["pressable"],
          actions: ["AXPress"],
        },
        {
          index: 2,
          handle: "",
          role: "button",
          name: "Save",
          capabilities: ["pressable"],
          actions: ["AXPress"],
        },
      ],
    },
  ];

  const assigned = assignHandlesToTree(1001, duplicateTree);
  assert.equal(assigned[0].children[0].ambiguous, true, "First duplicate must be marked ambiguous");
  assert.equal(assigned[0].children[1].ambiguous, true, "Second duplicate must be marked ambiguous");
  assert.equal(assigned[0].children[0].ambiguity_count, 2);

  const resolved = resolveElementWithAmbiguity(assigned, { name: "Save" });
  assert.equal(resolved.ambiguous, true);
  assert.equal(resolved.count, 2);
});

test("Red Team 2: Stale State or Missing Handle throws StaleHandleError, never fake-success", async () => {
  const server = new MCPServer(new MacOSAdapter());
  const res = await server.handleCallTool("click", {
    target: {
      type: "element",
      state_id: "s_expired_9999",
      handle: "h_wk_button_12345",
    },
  });

  assert.equal(res.isError, true, "Expired state must produce an error");
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.code, "stale_handle", "Must emit structured stale_handle code");
  assert.equal(payload.action_sent, false, "Must confirm action was NOT sent");
});

test("Red Team 3: Unimplemented Linux Adapter strictly throws UnsupportedPlatformError (Zero Fake-Success)", async () => {
  const linuxAdapter = new LinuxAdapter();
  const server = new MCPServer(linuxAdapter);

  const actions = ["click", "move_pointer", "scroll", "type_text", "screenshot"];
  for (const action of actions) {
    const res = await server.handleCallTool(action, {
      target: { type: "coordinate", x: 100, y: 100 },
      text: "hello",
    });

    assert.equal(res.isError, true, `Action ${action} on Linux must fail truthfully`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(
      payload.code,
      "unsupported_platform",
      `Expected unsupported_platform for ${action}, got ${payload.code}`
    );
    assert.equal(payload.action_sent, false);
  }
});

test("Red Team 3b: Windows Adapter blocks background raw keystrokes with foreground_required instead of polluting active window", async () => {
  const winAdapter = new WindowsAdapter();
  winAdapter.runHelper = async (args) => {
    if (args[0] === "list-apps") {
      return [{ pid: 4242, name: "notepad", bundle_id: "notepad.exe", active: false, windows_count: 1 }];
    }
    throw new Error("Should not dispatch keystrokes to unfocused app: " + args.join(" "));
  };
  const server = new MCPServer(winAdapter);

  const keyRes = await server.handleCallTool("press_key", {
    key: "enter",
    app_ref: { pid: 4242 },
  });
  assert.equal(keyRes.isError, true);
  const keyErr = JSON.parse(keyRes.content[0].text);
  assert.equal(keyErr.code, "foreground_required");
  assert.equal(keyErr.action_sent, false);
});

test("Red Team 4: Unsupported tools (select_text) never return fake success", async () => {
  const server = new MCPServer();
  const res = await server.handleCallTool("select_text", {});
  assert.equal(res.isError, true);
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.code, "unsupported_platform");
  assert.equal(payload.action_sent, false);
});

test("Red Team 5: Kill-Switch (stop_computer_control) blocks subsequent actions immediately", async () => {
  const server = new MCPServer();
  const stopRes = await server.handleCallTool("stop_computer_control", {});
  assert.equal(stopRes.isError, undefined);

  // Subsequent action must be rejected
  const clickRes = await server.handleCallTool("click", {
    target: { type: "coordinate", x: 100, y: 100 },
  });
  assert.equal(clickRes.isError, true, "Action after kill-switch must be rejected");
  const payload = JSON.parse(clickRes.content[0].text);
  assert.match(payload.error, /kill-switch/i);
});

test("Red Team 6: Capability Registry reflects truthful platform boundaries", async () => {
  const server = new MCPServer();
  const res = await server.handleCallTool("get_capabilities", {});
  assert.equal(res.isError, undefined);
  const caps = JSON.parse(res.content[0].text);

  assert.ok(caps.platform, "Must report platform");
  assert.ok(caps.pointer, "Must report pointer capabilities");
  assert.ok(caps.keyboard, "Must report keyboard capabilities");
  assert.ok(caps.accessibility, "Must report accessibility capabilities");
});

test("Red Team 7: Unknown tool name returns standard invalid_argument error", async () => {
  const server = new MCPServer();
  const res = await server.handleCallTool("completely_fake_nonexistent_tool", {});
  assert.equal(res.isError, true);
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.code, "invalid_argument");
});

test("Red Team 8: Qt6 shared AXIdentifier with distinct names produces unique handles", () => {
  const qtTree = [
    {
      index: 0,
      handle: "",
      role: "window",
      name: "Anki",
      capabilities: [],
      actions: ["AXRaise"],
      children: [
        {
          index: 1,
          handle: "",
          role: "link",
          identifier: "QWebEngineNode",
          name: "ASL",
          capabilities: ["clickable"],
          actions: ["AXRaise"],
        },
        {
          index: 2,
          handle: "",
          role: "link",
          identifier: "QWebEngineNode",
          name: "",
          capabilities: ["clickable"],
          actions: ["AXRaise"],
        },
      ],
    },
  ];
  const assigned = assignHandlesToTree(32124, qtTree);
  assert.notEqual(assigned[0].children[0].handle, assigned[0].children[1].handle);
  assert.equal(assigned[0].children[0].ambiguous, undefined);
});

test("Red Team 9: AXRaise-only Qt6 element never fake-succeeds under strategy='a11y' and skips AXPress under 'auto'", async () => {
  const adapter = new MacOSAdapter();
  const helperCalls = [];
  adapter.runHelper = async (args) => {
    helperCalls.push(args);
    if (args[0] === "click-coord") {
      return { ok: true, x: 500, y: 300 };
    }
    throw new Error("Unexpected helper call: " + args.join(" "));
  };
  adapter.activeStates.set("s_qt_test", {
    appRef: { pid: 32124, name: "Anki" },
    tree: assignHandlesToTree(32124, [
      {
        index: 0,
        handle: "",
        role: "link",
        name: "ASL",
        bounds: { x: 480, y: 290, width: 40, height: 20 },
        capabilities: ["clickable"],
        actions: ["AXRaise"],
        ax_path: [0, 1, 0],
      },
    ]),
  });

  const server = new MCPServer(adapter);

  // 1. strategy='a11y' must fail closed without calling act-element or click-coord
  const a11yRes = await server.handleCallTool("left_click", {
    target: { type: "element", state_id: "s_qt_test", index: 0 },
    strategy: "a11y",
  });
  assert.equal(a11yRes.isError, true);
  const a11yErr = JSON.parse(a11yRes.content[0].text);
  assert.equal(a11yErr.code, "action_unavailable");
  assert.equal(a11yErr.action_sent, false);
  assert.equal(helperCalls.length, 0, "Must not invoke AXPress on AXRaise-only element");

  // 2. strategy='auto' must skip AXPress and drop straight to occlusion-verified click-coord
  const autoRes = await server.handleCallTool("left_click", {
    target: { type: "element", state_id: "s_qt_test", index: 0 },
    strategy: "auto",
  });
  assert.equal(autoRes.isError, undefined);
  assert.equal(helperCalls.length, 1);
  assert.equal(helperCalls[0][0], "click-coord");
  assert.ok(helperCalls[0].includes("--require-pid"));
});

test("Red Team 10: Password fields (securetextfield) are automatically redacted in full and compact state", async () => {
  const mockAdapter = {
    platform: "darwin",
    async getAppState() {
      return {
        state_id: "s_sec_1",
        app: { pid: 888, name: "LoginApp", active: true },
        tree: [
          {
            index: 0,
            handle: "h_pwd",
            role: "textfield",
            subrole: "securetextfield",
            name: "Password",
            value: "SuperSecret123!",
            capabilities: ["editable"],
            actions: [],
          },
        ],
        element_count: 1,
        timestamp: Date.now(),
      };
    },
  };
  const server = new MCPServer(mockAdapter);

  const compactRes = await server.handleCallTool("get_app_state", {
    app_ref: { pid: 888 },
    detail: "compact",
  });
  const compact = JSON.parse(compactRes.content[0].text);
  assert.equal(compact.elements[0].v, "[REDACTED_PASSWORD]");
  assert.ok(!compactRes.content[0].text.includes("SuperSecret123!"));

  const fullRes = await server.handleCallTool("get_app_state", {
    app_ref: { pid: 888 },
    detail: "full",
  });
  const full = JSON.parse(fullRes.content[0].text);
  assert.equal(full.tree[0].value, "[REDACTED_PASSWORD]");
  assert.ok(!fullRes.content[0].text.includes("SuperSecret123!"));
});

test("Red Team 11: Newly exposed manifest tools (hold_key, mouse_down, mouse_up) are advertised in tools/list", async () => {
  const { TOOLS_MANIFEST } = await import("../packages/mcp-server/dist/index.js");
  const names = new Set(TOOLS_MANIFEST.map((t) => t.name));
  for (const expected of ["hold_key", "mouse_down", "left_mouse_down", "mouse_up", "left_mouse_up", "left_click_drag"]) {
    assert.ok(names.has(expected), `TOOLS_MANIFEST must advertise ${expected}`);
  }
});
