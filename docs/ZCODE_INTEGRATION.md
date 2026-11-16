# MCP Host & ZCode Integration Guide

`macos-computer-use-kit` integrates seamlessly into **Antigravity**, **Claude Code**, **Cursor**, **Codex**, and **ZCode** via its turnkey installer or manual `mcp_config.json` setup.

---

## 1. Turnkey Installation (Recommended)

1. Clone and install `macos-computer-use-kit`:
   ```bash
   git clone https://github.com/timexingxin/macos-computer-use-kit.git
   cd macos-computer-use-kit
   ./install.sh --mode open
   ```

2. Reload MCP servers or restart your agent client. Both `computer-use-orchestrator` and `zcode-computer-use` skills plus the `zcode-cua` MCP server will be active immediately.

> **Compatibility Note on ZCode >= 3.18.0**: Starting in ZCode v3.18.0+, `ZCode Computer Use.app` enforces strict internal `verifyPeer` checks that reject external `ELECTRON_RUN_AS_NODE` bridge processes (`peer verification failed`). `./install.sh` automatically detects ZCode >= 3.18.0 and selects the built-in open-source native `ApplicationServices` + `CoreGraphics` backend (`--mode open`), which requires no third-party app and never breaks across ZCode updates.

---

## 2. Manual Standalone MCP Server Configuration

To wire the self-contained runtime manually into any MCP configuration (`~/.gemini/config/mcp_config.json`, `~/.cursor/mcp.json`, or `~/.claude.json`):

```json
{
  "mcpServers": {
    "zcode-cua": {
      "command": "node",
      "args": [
        "/absolute/path/to/macos-computer-use-kit/dist/runtime/dist/bin/server.js"
      ]
    }
  }
}
```

Verify the environment and permissions using `doctor`:
```bash
npm run doctor
```
