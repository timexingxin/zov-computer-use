#!/usr/bin/env node
/**
 * Turnkey Installer & Uninstaller for Zov Computer Use
 *
 * Installs:
 * 1. Two production skills: `computer-use-orchestrator` & `zov-computer-use` (with `rpc_probe.py`)
 * 2. Self-contained native macOS Accessibility & CoreGraphics MCP Server (`@zov/mcp-server`)
 * 3. Atomic non-destructive MCP configuration merge (`zov-cua`) + automatic read-only protocol & subagent guard verification.
 */
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const KIT_OWNERSHIP_MARKER = ".kit-owned.json";
const SKILL_NAMES = ["computer-use-orchestrator", "zov-computer-use"];

function parseArgs(argv) {
  const opts = {
    client: "auto",      // auto | antigravity | claude | cursor | all
    home: homedir(),
    dryRun: false,
    uninstall: false,
    skipProbe: false,
    preserveSkills: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--client" && argv[i + 1]) opts.client = argv[++i];
    else if (a.startsWith("--client=")) opts.client = a.split("=")[1];
    else if (a === "--home" && argv[i + 1]) opts.home = resolve(argv[++i]);
    else if (a.startsWith("--home=")) opts.home = resolve(a.split("=")[1]);
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--uninstall") opts.uninstall = true;
    else if (a === "--skip-probe") opts.skipProbe = true;
    else if (a === "--preserve-skills") opts.preserveSkills = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: ./install.sh [options]

Options:
  --client <auto|antigravity|claude|cursor|all>   Target AI agent client (default: auto)
  --home <path>                                   Override target HOME directory
  --preserve-skills                               Keep existing SKILL.md files if already customized
  --dry-run                                       Preview actions without modifying files
  --skip-probe                                    Skip post-install MCP stdio probe
  --uninstall                                     Remove kit-owned skills, runtime, and MCP entries
  -h, --help                                      Show help
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${a}`);
    }
  }
  return opts;
}

function resolveClientTargets(targetHome, clientOpt) {
  const antigravitySkills =
    existsSync(join(targetHome, ".gemini/config/skills")) || !existsSync(join(targetHome, ".gemini/antigravity/skills"))
      ? join(targetHome, ".gemini/config/skills")
      : join(targetHome, ".gemini/antigravity/skills");

  const antigravityMcp =
    existsSync(join(targetHome, ".gemini/config/mcp_config.json")) || !existsSync(join(targetHome, ".gemini/antigravity/mcp_config.json"))
      ? join(targetHome, ".gemini/config/mcp_config.json")
      : join(targetHome, ".gemini/antigravity/mcp_config.json");

  const definitions = {
    antigravity: {
      name: "Antigravity",
      skillsDir: antigravitySkills,
      mcpConfigPath: antigravityMcp,
    },
    claude: {
      name: "Claude Code",
      skillsDir: join(targetHome, ".claude/skills"),
      mcpConfigPath: join(targetHome, ".claude.json"),
    },
    cursor: {
      name: "Cursor",
      skillsDir: join(targetHome, ".cursor/skills"),
      mcpConfigPath: join(targetHome, ".cursor/mcp.json"),
    },
  };

  if (clientOpt === "all") {
    return [definitions.antigravity, definitions.claude, definitions.cursor];
  }
  if (definitions[clientOpt]) {
    return [definitions[clientOpt]];
  }
  if (clientOpt !== "auto") {
    throw new Error(`Invalid --client value: ${clientOpt}`);
  }

  const detected = [];
  if (existsSync(join(targetHome, ".gemini"))) detected.push(definitions.antigravity);
  if (existsSync(join(targetHome, ".claude")) || existsSync(join(targetHome, ".claude.json"))) {
    detected.push(definitions.claude);
  }
  if (existsSync(join(targetHome, ".cursor"))) detected.push(definitions.cursor);

  return detected.length > 0 ? detected : [definitions.antigravity];
}

function loadJsonSafe(path, dryRun = false) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Top-level JSON value must be an object");
    }
    return parsed;
  } catch (err) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const corruptBak = `${path}.corrupt-bak-${stamp}`;
    if (!dryRun) {
      try {
        copyFileSync(path, corruptBak);
      } catch {}
    }
    throw new Error(
      `Malformed JSON in ${path} (${err.message}). Backed up original file to ${corruptBak} and aborted before modifying any files.`
    );
  }
}

function writeJsonAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  renameSync(tmpPath, path);
}

function backupIfExists(path, dryRun) {
  if (!existsSync(path)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = `${path}.bak-${stamp}`;
  if (!dryRun) copyFileSync(path, bak);
  return bak;
}

function shouldBackupSkillDir(destSkill, templateDir) {
  if (!existsSync(destSkill)) return false;
  if (!existsSync(join(destSkill, KIT_OWNERSHIP_MARKER))) {
    return true;
  }
  const destMd = join(destSkill, "SKILL.md");
  const tplMd = join(templateDir, "SKILL.md");
  if (existsSync(destMd) && existsSync(tplMd)) {
    if (readFileSync(destMd, "utf-8") !== readFileSync(tplMd, "utf-8")) {
      return true;
    }
  }
  const entries = readdirSync(destSkill).filter((n) => n !== KIT_OWNERSHIP_MARKER);
  const tplEntries = readdirSync(templateDir);
  if (entries.some((e) => !tplEntries.includes(e))) {
    return true;
  }
  return false;
}

function verifyPython3Available() {
  try {
    execFileSync("python3", ["-c", "import sys; assert sys.version_info >= (3, 9)"], { stdio: "pipe" });
  } catch {
    throw new Error(
      "Python 3.9+ is required to run rpc_probe.py (run 'xcode-select --install' on macOS, or pass '--skip-probe')."
    );
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const kitHome = join(opts.home, ".local/share/zov-computer-use");
  const runtimeTarget = join(kitHome, "runtime");
  const nodeBin = process.execPath;

  const targets = resolveClientTargets(opts.home, opts.client);

  // Preflight: parse and validate ALL target MCP config files BEFORE touching any files on disk
  for (const t of targets) {
    if (existsSync(t.mcpConfigPath)) {
      loadJsonSafe(t.mcpConfigPath, opts.dryRun);
    }
  }

  if (opts.uninstall) {
    console.log("=== Uninstalling Zov Computer Use ===");
    for (const t of targets) {
      for (const skillName of SKILL_NAMES) {
        const sPath = join(t.skillsDir, skillName);
        if (existsSync(sPath)) {
          if (existsSync(join(sPath, KIT_OWNERSHIP_MARKER))) {
            console.log(`[remove] Kit-owned skill: ${sPath}`);
            if (!opts.dryRun) rmSync(sPath, { recursive: true, force: true });
          } else {
            console.log(`[preserve] Skipping user-owned skill directory (no ${KIT_OWNERSHIP_MARKER}): ${sPath}`);
          }
        }
      }
      if (existsSync(t.mcpConfigPath)) {
        const cfg = loadJsonSafe(t.mcpConfigPath, opts.dryRun);
        if (cfg.mcpServers && typeof cfg.mcpServers === "object") {
          const entry = cfg.mcpServers["zov-cua"];
          if (entry && JSON.stringify(entry).includes("zov-computer-use")) {
            delete cfg.mcpServers["zov-cua"];
            console.log(`[remove] MCP server 'zov-cua' from ${t.mcpConfigPath}`);
            if (!opts.dryRun) {
              backupIfExists(t.mcpConfigPath, opts.dryRun);
              writeJsonAtomic(t.mcpConfigPath, cfg);
            }
          }
        }
      }
    }
    if (existsSync(kitHome)) {
      console.log(`[remove] Runtime directory: ${kitHome}`);
      if (!opts.dryRun) rmSync(kitHome, { recursive: true, force: true });
    }
    console.log("[DONE] Uninstall complete.");
    return;
  }

  if (!opts.dryRun && !opts.skipProbe) {
    verifyPython3Available();
  }

  // Ensure built runtime exists (including compiled macos-ax-helper on Darwin)
  const builtRuntime = join(rootDir, "dist", "runtime", "dist", "bin", "server.js");
  const builtHelper = join(
    rootDir,
    "dist",
    "runtime",
    "node_modules",
    "@zov",
    "platform-macos",
    "dist",
    "bin",
    "macos-ax-helper"
  );
  if (!existsSync(builtRuntime) || (process.platform === "darwin" && !existsSync(builtHelper))) {
    console.log("[setup] Building workspace packages first...");
    if (!opts.dryRun) {
      execFileSync(process.execPath, [join(rootDir, "scripts", "build-all.mjs")], {
        cwd: rootDir,
        stdio: "inherit",
      });
    }
  }

  console.log("====================================================");
  console.log(" Installing Zov Computer Use");
  console.log(" Backend      : Native macOS AX + CoreGraphics MCP (@zov/mcp-server)");
  console.log(` Targets      : ${targets.map((t) => t.name).join(", ")}`);
  console.log("====================================================");

  // 1. Install self-contained runtime
  if (!opts.dryRun) {
    rmSync(runtimeTarget, { recursive: true, force: true });
    mkdirSync(runtimeTarget, { recursive: true });
    cpSync(join(rootDir, "dist", "runtime"), runtimeTarget, { recursive: true });
    chmodSync(join(runtimeTarget, "dist", "bin", "server.js"), 0o755);
    const installedHelper = join(
      runtimeTarget,
      "node_modules",
      "@zov",
      "platform-macos",
      "dist",
      "bin",
      "macos-ax-helper"
    );
    if (existsSync(installedHelper)) {
      chmodSync(installedHelper, 0o755);
    }
  }
  console.log(`[1/3] Installed self-contained MCP runtime -> ${kitHome}`);

  const serverEntry = {
    command: nodeBin,
    args: [join(runtimeTarget, "dist", "bin", "server.js")],
  };

  // 2. Install skills & merge MCP config per client
  for (const t of targets) {
    if (!opts.dryRun) {
      mkdirSync(t.skillsDir, { recursive: true });
      for (const skillName of SKILL_NAMES) {
        const destSkill = join(t.skillsDir, skillName);
        const existingSkillMd = join(destSkill, "SKILL.md");
        const templateDir = join(rootDir, "skills", skillName);
        if (opts.preserveSkills && existsSync(existingSkillMd)) {
          console.log(`[2/3] Preserved customized skill -> ${existingSkillMd}`);
          continue;
        }
        if (shouldBackupSkillDir(destSkill, templateDir)) {
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          const dirBak = `${destSkill}.bak-${stamp}`;
          cpSync(destSkill, dirBak, { recursive: true });
          console.log(`      Backed up existing skill directory -> ${dirBak}`);
        }
        rmSync(destSkill, { recursive: true, force: true });
        cpSync(templateDir, destSkill, { recursive: true });
        writeFileSync(
          join(destSkill, KIT_OWNERSHIP_MARKER),
          JSON.stringify(
            {
              installed_by: "zov-computer-use",
              skill: skillName,
              installed_at: new Date().toISOString(),
            },
            null,
            2
          ) + "\n",
          "utf-8"
        );
      }
      const probeScript = join(t.skillsDir, "zov-computer-use", "scripts", "rpc_probe.py");
      if (existsSync(probeScript)) chmodSync(probeScript, 0o755);
    }
    console.log(`[2/3] Installed skills (computer-use-orchestrator, zov-computer-use) -> ${t.skillsDir}`);

    const cfg = loadJsonSafe(t.mcpConfigPath, opts.dryRun);
    if (!cfg.mcpServers || typeof cfg.mcpServers !== "object" || Array.isArray(cfg.mcpServers)) {
      cfg.mcpServers = {};
    }
    cfg.mcpServers["zov-cua"] = serverEntry;

    if (!opts.dryRun) {
      const bak = backupIfExists(t.mcpConfigPath, opts.dryRun);
      if (bak) console.log(`      Backed up existing config -> ${bak}`);
      writeJsonAtomic(t.mcpConfigPath, cfg);
    }
    console.log(`      Updated MCP config -> ${t.mcpConfigPath}`);
  }

  // 3. Run read-only MCP handshake, helper binary smoke check & subagent guard probe
  if (!opts.dryRun && !opts.skipProbe) {
    const primaryTarget = targets[0];
    let probePy = join(primaryTarget.skillsDir, "zov-computer-use", "scripts", "rpc_probe.py");
    if (!existsSync(probePy)) {
      probePy = join(rootDir, "skills", "zov-computer-use", "scripts", "rpc_probe.py");
    }
    console.log("[3/3] Verifying MCP stdio handshake, native helper readiness & subagent safety guard...");
    execFileSync(
      "python3",
      [probePy, "--config", primaryTarget.mcpConfigPath, "--server", "zov-cua", "--guard"],
      {
        env: { ...process.env, HOME: opts.home },
        stdio: "inherit",
      }
    );
  } else {
    console.log("[3/3] Probe skipped (--dry-run or --skip-probe).");
  }

  console.log("\n[SUCCESS] Zov Computer Use is ready.");
  console.log("Next step on macOS: Ensure your terminal / agent app has Accessibility permission enabled in:");
  console.log("  System Settings -> Privacy & Security -> Accessibility");
}

main();
