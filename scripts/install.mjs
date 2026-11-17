#!/usr/bin/env node
/**
 * Turnkey Installer & Uninstaller for macOS Computer Use Kit
 *
 * Installs:
 * 1. Two production skills: `computer-use-orchestrator` & `zcode-computer-use` (with `rpc_probe.py`)
 * 2. Self-contained open-source macOS AX MCP Server (`@zcode-community/mcp-server`)
 * 3. Optional ZCode Native Helper bridges (`zcode-cua-bridge.mjs` & `zcode-cua-visible-bridge.mjs`)
 * 4. Atomic non-destructive MCP configuration merge + automatic read-only protocol & subagent guard verification.
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
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const KIT_OWNERSHIP_MARKER = ".kit-owned.json";

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
    // Pre-existing user skill directory without kit ownership marker
    return true;
  }
  const destMd = join(destSkill, "SKILL.md");
  const tplMd = join(templateDir, "SKILL.md");
  if (existsSync(destMd) && existsSync(tplMd)) {
    if (readFileSync(destMd, "utf-8") !== readFileSync(tplMd, "utf-8")) {
      return true;
    }
  }
  // Also preserve if user placed extra files inside the skill directory
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
  const kitHome = join(opts.home, ".local/share/macos-computer-use-kit");
  const runtimeTarget = join(kitHome, "runtime");
  const bridgesTarget = join(kitHome, "bridges");
  const nodeBin = process.execPath;

  const targets = resolveClientTargets(opts.home, opts.client);

  // Preflight: parse and validate ALL target MCP config files BEFORE touching any files on disk
  for (const t of targets) {
    if (existsSync(t.mcpConfigPath)) {
      loadJsonSafe(t.mcpConfigPath, opts.dryRun);
    }
  }

  if (opts.uninstall) {
    console.log("=== Uninstalling macOS Computer Use Kit ===");
    for (const t of targets) {
      for (const skillName of ["computer-use-orchestrator", "zcode-computer-use"]) {
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
            writeJsonAtomic(t.mcpConfigPath, cfg);
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
    "@zcode-community",
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

  const zcodeAvailable = hasZCodeInstallation(opts.home);
  let effectiveMode = opts.mode;
  if (effectiveMode === "auto") {
    effectiveMode = zcodeAvailable ? "both" : "open";
  }
  if ((effectiveMode === "zcode" || effectiveMode === "both") && !zcodeAvailable) {
    console.warn(
      "[warn] Compatible local ZCode CUA helper not detected; falling back to pure open-source 'open' mode."
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
    const installedHelper = join(
      runtimeTarget,
      "node_modules",
      "@zcode-community",
      "platform-macos",
      "dist",
      "bin",
      "macos-ax-helper"
    );
    if (existsSync(installedHelper)) {
      chmodSync(installedHelper, 0o755);
    }

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
              installed_by: "macos-computer-use-kit",
              skill: skillName,
              installed_at: new Date().toISOString(),
            },
            null,
            2
          ) + "\n",
          "utf-8"
        );
      }
      const probeScript = join(t.skillsDir, "zcode-computer-use", "scripts", "rpc_probe.py");
      if (existsSync(probeScript)) chmodSync(probeScript, 0o755);
    }
    console.log(`[2/3] Installed skills (computer-use-orchestrator, zcode-computer-use) -> ${t.skillsDir}`);

    const cfg = loadJsonSafe(t.mcpConfigPath, opts.dryRun);
    if (!cfg.mcpServers || typeof cfg.mcpServers !== "object" || Array.isArray(cfg.mcpServers)) {
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
      cfg.mcpServers["zcode-cua"] = zcodeBridgeEntry;
      cfg.mcpServers["zcode-cua-visible"] = zcodeVisibleEntry;
      cfg.mcpServers["cua-open"] = openServerEntry;
    }

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
    let probePy = join(primaryTarget.skillsDir, "zcode-computer-use", "scripts", "rpc_probe.py");
    if (!existsSync(probePy)) {
      probePy = join(rootDir, "skills", "zcode-computer-use", "scripts", "rpc_probe.py");
    }
    console.log("[3/3] Verifying MCP stdio handshake, native helper readiness & subagent safety guard...");
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
