# Token Lens

统一查看各家 API 余额与 coding plan 余量的桌面应用（Electron + React）。

在一张桌面应用里集中查看所有 LLM 服务商的账户余额、订阅余量，以及本地 coding agent 的 token 用量与花费估算——不用再挨个登录控制台。

## 功能特性

- **余额/余量查询**：一个界面聚合 13 个服务适配器的账户信息，支持自定义刷新间隔与一键全部刷新
- **本地 agent 用量采集**：直接读取本地 agent 产生的会话数据（无需 API key），按天/按模型统计 token 用量并按官网价格估算花费
- **多日趋势图表**：近 N 天用量趋势、花费走势可视化
- **内置模型价格表**：覆盖 8 家厂商 80 余款模型，照各家官方定价页录入，可在应用内逐条覆盖
- **数据全本地**：所有配置与数据存储在本机 userData 目录，API key 经 Electron safeStorage 加密，不上传任何服务器

## 安装

到 [Releases](https://github.com/xian4840-cloud/token-lens/releases) 下载
`TokenLens-Setup-<version>-x64.exe` 运行即可（Windows x64）。

安装包未做代码签名（没有证书），Windows 首次运行会弹 SmartScreen 提示，
点「更多信息 → 仍要运行」。介意的话可以自行从源码构建，见下面的「打包」。

目前只出 Windows x64 包。代码本身没有平台特异逻辑，macOS / Linux 可自行构建，
但我没有相应机器验证过。

### 支持的服务

各服务开放的接口能力不同，卡片上能看到什么取决于官方给了什么，分三类：

**能查到剩余余额 / 余量**：

DeepSeek、Moonshot Kimi、硅基流动、OpenRouter、阿里云百炼、火山方舟（含方舟 coding plan）、超算互联网 SCNet（Token Plan）。

**只能查到用量，查不到余额**（官方接口给的是消耗侧数据，卡片显示本月累计而非剩余）：

| 服务 | 卡片上的数字 |
|---|---|
| OpenAI | 本月累计花费（USD，来自 organization/costs） |
| Anthropic (Claude) | 本月累计 token 数（来自 usage_report，非金额） |

**仅校验 Key 有效性**（这些平台官方未提供余额或配额查询接口，额度只能在各自控制台查看）：

Google Gemini、Groq、Together。注意这三家均同时提供免费与付费档，卡片上的「Key 有效」只表示密钥通过校验，不代表账号是免费额度。

**本地用量采集**：

| 本地 agent | 数据来源 |
|---|---|
| Claude Code | `~/.claude/projects` 下的 JSONL 会话记录 |
| Codex | `~/.codex/sessions` 下的会话记录 |
| OpenCode | OpenCode 本地存储 |
| Antigravity | `~/.gemini/antigravity/conversations` 下的会话库 |
| Grok Build | `~/.grok/sessions` 下的会话记录（updates.jsonl） |

### 费用估算的口径

本地 agent 的会话记录里只有 token 数，没有金额，费用是用内置价格表换算出来的
**估算值，不是账单**。内置表见 `electron/adapters/pricing-table.ts`，
在「设置 → 模型价格表」里可以逐条覆盖。几个需要知道的口径：

- 价格照各家官方定价页录入，核对日期 **2026-08-25**。此后厂商调价不会自动同步。
- 全部折算为 **USD**。趋势页按金额直接求和，混币种会把 ¥ 和 $ 加在一起，
  所以只给人民币价的厂商（如 Kimi）按汇率折算，汇率写在该行注释里。
- 取**标准档非折扣价**，不用 Batch / Flex / 峰谷优惠。分档定价（长短上下文、
  峰谷时段）取常用档，另一档的数值写在行内注释。
- 价格表里没有的模型，费用列显示「-」而不是 0——未知比谎称免费好。
- Gemini 3.7 / 3.6 Flash 官方明示 2027-01-01 起价格翻倍，表内是现价，跨年需手动改。

换句话说：这个数字用来看趋势和量级，别用来对账。

## 开发

```bash
npm install
npm run dev            # 同时启动前端 HMR + Electron
npm test               # 跑单元测试（vitest，覆盖 ui/ 与 electron/ 两侧）
npm run test:watch     # watch 模式
npm run typecheck      # 前端 + 主进程分别做类型检查
```

> 改了 `electron/` 下的主进程代码需要重启 Electron，Vite HMR 只覆盖渲染进程。

> 首次安装若 electron 二进制下载慢，可设镜像环境变量：
> PowerShell: `$env:ELECTRON_MIRROR="https://cdn.npmmirror.com/binaries/electron/"; npm install`
>
> 用了镜像源后 `package-lock.json` 里的 `resolved` 会被改写成镜像地址，提交前跑一次
> `node scripts/sanitize-lockfile.cjs` 改回 registry.npmjs.org（该脚本只动主机名，会校验 integrity 不变）。

## 打包

```bash
npm run dist:portable   # 便携版（dir）
npm run dist:installer  # NSIS 安装包
```

> electron-builder 打包时需下载 electron 运行时 zip（~150MB），国内网络务必设镜像，否则请求会挂起超时：
> ```powershell
> $env:ELECTRON_MIRROR="https://cdn.npmmirror.com/binaries/electron/"
> $env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
> npm run dist:installer
> ```
> 产物输出到 `dist-electron/`：便携版 `win-unpacked/Token Lens.exe`，安装包 `TokenLens-Setup-<version>-x64.exe`。未签名（无证书），Windows 首次运行会有 SmartScreen 提示，点「仍要运行」即可。

## 目录结构

- `electron/` - Electron 主进程（TypeScript，编译到 `electron-dist/`）
- `ui/` - 前端源码（React + Vite，构建到 `ui/dist/`）
- `electron/adapters/` - 各服务适配器（余额/用量查询）
- `electron/local-usage/` - 本地 agent 用量采集器（Claude Code / Codex / OpenCode / Antigravity）
- `scripts/` - 维护脚本（如 `sanitize-lockfile.cjs`）
- 测试配置：`vitest.config.mts`（独立于 `vite.config.ts`，后者 `root: "ui"` 会让 `electron/` 下的测试扫不到）
- 数据存储：`token-lens-data.json`（位于 userData 目录），密钥经 safeStorage 加密

## 遇到问题

应用会把运行期间的错误记到本地日志文件，位置是 userData 目录下的 `logs/token-lens.log`。
在「设置 → 诊断日志」里能直接看到最近的记录，也能一键定位到文件。

日志**只写本地、不会上传**。反馈问题时可以自行把文件内容附上，发不发由你决定。
写入前会自动隐去 API Key、Cookie、Authorization 头等凭据（见 `electron/lib/redact.ts`），
但发出去之前仍建议自己扫一眼。

## 隐私说明

应用不内置任何遥测/统计上报，也没有任何日志上传通道。你配置的 API key 仅保存在本机
（safeStorage 加密），用量数据全部从本地文件读取，请求只发往你配置的服务商官方 API。

## License

[MIT](LICENSE)
