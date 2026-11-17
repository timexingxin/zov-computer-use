# macOS Computer Use Kit（macOS 桌面操控开箱即用套件）

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%2013%2B-black.svg)](#环境要求)

[English README](./README.md)

这是一套面向 **Antigravity**、**Claude Code**、**Cursor** 等 AI Agent 客户端的 **macOS 电脑操控（Computer Use）一键开箱套件**，将经过实战打磨的两个核心操控 Skill 与纯开源 macOS 无障碍（Accessibility）MCP 后端打包在一起。

别人克隆仓库后只需运行一条 `./install.sh` 命令，无需安装任何闭源软件，即可在自己的 Mac 上直接启用**后台零焦点抢占、不乱动物理鼠标**的原生桌面软件操控能力。

---

## 包含组件

1. **双层实战 Skills（`skills/`）**
   - **`computer-use-orchestrator`**：总控路由与安全策略层——遵循“API/CLI 优先 → 网页走浏览器 DOM 工具 → 原生 Mac 应用走 AX 无障碍语义树”，内置单写入者窗口锁、非焦点窗口安全关闭（`AXCloseButton`）以及异常恢复规则。
   - **`zcode-computer-use`**：具体工具执行协议——规范 `Observe → Act → Verify` 闭环、状态质量分级（GOOD / DEGRADED / FAILED）、`return_state="compact"` 单轮原子刷新、macOS 原生文件选择框（`⌘⇧G`）处理、高危动作护栏，并附带零依赖只读验收探针 `scripts/rpc_probe.py`。
2. **内置纯开源 macOS AX MCP 服务端（`packages/`）**
   - 零闭源二进制、零第三方运行时依赖，安装时通过本机 `/usr/bin/swiftc` 编译原生 `ApplicationServices` + `CoreGraphics` 引擎（`macos-ax-helper`），无需触发 `System Events` 自动化弹窗。
   - 支持最高 20 层深层无障碍树采集（响应正常应用约百毫秒级返回，并对无响应视图设 8s 超时上限；兼容 AppKit/SwiftUI、Electron、Chromium、WebKit 及 QtWebEngine）、后台零焦点 `AXPress`、针对无原生 `AXPress` 控件（如 Qt6/Anki）的遮挡校验坐标兜底、`postToPid` 后台按键及密码框自动脱敏（`[REDACTED_PASSWORD]`）。
   - 提供 47 个标准工具（`list_apps`、`list_windows`、`get_app_state`、`left_click`/`click`、`set_value`、`perform_action`、`open_application`/`launch_app`、`screenshot`、`request_access`、`stop_computer_control`、剪贴板读写及紧凑/增量状态压缩）。
3. **可选旧版 ZCode 桥接器（`bridges/`）**
   - **默认模式（未安装 `ZCode.app` 或已升级至限制外部 `verifyPeer` 桥接的 `ZCode >= 3.18.0`）**：`zcode-cua` 自动指向内置纯开源原生 macOS AX MCP 服务端，开箱即用且不受第三方客户端升级影响。
   - **旧版 `ZCode < 3.18.0` 环境**：支持挂载 `zcode-cua-bridge.mjs` 与 `zcode-cua-visible-bridge.mjs`，同时保留 `cua-open` 开源后端备选。

---

## 一分钟快速安装

### 环境要求
- **macOS 13+**（Apple Silicon 或 Intel 均支持）
- **Xcode Command Line Tools**（若未安装请先执行 `xcode-select --install`，提供编译原生 `macos-ax-helper` 所需的 `/usr/bin/swiftc` 以及安装后只读探针所需的 `python3` 3.9+）
- **Node.js >= 20**（可通过 `node -v` 检查，若未安装可执行 `brew install node`）

### 一键安装命令

```bash
git clone https://github.com/timexingxin/macos-computer-use-kit.git
cd macos-computer-use-kit
./install.sh
```

`./install.sh` 会自动完成以下全部步骤：
1. 编译内置开源 MCP 服务端（自动兼容 `pnpm` 或 Node 自带的 `npm`），部署到 `~/.local/share/macos-computer-use-kit/`。
2. 自动识别你本机安装的客户端（**Antigravity** / **Claude Code** / **Cursor**），把 `computer-use-orchestrator` 和 `zcode-computer-use` 两个 Skill 安装到位。
3. 无损合并客户端的 MCP 配置文件（修改前自动生成 `.bak` 时间戳备份，绝不覆盖你原有的其他 MCP 服务）。
4. 自动执行 `rpc_probe.py --guard` 只读协议探针，验证 MCP 握手、工具列表注册、子代理并发拦截守卫（`SUBAGENT_COMPUTER_USE_UNAVAILABLE`）及进程零残留回收，输出 `"status": "PASS"`。

### 开启 macOS 辅助功能权限（必做一步）

打开 macOS **系统设置 → 隐私与安全性 → 辅助功能（Accessibility）**（如需截图兜底可同时勾选**屏幕录制**），打开你所使用的宿主软件开关（例如 **Antigravity**、**Terminal / iTerm2**、**Cursor** 或 **ZCode**）。

随后在你的 Agent 客户端刷新或重启一次会话即可直接使用。例如输入：
> *“在后台打开计算器，用无障碍语义控件计算 128 * 256，不要移动我的物理鼠标，并核对计算结果。”*

---

## 常用安装与卸载参数

```bash
./install.sh                                  # 自动识别本机客户端与后端模式（推荐）
./install.sh --client antigravity             # 仅安装到 Antigravity (~/.gemini/config)
./install.sh --client claude                  # 仅安装到 Claude Code (~/.claude)
./install.sh --client cursor                  # 仅安装到 Cursor (~/.cursor)
./install.sh --client all                     # 同时安装到以上全部客户端
./install.sh --mode open                      # 强制使用内置纯开源 macOS AX MCP 后端
./install.sh --preserve-skills                # 仅升级运行时，保留已自定义的 SKILL.md 不被覆盖
./install.sh --dry-run                        # 仅预览将要修改的路径，不实际写入文件
./install.sh --uninstall                      # 干净卸载本套件安装的 Skills、运行时与 MCP 配置项
```

---

## 自检与测试命令

```bash
# 检查本机系统环境与权限状态
npm run doctor

# 运行只读 MCP 握手与安全守卫探针（零 GUI 写入）
npm run probe

# 运行完整单元测试、协议测试、红队对抗测试与安装器端到端隔离测试
npm test
```

---

## 开源许可与声明

本项目基于 [Apache-2.0 License](./LICENSE) 开源，详见 [NOTICE](./NOTICE)。仓库内不包含任何第三方闭源二进制文件。
