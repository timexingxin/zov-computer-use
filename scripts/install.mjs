#!/usr/bin/env node
/**
 * Turnkey Installer & Uninstaller for Zov Computer Use (macOS + Windows)
 *
 * Installs:
 * 1. Two production skills: `computer-use-orchestrator` & `zov-computer-use` (with `rpc_probe.py`)
 * 2. Self-contained native macOS AX/CG or Windows UIA/Win32 MCP Server (`@zov/mcp-server`)
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
  statSync,
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
    client: "auto", // auto | antigravity | claude | cursor | qoder | all
    home: homedir(),
    dryRun: false,
    uninstall: false,
    skipProbe: false,
    preserveSkills: false,
    force: false,
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
    else if (a === "--force") opts.force = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/install.mjs [options]

Options:
  --client <auto|antigravity|claude|cursor|qoder|all>  Target AI agent client (default: auto)
  --home <path>                                        Override target HOME directory
  --preserve-skills                                    Keep existing SKILL.md files if already customized
  --dry-run                                            Preview actions without modifying files
  --skip-probe                                         Skip post-install MCP stdio probe
  --force                                              Allow installing on experimental OS platforms (e.g. Linux)
  --uninstall                                          Remove kit-owned skills, runtime, and MCP entries
  -h, --help                                           Show help
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
    qoder: {
      name: "Qoder",
      skillsDir: join(targetHome, ".qoder/skills"),
      mcpConfigPath: join(targetHome, ".qoder/mcp.json"),
      secondaryMcpConfigPath: join(targetHome, ".qoder/settings.json"),
    },
  };

  if (clientOpt === "all") {
    const base = [definitions.antigravity, definitions.claude, definitions.cursor];
    if (existsSync(join(targetHome, ".qoder"))) base.push(definitions.qoder);
    return base;
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
  if (existsSync(join(targetHome, ".qoder"))) detected.push(definitions.qoder);

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
  const existingMode = existsSync(path) ? statSync(path).mode & 0o777 : null;
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  if (existingMode !== null && process.platform !== "win32") {
    chmodSync(tmpPath, existingMode);
  }
  renameSync(tmpPath, path);
}

function backupIfExists(path, dryRun) {
  if (!existsSync(path)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = `${path}.bak-${stamp}`;
  if (!dryRun) {
    copyFileSync(path, bak);
    if (process.platform !== "win32") {
      try {
        chmodSync(bak, statSync(path).mode & 0o777);
      } catch {}
    }
  }
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

function resolvePythonRunner() {
  const candidates =
    process.platform === "win32"
      ? [
          { bin: "python", prefixArgs: [] },
          { bin: "py", prefixArgs: ["-3"] },
          { bin: "python3", prefixArgs: [] },
        ]
      : [
          { bin: "python3", prefixArgs: [] },
          { bin: "python", prefixArgs: [] },
        ];

  for (const c of candidates) {
    try {
      execFileSync(c.bin, [...c.prefixArgs, "-c", "import sys; assert sys.version_info >= (3, 9)"], {
        stdio: "pipe",
      });
      return c;
    } catch {}
  }
  throw new Error(
    "Python 3.9+ is required to run rpc_probe.py (install Python 3.9+ or pass '--skip-probe')."
  );
}

function expectedNativeHelperPath(baseDir) {
  if (process.platform === "darwin") {
    return join(baseDir, "node_modules", "@zov", "platform-macos", "dist", "bin", "macos-ax-helper");
  }
  if (process.platform === "win32") {
    return join(baseDir, "node_modules", "@zov", "platform-windows", "dist", "bin", "windows-uia-helper.exe");
  }
  return null;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const isCustomSandboxHome = resolve(opts.home) !== resolve(homedir());
  if (
    !opts.uninstall &&
    !opts.dryRun &&
    !opts.force &&
    !isCustomSandboxHome &&
    process.platform !== "darwin" &&
    process.platform !== "win32"
  ) {
    throw new Error(
      `Native GUI backend is currently verified for macOS (darwin) and Windows (win32); current platform is '${process.platform}'. Pass --force or --home <sandbox> to install anyway.`
    );
  }

  const kitHome = join(opts.home, ".local/share/zov-computer-use");
  const runtimeTarget = join(kitHome, "runtime");
  const nodeBin = process.execPath;

  const targets = resolveClientTargets(opts.home, opts.client);

  // Preflight: parse and validate ALL target MCP config files BEFORE touching any files on disk
  for (const t of targets) {
    if (existsSync(t.mcpConfigPath)) {
      loadJsonSafe(t.mcpConfigPath, opts.dryRun);
    }
    if (t.secondaryMcpConfigPath && existsSync(t.secondaryMcpConfigPath)) {
      loadJsonSafe(t.secondaryMcpConfigPath, opts.dryRun);
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
      for (const cfgPath of [t.mcpConfigPath, t.secondaryMcpConfigPath].filter(Boolean)) {
        if (existsSync(cfgPath)) {
          const cfg = loadJsonSafe(cfgPath, opts.dryRun);
          if (cfg.mcpServers && typeof cfg.mcpServers === "object") {
            const entry = cfg.mcpServers["zov-cua"];
            if (entry && JSON.stringify(entry).includes("zov-computer-use")) {
              delete cfg.mcpServers["zov-cua"];
              console.log(`[remove] MCP server 'zov-cua' from ${cfgPath}`);
              if (!opts.dryRun) {
                backupIfExists(cfgPath, opts.dryRun);
                writeJsonAtomic(cfgPath, cfg);
              }
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

  const pyRunner = !opts.dryRun && !opts.skipProbe ? resolvePythonRunner() : null;

  // Ensure built runtime exists (including compiled native helper on Darwin / Win32)
  const builtRuntime = join(rootDir, "dist", "runtime", "dist", "bin", "server.js");
  const builtHelper = expectedNativeHelperPath(join(rootDir, "dist", "runtime"));
  if (!existsSync(builtRuntime) || (builtHelper && !existsSync(builtHelper))) {
    console.log("[setup] Building workspace packages first...");
    if (!opts.dryRun) {
      execFileSync(process.execPath, [join(rootDir, "scripts", "build-all.mjs")], {
        cwd: rootDir,
        stdio: "inherit",
      });
    }
  }

  const backendDesc =
    process.platform === "win32"
      ? "Native Windows UI Automation + Win32 MCP (@zov/mcp-server)"
      : "Native macOS AX + CoreGraphics MCP (@zov/mcp-server)";

  console.log("====================================================");
  console.log(" Installing Zov Computer Use");
  console.log(` Backend      : ${backendDesc}`);
  console.log(` Targets      : ${targets.map((t) => t.name).join(", ")}`);
  console.log("====================================================");

  // 1. Install self-contained runtime
  if (!opts.dryRun) {
    rmSync(runtimeTarget, { recursive: true, force: true });
    mkdirSync(runtimeTarget, { recursive: true });
    cpSync(join(rootDir, "dist", "runtime"), runtimeTarget, { recursive: true });
    if (process.platform !== "win32") {
      chmodSync(join(runtimeTarget, "dist", "bin", "server.js"), 0o755);
      const installedHelper = expectedNativeHelperPath(runtimeTarget);
      if (installedHelper && existsSync(installedHelper)) {
        chmodSync(installedHelper, 0o755);
      }
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
      if (existsSync(probeScript) && process.platform !== "win32") {
        chmodSync(probeScript, 0o755);
      }
    }
    console.log(`[2/3] Installed skills (computer-use-orchestrator, zov-computer-use) -> ${t.skillsDir}`);

    const cfg = loadJsonSafe(t.mcpConfigPath, opts.dryRun);
    if (!cfg.mcpServers || typeof cfg.mcpServers !== "object" || Array.isArray(cfg.mcpServers)) {
      cfg.mcpServers = {};
    }
    cfg.mcpServers["zov-cua"] =
      t.name === "Claude Code"
        ? { type: "stdio", ...serverEntry }
        : t.name === "Qoder"
          ? { ...serverEntry, timeout: 90000, disabled: false }
          : serverEntry;

    if (!opts.dryRun) {
      const bak = backupIfExists(t.mcpConfigPath, opts.dryRun);
      if (bak) console.log(`      Backed up existing config -> ${bak}`);
      writeJsonAtomic(t.mcpConfigPath, cfg);
    }
    console.log(`      Updated MCP config -> ${t.mcpConfigPath}`);

    if (t.secondaryMcpConfigPath && existsSync(t.secondaryMcpConfigPath)) {
      const secCfg = loadJsonSafe(t.secondaryMcpConfigPath, opts.dryRun);
      if (!secCfg.mcpServers || typeof secCfg.mcpServers !== "object" || Array.isArray(secCfg.mcpServers)) {
        secCfg.mcpServers = {};
      }
      secCfg.mcpServers["zov-cua"] = { ...serverEntry, timeout: 90000, disabled: false };
      if (!opts.dryRun) {
        const secBak = backupIfExists(t.secondaryMcpConfigPath, opts.dryRun);
        if (secBak) console.log(`      Backed up secondary config -> ${secBak}`);
        writeJsonAtomic(t.secondaryMcpConfigPath, secCfg);
      }
      console.log(`      Updated secondary MCP config -> ${t.secondaryMcpConfigPath}`);
    }
  }

  // 3. Run read-only MCP handshake, helper binary smoke check & subagent guard probe
  if (!opts.dryRun && !opts.skipProbe && pyRunner) {
    const primaryTarget = targets[0];
    let probePy = join(primaryTarget.skillsDir, "zov-computer-use", "scripts", "rpc_probe.py");
    if (!existsSync(probePy)) {
      probePy = join(rootDir, "skills", "zov-computer-use", "scripts", "rpc_probe.py");
    }
    console.log("[3/3] Verifying MCP stdio handshake, native helper readiness & subagent safety guard...");
    execFileSync(
      pyRunner.bin,
      [...pyRunner.prefixArgs, probePy, "--config", primaryTarget.mcpConfigPath, "--server", "zov-cua", "--guard"],
      {
        env: { ...process.env, HOME: opts.home, USERPROFILE: opts.home },
        stdio: "inherit",
      }
    );
  } else {
    console.log("[3/3] Probe skipped (--dry-run or --skip-probe).");
  }

  console.log("\n[SUCCESS] Zov Computer Use is ready.");
  if (process.platform === "darwin") {
    console.log("Next step on macOS: Ensure your terminal / agent app has Accessibility permission enabled in:");
    console.log("  System Settings -> Privacy & Security -> Accessibility");
  } else if (process.platform === "win32") {
    console.log("Next step on Windows: Restart your agent client to load the zov-cua MCP server.");
  }
}

main();
