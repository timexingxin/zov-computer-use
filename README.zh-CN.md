# Zov Computer Use（macOS + Windows 双平台原生桌面操控套件）

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%2013%2B%20%7C%20Windows%2010%2F11-black.svg)](#一分钟快速安装)

[English README](./README.md)

**Zov Computer Use** 是一套面向 **Antigravity**、**Claude Code**、**Cursor**、**Qoder** 等 AI Agent 客户端的 **macOS + Windows 双平台真原生桌面操控（Computer Use）开箱套件**，内置双层操控 Skill 与纯自研双端原生编译无障碍 MCP 服务端（`zov-cua`）。

无需安装任何闭源第三方软件或额外编译工具链：在 macOS 上自动通过 `/usr/bin/swiftc` 编译原生 `macos-ax-helper`，在 Windows 10/11 上自动调用系统内置 `.NET Framework 4.x csc.exe` 编译原生 `windows-uia-helper.exe`，提供**后台零焦点抢占、不乱动物理鼠标、高压缩极低延迟**的桌面自动化能力。

---

## 包含组件

1. **双平台自适应实战 Skills（`skills/`）**
   - **`computer-use-orchestrator`**：总控路由与安全策略层——遵循“API/CLI 优先 → 网页走浏览器 DOM 工具 → 原生桌面走 `zov-cua` 语义树”，内置单写入者窗口约束、后台安全关窗及异常恢复规则。
   - **`zov-computer-use`**：具体工具执行协议——规范 `Observe → Act → Verify` 闭环、状态质量分级（GOOD / DEGRADED / FAILED）、`return_state="compact"` 单轮原子刷新、macOS（`⌘⇧G`）与 Windows 原生文件对话框处理、DPI 缩放对齐与高危动作护栏，并附带跨平台只读验收探针 `scripts/rpc_probe.py`。
2. **双平台原生编译 MCP 服务端（`packages/`，`zov-cua`）**
   - **macOS 原生引擎（`macos-ax-helper`）**：基于 Swift `ApplicationServices` + `CoreGraphics`，支持深层 AX 树采集、后台零焦点 `AXPress` / `AXValue`、TOCTOU 二次身份校验、遮挡检测坐标兜底与 `postToPid` 后台按键。
   - **Windows 原生引擎（`windows-uia-helper.exe`）**：基于系统内置 C# `UIAutomationClient` + Win32 `PrintWindow` / `SendInput`（启用 Per-Monitor DPI v2），彻底摒弃慢速且易注入的 PowerShell 拼接；支持后台零焦点 `InvokePattern`、`ValuePattern.SetValue`、`TogglePattern`、`PrintWindow(PW_RENDERFULLCONTENT)` 后台窗口无遮挡截图、`WindowFromPoint` 遮挡拦截与原生 `IsPassword` 密码框自动脱敏（`[REDACTED_PASSWORD]`）。
   - 统一暴露 **47 个标准工具**（`list_apps`、`list_windows`、`get_app_state`、`left_click`/`click`、`set_value`、`perform_action`、`open_application`/`launch_app`、`screenshot`、`request_access`、`stop_computer_control`、剪贴板读写及紧凑/增量状态压缩）。

---

## 一分钟快速安装

### macOS（13+）
- **环境要求**：Node.js >= 20，Xcode Command Line Tools（`xcode-select --install`）
```bash
git clone https://github.com/timexingxin/zov-computer-use.git
cd zov-computer-use
./install.sh
```
安装完成后，在 **系统设置 → 隐私与安全性 → 辅助功能（Accessibility）**（如需截图兜底含**屏幕录制**）中勾选你的宿主软件即可。

### Windows（10 / 11）
- **环境要求**：Node.js >= 20，Python 3.9+（可选，用于运行安装后只读探针；C# 编译器 `csc.exe` 与 UIA 组件已内置于原版 Windows 系统目录）
```powershell
git clone https://github.com/timexingxin/zov-computer-use.git
cd zov-computer-use
.\install.ps1
```
（或在 CMD 中执行 `install.cmd`。）安装并自动通过 `rpc_probe.py --guard` 探针后，重启客户端会话即可加载 `zov-cua`。

---

## 常用安装与卸载参数

```bash
# macOS: ./install.sh [参数]   |   Windows: .\install.ps1 [参数]
--client <auto|antigravity|claude|cursor|qoder|all>   # 指定安装的客户端（默认 auto 自动识别）
--preserve-skills                                     # 仅升级运行时，保留已自定义的 SKILL.md
--dry-run                                             # 仅预览变更路径，不写入磁盘
--skip-probe                                          # 跳过安装后的 Python 只读协议探针
--uninstall                                           # 干净卸载本套件安装的 Skills、运行时与 zov-cua 配置项
```

---

## 自检与测试命令

```bash
# 检查当前操作系统环境、原生编译产物与权限状态
npm run doctor

# 运行全量单元测试、协议测试、原生黄金测试、红队对抗测试与安装器端到端测试
npm test
```

---

## 开源许可与声明

本项目基于 [Apache-2.0 License](./LICENSE) 开源，详见 [NOTICE](./NOTICE)。仓库内不包含任何第三方闭源二进制文件。
