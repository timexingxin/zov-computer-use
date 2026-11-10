#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const includeRealGui = process.argv.includes("--real-gui");

const testDir = join(rootDir, "tests");
const testFiles = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => includeRealGui || !f.includes("gui-e2e"))
  .sort()
  .map((f) => join(testDir, f));

console.log(`[test] Running ${testFiles.length} test suites...`);
execFileSync(process.execPath, ["--test", ...testFiles], {
  cwd: rootDir,
  stdio: "inherit",
});
