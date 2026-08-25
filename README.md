# Token Lens

统一查看各家 API 余额与 coding plan 余量的桌面应用（Electron + React）。

在一张桌面应用里集中查看所有 LLM 服务商的账户余额、订阅余量，以及本地 coding agent 的 token 用量与花费估算——不用再挨个登录控制台。

## 功能特性

- **余额/余量查询**：一个界面聚合 13 家服务的账户信息，支持自定义刷新间隔与一键全部刷新
- **本地 agent 用量采集**：直接读取本地 agent 产生的会话数据（无需 API key），按天/按模型统计 token 用量并按官网价格估算花费
- **多日趋势图表**：近 N 天用量趋势、花费走势可视化
- **数据全本地**：所有配置与数据存储在本机 userData 目录，API key 经 Electron safeStorage 加密，不上传任何服务器

### 支持的服务

**能查到余额数字**：

Anthropic (Claude)、OpenAI、DeepSeek、Moonshot Kimi、硅基流动、OpenRouter、火山方舟（含方舟 coding plan）、超算互联网 SCNet（Token Plan）。

**仅校验 Key 有效性**（这些平台官方未提供余额查询接口，余额只能在各自控制台查看）：

Google Gemini、Groq、Together。

**本地用量采集**：

| 本地 agent | 数据来源 |
|---|---|
| Claude Code | `~/.claude/projects` 下的 JSONL 会话记录 |
| Codex | `~/.codex/sessions` 下的会话记录 |
| OpenCode | OpenCode 本地存储 |
| Antigravity | `~/.gemini/antigravity/conversations` 下的会话库 |

## 开发

```bash
npm install
npm run dev            # 同时启动前端 HMR + Electron
```

> 首次安装若 electron 二进制下载慢，可设镜像环境变量：
> PowerShell: `$env:ELECTRON_MIRROR="https://cdn.npmmirror.com/binaries/electron/"; npm install`

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
- 数据存储：JSON 文件（位于 userData 目录），密钥经 safeStorage 加密

## 隐私说明

应用不内置任何遥测/统计上报。你配置的 API key 仅保存在本机（safeStorage 加密），用量数据全部从本地文件读取，请求只发往你配置的服务商官方 API。

## License

[MIT](LICENSE)
