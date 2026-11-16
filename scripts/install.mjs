#!/usr/bin/env node
/**
 * Turnkey Installer & Uninstaller for macOS Computer Use Kit
 *
 * Installs:
 * 1. Two production skills: `computer-use-orchestrator` & `zcode-computer-use` (with `rpc_probe.py`)
 * 2. Self-contained open-source macOS AX MCP Server (`@zcode-community/mcp-server`)
 * 3. Optional ZCode Native Helper bridges (`zcode-cua-bridge.mjs` & `zcode-cua-visible-bridge.mjs`)
 * 4. Non-destructive MCP configuration merge + automatic read-only protocol & subagent guard verification.
 */
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

function parseArgs(argv) {
  const opts = {
    client: "auto",      // auto | antigravity | claude | cursor | all
    mode: "auto",        // auto | open | zcode | both
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
    else if (a === "--mode" && argv[i + 1]) opts.mode = argv[++i];
    else if (a.startsWith("--mode=")) opts.mode = a.split("=")[1];
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
  --mode <auto|open|zcode|both>                   Backend mode (default: auto -> open native AX)
  --home <path>                                   Override target HOME directory
  --preserve-skills                               Keep existing SKILL.md files if already customized
  --dry-run                                       Preview actions without modifying files
  --skip-probe                                    Skip post-install MCP stdio probe
  --uninstall                                     Remove installed kit skills, runtime, and MCP entries
  -h, --help                                      Show help
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${a}`);
    }
  }
  return opts;
}

function hasZCodeInstallation(targetHome) {
  const appCandidates = [
    "/Applications/ZCode.app/Contents/MacOS/ZCode",
    join(targetHome, "Applications/ZCode.app/Contents/MacOS/ZCode"),
  ];
  const hasApp = appCandidates.some((p) => existsSync(p));
  const cacheDir = join(targetHome, ".zcode/cli/plugins/cache/zcode-plugins-official/computer-use");
  if (!hasApp || !existsSync(cacheDir)) return false;

  // ZCode >= 3.18.0 blocks external ELECTRON_RUN_AS_NODE bridge connections via verifyPeer.
  const helperMetaPath = join(targetHome, ".zcode/computer-use/.zcode-cua-helper-meta.json");
  if (existsSync(helperMetaPath)) {
    try {
      const meta = JSON.parse(readFileSync(helperMetaPath, "utf-8"));
      const [maj = 0, min = 0] = String(meta.version || "0.0.0").split(".").map(Number);
      if (maj > 3 || (maj === 3 && min >= 18)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  try {
    return readdirSync(cacheDir).some((v) => {
      const p = join(cacheDir, v, "dist/mcp/server.js");
      return statSync(join(cacheDir, v)).isDirectory() && existsSync(p);
    });
  } catch {
    return false;
  }
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

function loadJsonSafe(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function backupIfExists(path, dryRun) {
  if (!existsSync(path)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = `${path}.bak-${stamp}`;
  if (!dryRun) copyFileSync(path, bak);
  return bak;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const kitHome = join(opts.home, ".local/share/macos-computer-use-kit");
  const runtimeTarget = join(kitHome, "runtime");
  const bridgesTarget = join(kitHome, "bridges");
  const nodeBin = process.execPath;

  const targets = resolveClientTargets(opts.home, opts.client);

  if (opts.uninstall) {
    console.log("=== Uninstalling macOS Computer Use Kit ===");
    for (const t of targets) {
      for (const skillName of ["computer-use-orchestrator", "zcode-computer-use"]) {
        const sPath = join(t.skillsDir, skillName);
        if (existsSync(sPath)) {
          console.log(`[remove] Skill: ${sPath}`);
          if (!opts.dryRun) rmSync(sPath, { recursive: true, force: true });
        }
      }
      if (existsSync(t.mcpConfigPath)) {
        const cfg = loadJsonSafe(t.mcpConfigPath);
        if (cfg.mcpServers && typeof cfg.mcpServers === "object") {
          let modified = false;
          for (const key of ["zcode-cua", "zcode-cua-visible", "cua-open"]) {
            const entry = cfg.mcpServers[key];
            if (entry && JSON.stringify(entry).includes("macos-computer-use-kit")) {
              delete cfg.mcpServers[key];
              modified = true;
              console.log(`[remove] MCP server '${key}' from ${t.mcpConfigPath}`);
            }
          }
          if (modified && !opts.dryRun) {
            backupIfExists(t.mcpConfigPath, opts.dryRun);
            writeFileSync(t.mcpConfigPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
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

  // Ensure built runtime exists
  const builtRuntime = join(rootDir, "dist", "runtime", "dist", "bin", "server.js");
  if (!existsSync(builtRuntime)) {
    console.log("[setup] Building workspace packages first...");
    if (!opts.dryRun) {
      execFileSync(process.execPath, [join(rootDir, "scripts", "build-all.mjs")], {
        cwd: rootDir,
        stdio: "inherit",
      });
    }
  }

  const zcodeAvailable = hasZCodeInstallation(opts.home);
  let effectiveMode = opts.mode;
  if (effectiveMode === "auto") {
    effectiveMode = zcodeAvailable ? "both" : "open";
  }
  if ((effectiveMode === "zcode" || effectiveMode === "both") && !zcodeAvailable) {
    console.warn(
      "[warn] Local ZCode.app + CUA plugin cache not detected; falling back to pure open-source 'open' mode."
    );
    effectiveMode = "open";
  }

  console.log("====================================================");
  console.log(" Installing macOS Computer Use Kit");
  console.log(` Backend Mode : ${effectiveMode} (${effectiveMode === "open" ? "Built-in Open-Source macOS AX MCP" : "ZCode Native Bridges + Open-Source AX Fallback"})`);
  console.log(` Targets      : ${targets.map((t) => t.name).join(", ")}`);
  console.log("====================================================");

  // 1. Install runtime & bridges
  if (!opts.dryRun) {
    rmSync(runtimeTarget, { recursive: true, force: true });
    mkdirSync(runtimeTarget, { recursive: true });
    cpSync(join(rootDir, "dist", "runtime"), runtimeTarget, { recursive: true });
    chmodSync(join(runtimeTarget, "dist", "bin", "server.js"), 0o755);

    mkdirSync(bridgesTarget, { recursive: true });
    for (const b of ["zcode-cua-bridge.mjs", "zcode-cua-visible-bridge.mjs"]) {
      const dest = join(bridgesTarget, b);
      cpSync(join(rootDir, "bridges", b), dest);
      chmodSync(dest, 0o755);
    }
  }
  console.log(`[1/3] Installed self-contained MCP runtime & bridges -> ${kitHome}`);

  const openServerEntry = {
    command: nodeBin,
    args: [join(runtimeTarget, "dist", "bin", "server.js")],
  };
  const zcodeBridgeEntry = {
    command: nodeBin,
    args: [join(bridgesTarget, "zcode-cua-bridge.mjs")],
  };
  const zcodeVisibleEntry = {
    command: nodeBin,
    args: [join(bridgesTarget, "zcode-cua-visible-bridge.mjs")],
  };

  // 2. Install skills & merge MCP config per client
  for (const t of targets) {
    if (!opts.dryRun) {
      mkdirSync(t.skillsDir, { recursive: true });
      for (const skillName of ["computer-use-orchestrator", "zcode-computer-use"]) {
        const destSkill = join(t.skillsDir, skillName);
        const existingSkillMd = join(destSkill, "SKILL.md");
        const templateSkillMd = join(rootDir, "skills", skillName, "SKILL.md");
        if (opts.preserveSkills && existsSync(existingSkillMd)) {
          console.log(`[2/3] Preserved customized skill -> ${existingSkillMd}`);
          continue;
        }
        let prevSkillContent = null;
        if (existsSync(existingSkillMd)) {
          const cur = readFileSync(existingSkillMd, "utf-8");
          const next = readFileSync(templateSkillMd, "utf-8");
          if (cur !== next) prevSkillContent = cur;
        }
        rmSync(destSkill, { recursive: true, force: true });
        cpSync(join(rootDir, "skills", skillName), destSkill, { recursive: true });
        if (prevSkillContent !== null) {
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          writeFileSync(join(destSkill, `SKILL.md.bak-${stamp}`), prevSkillContent, "utf-8");
        }
      }
      const probeScript = join(t.skillsDir, "zcode-computer-use", "scripts", "rpc_probe.py");
      if (existsSync(probeScript)) chmodSync(probeScript, 0o755);
    }
    console.log(`[2/3] Installed skills (computer-use-orchestrator, zcode-computer-use) -> ${t.skillsDir}`);

    const cfg = loadJsonSafe(t.mcpConfigPath);
    if (!cfg.mcpServers || typeof cfg.mcpServers !== "object") {
      cfg.mcpServers = {};
    }

    if (effectiveMode === "open") {
      cfg.mcpServers["zcode-cua"] = openServerEntry;
      if (
        cfg.mcpServers["zcode-cua-visible"] &&
        JSON.stringify(cfg.mcpServers["zcode-cua-visible"]).includes("zcode-cua-visible-bridge")
      ) {
        delete cfg.mcpServers["zcode-cua-visible"];
      }
    } else if (effectiveMode === "zcode") {
      cfg.mcpServers["zcode-cua"] = zcodeBridgeEntry;
      cfg.mcpServers["zcode-cua-visible"] = zcodeVisibleEntry;
    } else {
      // both
      cfg.mcpServers["zcode-cua"] = zcodeBridgeEntry;
      cfg.mcpServers["zcode-cua-visible"] = zcodeVisibleEntry;
      cfg.mcpServers["cua-open"] = openServerEntry;
    }

    if (!opts.dryRun) {
      mkdirSync(dirname(t.mcpConfigPath), { recursive: true });
      const bak = backupIfExists(t.mcpConfigPath, opts.dryRun);
      if (bak) console.log(`      Backed up existing config -> ${bak}`);
      writeFileSync(t.mcpConfigPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
    }
    console.log(`      Updated MCP config -> ${t.mcpConfigPath}`);
  }

  // 3. Run read-only MCP handshake & subagent guard probe
  if (!opts.dryRun && !opts.skipProbe) {
    const primaryTarget = targets[0];
    const probePy = join(primaryTarget.skillsDir, "zcode-computer-use", "scripts", "rpc_probe.py");
    console.log("[3/3] Verifying MCP stdio handshake & subagent safety guard...");
    execFileSync(
      "python3",
      [probePy, "--config", primaryTarget.mcpConfigPath, "--server", "zcode-cua", "--guard"],
      {
        env: { ...process.env, HOME: opts.home },
        stdio: "inherit",
      }
    );
  } else {
    console.log("[3/3] Probe skipped (--dry-run or --skip-probe).");
  }

  console.log("\n[SUCCESS] macOS Computer Use Kit is ready.");
  console.log("Next step on macOS: Ensure your terminal / agent app has Accessibility permission enabled in:");
  console.log("  System Settings -> Privacy & Security -> Accessibility");
}

main();
