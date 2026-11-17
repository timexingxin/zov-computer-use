#!/usr/bin/env node
/**
 * Package-manager-agnostic TypeScript workspace builder & self-contained bundler.
 * Compiles native Swift AX helper on macOS and native C# UIA helper on Windows.
 */
import { cpSync, chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const PACKAGES_ORDER = [
  "core",
  "platform-macos",
  "platform-windows",
  "platform-linux",
  "mcp-server",
  "cli",
];

const args = new Set(process.argv.slice(2));
const isClean = args.has("--clean");
const isTypecheck = args.has("--typecheck");

if (isClean) {
  for (const pkg of PACKAGES_ORDER) {
    rmSync(join(rootDir, "packages", pkg, "dist"), { recursive: true, force: true });
    rmSync(join(rootDir, "packages", pkg, "tsconfig.tsbuildinfo"), { force: true });
  }
  rmSync(join(rootDir, "dist"), { recursive: true, force: true });
  console.log("[clean] Removed dist artifacts.");
  process.exit(0);
}

function findTscJs() {
  const candidates = [
    join(rootDir, "node_modules", "typescript", "bin", "tsc"),
    join(rootDir, "node_modules", ".pnpm", "node_modules", "typescript", "bin", "tsc"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error("TypeScript compiler (tsc) not found in node_modules. Run npm install or pnpm install first.");
}

function findWindowsCsc() {
  const windir = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
  const candidates = [
    join(windir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    join(windir, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `Built-in .NET Framework C# compiler (csc.exe) not found under ${windir}\\Microsoft.NET. Ensure .NET Framework 4.x is enabled on Windows.`
  );
}

const tscBin = findTscJs();

for (const pkg of PACKAGES_ORDER) {
  const pkgDir = join(rootDir, "packages", pkg);
  const needsEmitForDownstream =
    isTypecheck && pkg !== "cli" && !existsSync(join(pkgDir, "dist", "index.d.ts"));
  const tscArgs = isTypecheck && !needsEmitForDownstream ? ["--noEmit", "-p", pkgDir] : ["-p", pkgDir];
  execFileSync(process.execPath, [tscBin, ...tscArgs], {
    cwd: pkgDir,
    stdio: "inherit",
  });
}

if (!isTypecheck) {
  // 1. macOS: compile native Swift AX helper via /usr/bin/swiftc
  if (process.platform === "darwin") {
    try {
      execFileSync("/usr/bin/xcode-select", ["-p"], { stdio: "pipe" });
    } catch {
      throw new Error(
        "Xcode Command Line Tools are required on macOS to compile macos-ax-helper. Run 'xcode-select --install' first."
      );
    }
    if (!existsSync("/usr/bin/swiftc")) {
      throw new Error(
        "Swift compiler (/usr/bin/swiftc) not found. Install Xcode Command Line Tools via 'xcode-select --install'."
      );
    }
    const swiftSrc = join(rootDir, "packages", "platform-macos", "native", "macos-ax-helper.swift");
    const swiftBinDir = join(rootDir, "packages", "platform-macos", "dist", "bin");
    const swiftOut = join(swiftBinDir, "macos-ax-helper");
    if (!existsSync(swiftSrc)) {
      throw new Error(`Native Swift source missing at ${swiftSrc}`);
    }
    mkdirSync(swiftBinDir, { recursive: true });
    execFileSync("/usr/bin/swiftc", ["-O", swiftSrc, "-o", swiftOut], { stdio: "inherit" });
    chmodSync(swiftOut, 0o755);
    if (!existsSync(swiftOut)) {
      throw new Error(`Failed to produce compiled macos-ax-helper binary at ${swiftOut}`);
    }
  }

  // 2. Windows: compile native C# UIA + Win32 helper via built-in .NET Framework csc.exe
  if (process.platform === "win32") {
    const cscExe = findWindowsCsc();
    const wpfLibDir = join(dirname(cscExe), "WPF");
    const csSrc = join(rootDir, "packages", "platform-windows", "native", "windows-uia-helper.cs");
    const winBinDir = join(rootDir, "packages", "platform-windows", "dist", "bin");
    const winOut = join(winBinDir, "windows-uia-helper.exe");
    if (!existsSync(csSrc)) {
      throw new Error(`Native Windows C# source missing at ${csSrc}`);
    }
    mkdirSync(winBinDir, { recursive: true });
    execFileSync(
      cscExe,
      [
        "/nologo",
        "/optimize+",
        "/target:exe",
        `/out:${winOut}`,
        `/lib:${wpfLibDir}`,
        "/r:System.dll",
        "/r:System.Core.dll",
        "/r:System.Drawing.dll",
        "/r:System.Windows.Forms.dll",
        "/r:WindowsBase.dll",
        "/r:UIAutomationClient.dll",
        "/r:UIAutomationTypes.dll",
        csSrc,
      ],
      { stdio: "inherit" }
    );
    if (!existsSync(winOut)) {
      throw new Error(`Failed to produce compiled windows-uia-helper.exe binary at ${winOut}`);
    }
  }

  const serverBin = join(rootDir, "packages", "mcp-server", "dist", "bin", "server.js");
  const cliBin = join(rootDir, "packages", "cli", "bin", "cua.mjs");
  if (existsSync(serverBin)) chmodSync(serverBin, 0o755);
  if (existsSync(cliBin)) chmodSync(cliBin, 0o755);

  // Assemble self-contained portable runtime in dist/runtime (zero external dependencies)
  const runtimeDir = join(rootDir, "dist", "runtime");
  const runtimeDist = join(runtimeDir, "dist");
  const runtimeModules = join(runtimeDir, "node_modules", "@zov");

  rmSync(runtimeDir, { recursive: true, force: true });
  mkdirSync(runtimeDist, { recursive: true });
  mkdirSync(runtimeModules, { recursive: true });

  cpSync(join(rootDir, "packages", "mcp-server", "dist"), runtimeDist, { recursive: true });
  cpSync(join(rootDir, "packages", "mcp-server", "package.json"), join(runtimeDir, "package.json"));

  for (const sub of ["core", "platform-macos", "platform-windows", "platform-linux"]) {
    const target = join(runtimeModules, sub);
    mkdirSync(target, { recursive: true });
    cpSync(join(rootDir, "packages", sub, "dist"), join(target, "dist"), { recursive: true });
    cpSync(join(rootDir, "packages", sub, "package.json"), join(target, "package.json"));
  }

  chmodSync(join(runtimeDist, "bin", "server.js"), 0o755);
  console.log("[build] Built all workspace packages and assembled self-contained runtime at dist/runtime.");
}
