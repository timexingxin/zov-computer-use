#!/usr/bin/env python3
"""Python 3.9+ serial read-only MCP probe. Zero GUI writes, zero external dependencies."""
import argparse
import asyncio
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

DEFAULT_CONFIG_CANDIDATES = [
    "~/.gemini/config/mcp_config.json",
    "~/.gemini/antigravity/mcp_config.json",
    "~/.cursor/mcp.json",
    "~/.claude.json",
    "~/.qoder/mcp.json",
]


def discover_config_path(explicit_path=None):
    if explicit_path:
        p = Path(explicit_path).expanduser()
        if not p.exists():
            raise FileNotFoundError(f"MCP config file not found: {p}")
        return p
    for candidate in DEFAULT_CONFIG_CANDIDATES:
        p = Path(candidate).expanduser()
        if p.exists():
            return p
    raise FileNotFoundError(
        "No MCP config found in default locations: " + ", ".join(DEFAULT_CONFIG_CANDIDATES)
    )


class ProbeError(Exception):
    def __init__(self, category, detail):
        super().__init__(detail)
        self.category = category


class Client:
    """One connection, one in-flight request. Never reuse after protocol/timeout failure."""

    def __init__(self, timeout=30):
        self.timeout = timeout
        self.sequence = 0
        self.events = []
        self.process = None
        self.stderr_task = None
        self.stderr_bytes = 0
        self.inflight = False
        self.failed = False
        self.cleanup_errors = []

    async def start(self, command, args=(), env=None):
        spawn_kwargs = {
            "env": env,
            "stdin": asyncio.subprocess.PIPE,
            "stdout": asyncio.subprocess.PIPE,
            "stderr": asyncio.subprocess.PIPE,
            "limit": 8 * 1024 * 1024,
        }
        if os.name == "nt":
            spawn_kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        else:
            spawn_kwargs["start_new_session"] = True

        self.process = await asyncio.create_subprocess_exec(
            command,
            *args,
            **spawn_kwargs,
        )

        async def drain_stderr():
            while True:
                chunk = await self.process.stderr.read(4096)
                if not chunk:
                    return
                self.stderr_bytes += len(chunk)

        self.stderr_task = asyncio.create_task(drain_stderr())
        return self

    async def notify(self, method, params=None):
        message = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        self.process.stdin.write((json.dumps(message) + "\n").encode())
        await self.process.stdin.drain()

    async def request(self, method, params):
        if self.failed:
            raise ProbeError("unusable_connection", "Restart after failed request")
        if self.inflight:
            raise ProbeError("concurrent_request", "Client is serial; use separate isolated sessions")
        self.inflight = True
        self.sequence += 1
        rid = self.sequence
        start = time.monotonic()
        event = {"id": rid, "method": method, "tool": params.get("name"), "status": "pending"}
        self.events.append(event)

        async def exchange():
            message = {"jsonrpc": "2.0", "id": rid, "method": method, "params": params}
            try:
                self.process.stdin.write((json.dumps(message) + "\n").encode())
                await self.process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError) as exc:
                raise ProbeError("connection_closed", str(exc)) from exc
            while True:
                try:
                    raw = await self.process.stdout.readline()
                except ValueError as exc:
                    raise ProbeError("protocol_error", "Response exceeds framing limit") from exc
                if not raw:
                    raise ProbeError("connection_closed", "stdout EOF before response")
                try:
                    item = json.loads(raw)
                except (ValueError, UnicodeDecodeError) as exc:
                    raise ProbeError("protocol_error", "Non-JSON stdout") from exc
                if not isinstance(item, dict) or item.get("jsonrpc") != "2.0":
                    raise ProbeError("protocol_error", "Invalid JSON-RPC envelope")
                if "id" not in item:
                    if "method" in item:
                        continue
                    raise ProbeError("protocol_error", "Missing response id")
                if type(item["id"]) is not int or item["id"] != rid or "method" in item:
                    raise ProbeError("protocol_error", "Unexpected response/server request")
                if ("error" in item) == ("result" in item):
                    raise ProbeError("protocol_error", "Expected exactly result or error")
                if "error" in item:
                    raise ProbeError("rpc_error", json.dumps(item["error"]))
                return item["result"]

        try:
            result = await asyncio.wait_for(exchange(), self.timeout)
            if isinstance(result, dict) and result.get("isError"):
                structured = result.get("structuredContent")
                code = structured.get("code") if isinstance(structured, dict) else None
                parts = result.get("content")
                content = "\n".join(
                    part["text"]
                    for part in (parts if isinstance(parts, list) else [])
                    if isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str)
                )
                reason = None
                if code == "SUBAGENT_COMPUTER_USE_UNAVAILABLE":
                    reason = "subagent_guard"
                elif content.startswith("CUA_CONTROLLER_BUSY:"):
                    reason = "controller_busy"
                elif content.startswith("Computer control was stopped"):
                    reason = "stopped_connection"
                event["status"] = "refused" if reason else "tool_error"
                if reason:
                    event["refusal_reason"] = reason
                event["code"] = code
            else:
                event["status"] = "response"
            return result
        except asyncio.TimeoutError as exc:
            self.failed = True
            event["status"] = "timeout"
            raise ProbeError("timeout", "Deadline before response") from exc
        except asyncio.CancelledError:
            self.failed = True
            event["status"] = "cancelled"
            raise
        except ProbeError as exc:
            self.failed = True
            event["status"] = exc.category
            raise
        finally:
            self.inflight = False
            event["seconds"] = round(time.monotonic() - start, 6)

    async def initialize(self):
        result = await self.request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "zov-cua-readonly-probe", "version": "1.1.0"},
            },
        )
        await self.notify("notifications/initialized")
        return result

    async def close(self):
        if self.process is None:
            return
        self.process.stdin.close()
        try:
            await asyncio.wait_for(self.process.wait(), 3)
        except asyncio.TimeoutError:
            pass
        if self.process.returncode is not None and self.stderr_task:
            try:
                await asyncio.wait_for(asyncio.shield(self.stderr_task), 2)
            except asyncio.TimeoutError:
                pass
        needs_signal = self.process.returncode is None or (self.stderr_task and not self.stderr_task.done())
        if needs_signal:
            try:
                if hasattr(os, "killpg"):
                    os.killpg(self.process.pid, signal.SIGTERM)
                else:
                    self.process.terminate()
            except ProcessLookupError:
                pass
            except PermissionError:
                self.cleanup_errors.append("process_group_signal_denied")
        try:
            await asyncio.wait_for(self.process.wait(), 2)
        except asyncio.TimeoutError:
            pass
        if self.stderr_task:
            try:
                await asyncio.wait_for(asyncio.shield(self.stderr_task), 2)
            except asyncio.TimeoutError:
                pass
        if self.process.returncode is None or (self.stderr_task and not self.stderr_task.done()):
            try:
                if hasattr(os, "killpg") and hasattr(signal, "SIGKILL"):
                    os.killpg(self.process.pid, signal.SIGKILL)
                else:
                    self.process.kill()
            except ProcessLookupError:
                pass
            except PermissionError:
                self.cleanup_errors.append("process_group_kill_denied")
        try:
            await asyncio.wait_for(self.process.wait(), 2)
        except asyncio.TimeoutError:
            self.cleanup_errors.append("owned_root_not_reaped")
        if self.stderr_task:
            self.stderr_task.cancel()
            await asyncio.gather(self.stderr_task, return_exceptions=True)


async def probe(options):
    receipt = {
        "server": options.server,
        "python": sys.version.split()[0],
        "scope": "initialize/tools-list/metadata guard only; no GUI writes",
    }
    client = Client(options.timeout)
    try:
        config_path = discover_config_path(options.config)
        receipt["config_path"] = str(config_path)
        raw_cfg = json.loads(config_path.read_text(encoding="utf-8"))
        servers = raw_cfg.get("mcpServers", raw_cfg)
        if options.server not in servers:
            raise KeyError(f"Server '{options.server}' not found in {config_path} (available: {list(servers.keys())})")
        settings = servers[options.server]
        environment = os.environ.copy()
        environment.update(settings.get("env", {}))

        await client.start(settings["command"], settings.get("args", []), environment)
        init_res = await client.initialize()
        receipt["server_info"] = init_res.get("serverInfo")
        listed = await client.request("tools/list", {})
        receipt["tool_count"] = len(listed.get("tools", []))
        if receipt["tool_count"] == 0:
            raise ProbeError("empty_tools", "Server returned 0 tools")

        if sys.platform in ("darwin", "win32"):
            apps_res = await client.request(
                "tools/call",
                {
                    "name": "list_apps",
                    "arguments": {},
                },
            )
            if apps_res.get("isError"):
                raise ProbeError("native_helper_unavailable", f"list_apps failed on {sys.platform}: {apps_res}")
            receipt[f"{sys.platform}_list_apps_ok"] = True

        if options.guard:
            result = await client.request(
                "tools/call",
                {
                    "name": "request_access",
                    "arguments": {},
                    "_meta": {"com.zov/request-context": {"runtime_scope": "subagent"}},
                },
            )
            receipt["guard_result"] = result
            if (
                not result.get("isError")
                or result.get("structuredContent", {}).get("code") != "SUBAGENT_COMPUTER_USE_UNAVAILABLE"
            ):
                raise ProbeError("guard_not_proven", "Unexpected subagent guard response")
        receipt["status"] = "PASS"
    except ProbeError as exc:
        receipt.update(status="FAIL", category=exc.category, detail=str(exc))
    except (OSError, ValueError, KeyError) as exc:
        receipt.update(status="FAIL", category="client_or_configuration_error", detail=str(exc))
    finally:
        await client.close()
        receipt["events"] = client.events
        receipt["exit_code"] = client.process.returncode if client.process else None
        receipt["process_reaped"] = client.process is None or client.process.returncode is not None
        receipt["owned_process_group_remaining"] = None
        if client.process and os.name != "nt" and Path("/bin/ps").exists():
            try:
                table = subprocess.check_output(["/bin/ps", "-axo", "pid=,pgid="], text=True)
                receipt["owned_process_group_remaining"] = sum(
                    1
                    for line in table.splitlines()
                    if len(line.split()) == 2 and int(line.split()[1]) == client.process.pid
                )
            except (OSError, ValueError, subprocess.SubprocessError):
                client.cleanup_errors.append("process_group_readback_unavailable")
            if receipt["owned_process_group_remaining"]:
                client.cleanup_errors.append("owned_process_group_remaining")
        receipt["stderr_bytes_drained"] = client.stderr_bytes
        receipt["cleanup_errors"] = client.cleanup_errors
        if client.cleanup_errors:
            receipt["status"] = "FAIL"
        if options.output:
            Path(options.output).write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(receipt, ensure_ascii=False, indent=2))
    return 0 if receipt.get("status") == "PASS" else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=None, help="Path to MCP JSON configuration file")
    parser.add_argument("--server", default="zov-cua", help="MCP server key to probe (default: zov-cua)")
    parser.add_argument("--guard", action="store_true", help="Verify subagent metadata refusal without GUI writes")
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--output", help="Optional path to write JSON receipt")
    options = parser.parse_args()
    if options.timeout <= 0:
        parser.error("timeout must be positive")
    try:
        return asyncio.run(probe(options))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
