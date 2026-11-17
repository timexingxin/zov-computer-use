# Zov Computer Use（macOS 原生桌面操控开箱套件）

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%2013%2B-black.svg)](#环境要求)

[English README](./README.md)

**Zov Computer Use** 是一套面向 **Antigravity**、**Claude Code**、**Cursor** 等 AI Agent 客户端的 **macOS 原生无障碍电脑操控（Computer Use）一键开箱套件**，内置双层操控 Skill 与纯自研原生 Swift + TypeScript 无障碍（Accessibility）MCP 服务端（`zov-cua`）。

克隆仓库后只需运行一条 `./install.sh` 命令，无需依赖任何第三方闭源软件，即可在 Mac 上启用**后台零焦点抢占、不乱动物理鼠标、高压缩低延迟**的原生桌面自动化能力。

---

## 包含组件

1. **双层实战 Skills（`skills/`）**
   - **`computer-use-orchestrator`**：总控路由与安全策略层——遵循“API/CLI 优先 → 网页走浏览器 DOM 工具 → 原生 Mac 应用走 `zov-cua` 无障碍语义树”，内置单写入者窗口约束、非焦点窗口安全关闭（`AXCloseButton`）及异常恢复规则。
   - **`zov-computer-use`**：具体工具执行协议——规范 `Observe → Act → Verify` 闭环、状态质量分级（GOOD / DEGRADED / FAILED）、`return_state="compact"` 单轮原子刷新、macOS 原生文件选择框（`⌘⇧G`）处理、高危动作护栏，并附带零依赖只读验收探针 `scripts/rpc_probe.py`。
2. **自包含原生 macOS AX MCP 服务端（`packages/`，`zov-cua`）**
   - 零闭源二进制、零第三方运行时依赖，安装时通过本机 `/usr/bin/swiftc` 编译原生 `ApplicationServices` + `CoreGraphics` 引擎（`macos-ax-helper`），无需触发 `System Events` AppleEvents 弹窗。
   - 支持最高 20 层深层无障碍树采集（响应正常应用百毫秒级返回，对无响应视图设 8s 超时上限；兼容 AppKit/SwiftUI、Electron、Chromium、WebKit 及 QtWebEngine）、后台零焦点 `AXPress`（含二次 TOCTOU 防漂移校验）、针对无原生 `AXPress` 控件（如 Qt6/Anki）的穿透层甄别与遮挡校验坐标兜底、`postToPid` 后台按键及全路径密码自动脱敏（`[REDACTED_PASSWORD]`）。
   - 提供 **47 个标准工具**（`list_apps`、`list_windows`、`get_app_state`、`left_click`/`click`、`set_value`、`perform_action`、`open_application`/`launch_app`、`screenshot`、`request_access`、`stop_computer_control`、剪贴板读写及紧凑/增量状态压缩）。

---

## 一分钟快速安装

### 环境要求
- **macOS 13+**（Apple Silicon 或 Intel 均支持）
- **Xcode Command Line Tools**（若未安装请先执行 `xcode-select --install`，提供编译原生 `macos-ax-helper` 所需的 `/usr/bin/swiftc` 以及安装后只读探针所需的 `python3` 3.9+）
- **Node.js >= 20**（可通过 `node -v` 检查，若未安装可执行 `brew install node`）

### 一键安装命令

```bash
git clone https://github.com/timexingxin/zov-computer-use.git
cd zov-computer-use
./install.sh
```

`./install.sh` 会自动完成以下全部步骤：
1. 编译 TypeScript 工作区与原生 Swift `macos-ax-helper`，部署自包含运行时到 `~/.local/share/zov-computer-use/`。
2. 自动识别本机安装的客户端（**Antigravity** / **Claude Code** / **Cursor**），安装 `computer-use-orchestrator` 与 `zov-computer-use` 两个 Skill（若已有自定义文件则自动整目录备份）。
3. 原子无损合并客户端的 MCP 配置文件（注册 `zov-cua`，修改前自动生成 `.bak` 备份，绝不覆盖原有的其他 MCP 服务）。
4. 自动执行 `rpc_probe.py --guard` 只读协议探针，验证 MCP 握手、47 工具注册、Darwin `list_apps` 连通性、子代理并发拦截守卫（`SUBAGENT_COMPUTER_USE_UNAVAILABLE`）及进程零残留回收。

### 开启 macOS 辅助功能权限（必做一步）

打开 macOS **系统设置 → 隐私与安全性 → 辅助功能（Accessibility）**（如需截图兜底可同时勾选**屏幕录制**），打开你所使用的宿主软件开关（例如 **Antigravity**、**Terminal / iTerm2**、**Cursor** 或 **Claude**）。

随后在客户端刷新或重启一次 MCP 会话即可直接使用。例如输入：
> *“在后台打开计算器，用无障碍语义控件计算 128 * 256，不要移动我的物理鼠标，并核对计算结果。”*

---

## 常用安装与卸载参数

```bash
./install.sh                                  # 自动识别本机客户端并安装 zov-cua（推荐）
./install.sh --client antigravity             # 仅安装到 Antigravity (~/.gemini/config)
./install.sh --client claude                  # 仅安装到 Claude Code (~/.claude)
./install.sh --client cursor                  # 仅安装到 Cursor (~/.cursor)
./install.sh --client all                     # 同时安装到以上全部客户端
./install.sh --preserve-skills                # 仅升级运行时，保留已自定义的 SKILL.md 不被覆盖
./install.sh --dry-run                        # 仅预览将要修改的路径，不实际写入文件
./install.sh --uninstall                      # 干净卸载本套件安装的 Skills、运行时与 zov-cua 配置项
```

---

## 自检与测试命令

```bash
# 检查本机系统环境、原生编译产物与权限状态
npm run doctor

# 运行只读 MCP 握手与安全守卫探针（零 GUI 写入）
npm run probe

# 运行完整单元测试、协议测试、Swift CLI 黄金测试、红队对抗测试与安装器端到端隔离测试
npm test
```

---

## 开源许可与声明

本项目基于 [Apache-2.0 License](./LICENSE) 开源，详见 [NOTICE](./NOTICE)。仓库内不包含任何第三方闭源二进制文件。
