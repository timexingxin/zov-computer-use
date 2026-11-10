#!/usr/bin/env node
/**
 * Repository hygiene, privacy, and secret/path leak gate.
 * Ensures zero personal filesystem paths, zero tokens, and valid skill frontmatter.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "__pycache__"]);

// Build dynamically so this file itself does not contain literal personal strings
const FORBIDDEN_PATTERNS = [
  new RegExp("/Users/" + "timexingxin", "i"),
  /gho_[A-Za-z0-9_]{20,}/,
  /ghp_[A-Za-z0-9_]{20,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  new RegExp("current_" + "chrome_"),
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out;
}

let violations = 0;
for (const file of walk(rootDir)) {
  const rel = relative(rootDir, file);
  const content = readFileSync(file, "utf-8");
  for (const pat of FORBIDDEN_PATTERNS) {
    if (pat.test(content)) {
      console.error(`[lint:FAIL] Forbidden pattern ${pat} matched in ${rel}`);
      violations++;
    }
  }
}

for (const skillRel of [
  "skills/computer-use-orchestrator/SKILL.md",
  "skills/zcode-computer-use/SKILL.md",
]) {
  const text = readFileSync(join(rootDir, skillRel), "utf-8");
  if (!text.startsWith("---\nname:")) {
    console.error(`[lint:FAIL] Missing YAML frontmatter in ${skillRel}`);
    violations++;
  }
}

if (violations > 0) {
  console.error(`[lint] Failed with ${violations} violation(s).`);
  process.exit(1);
}

console.log("[lint] All privacy, secret, and skill frontmatter checks passed.");
