import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCb } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCb);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const cliPkg = JSON.parse(readFileSync(new URL("../packages/cli/package.json", import.meta.url), "utf-8"));
const expectedVersion = cliPkg.version;

test("CLI --version outputs dynamic package version and not hardcoded v0.1.0", async () => {
  const { stdout } = await execFile(process.execPath, ["packages/cli/bin/cua.mjs", "--version"], { cwd: repoRoot });
  assert.equal(stdout.trim(), `zcode-desktop-control v${expectedVersion}`);
  assert.ok(!stdout.includes("v0.1.0"), "Must not contain obsolete hardcoded v0.1.0");
});

test("CLI -v outputs dynamic package version", async () => {
  const { stdout } = await execFile(process.execPath, ["packages/cli/bin/cua.mjs", "-v"], { cwd: repoRoot });
  assert.equal(stdout.trim(), `zcode-desktop-control v${expectedVersion}`);
});

test("CLI version command outputs dynamic package version", async () => {
  const { stdout } = await execFile(process.execPath, ["packages/cli/bin/cua.mjs", "version"], { cwd: repoRoot });
  assert.equal(stdout.trim(), `zcode-desktop-control v${expectedVersion}`);
});

test("CLI --help includes dynamic version header", async () => {
  const { stdout } = await execFile(process.execPath, ["packages/cli/bin/cua.mjs", "--help"], { cwd: repoRoot });
  assert.ok(stdout.includes(`v${expectedVersion}`), `Help output must contain v${expectedVersion}`);
  assert.ok(!stdout.includes("v0.1.0"), "Help output must not contain obsolete v0.1.0");
});

test("Root cua script --version executes successfully via npm/pnpm", async () => {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const res = await execFile(npmCmd, ["run", "--silent", "cua", "--", "--version"], { cwd: repoRoot });
  assert.ok(res.stdout.includes(`zcode-desktop-control v${expectedVersion}`));
});
