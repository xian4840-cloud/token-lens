# Token Lens

统一查看各家 API 余额与 coding plan 余量的桌面应用（Electron + React）。

在一张桌面应用里集中查看所有 LLM 服务商的账户余额、订阅余量，以及本地 coding agent 的 token 用量与花费估算——不用再挨个登录控制台。

## 功能特性

- **余额/余量查询**：一个界面聚合 15 个服务适配器的账户信息，支持自定义刷新间隔与一键全部刷新
- **本地 agent 用量采集**：直接读取本地 agent 产生的会话数据（无需 API key），按天/按模型统计 token 用量并按官网价格估算花费
- **本地模型监测**：侧栏「模型监测」切换 Codex / Claude Code / OpenCode / Grok Build / Antigravity，按天汇总会话；响应证据和配置、用量模型分别标注
- **多日趋势图表**：近 N 天用量趋势、花费走势可视化
- **内置模型价格表**：覆盖 8 家厂商 80 余款模型，照各家官方定价页录入，可在应用内逐条覆盖，也可导出/导入 CSV
- **总览可隐藏服务**：卡片眼睛按钮，不删账号，到管理页恢复显示
- **本地采集可关来源**：设置里单独关掉某家 agent 的扫描，已有历史还在
- **桌面宠物**：可拖动的小雷姆常驻桌面，本地 agent 干活时它跟着忙，点一下看今日花费估算（设置里开关）
- **月度预算**：给本月本地 agent 花费设上限，总览显示进度；接近或超过时在总览顶部提示
- **快捷键**：F5 刷新，Alt+1~5 切页，Ctrl+K 命令面板（含重试失败、扫描、备份、诊断摘要），F1 查看全部快捷键
- **本机备份**：设置里可导出/导入用量历史和服务清单（不含密钥，恢复出来的服务需在管理页重新填写密钥；含密钥的文件会拒绝导入；导入前预览条数；重复导入同一份备份不会重复计数）
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

DeepSeek、Moonshot Kimi、硅基流动、OpenRouter、阿里云百炼、火山方舟（含方舟 coding plan）、超算互联网 SCNet（Token Plan）、智谱 GLM（含 GLM Coding Plan）。

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

### Codex 模型监测

从侧栏进入「模型监测」（也可用 Ctrl+K 搜索），打开即可查看本地会话，无需填写 URL 或修改 Codex 连接方式，包含官方登录产生的本地记录。

- 自动发现 `~/.codex/sessions`、`~/.codex/archived_sessions`（设置了 `CODEX_HOME` 时使用该目录），读取本地会话索引中的名称。
- 默认按天折叠展示会话数、调用数、Tokens 与核对状态，可搜索日期或模型。每 3 秒读取新记录，也可手动刷新；未变化的文件使用元数据缓存。
- 按调用发生的本地日期分组，跨天会话分别落入对应日期，同一响应 ID 在多个会话中仅计一次。汇总包含全部可读取调用，展开一天查看最近 200 条调用、会话名称和模型，点击「标识详情」查看会话与响应 ID；不重复写入用量统计。
- 会话所选模型来自 `turn_context.model`。只有本地独立响应记录确实保存了响应模型，并能对应同一响应 ID，才会比较名称；不使用当前全局配置猜测历史模型。

网络响应中的字段不一定全部写入本地会话。部分 Codex 版本记录响应 ID 和用量，但不保存响应模型；此时显示「本地未记录 / 无法核验」，不会把所选模型复制成响应模型。即使两个名称相同，也只代表记录中的声明一致。

历史文件缺失的响应模型无法从用量反推。后续逐条核对需要在客户端收到响应时记录独立的服务器模型字段；普通 OTel 模型标签不作为响应证据。官方 app-server 的 `model/rerouted` 通知可提示服务改用另一模型，但不能当作每次调用的完整响应模型记录。本版本尚未接入实时响应采集。

监测仅提取本地元数据，不读取认证文件，不保存对话正文或修改会话文件，也不创建转发服务。停止页面自动刷新不会影响 Codex 的正常连接。

### 桌面宠物

「设置 → 桌面宠物」打开后，桌面右下角会出现一只可拖动的小雷姆（默认关闭）。

- **状态跟着 agent 走**：它递归监听上面那张表里的五个会话目录，有文件写入就切
  「工作中」并在脚下标出是哪一家，停止写入 12 秒回到「空闲」。空闲时会随机
  眨眼、挥手、张望或跳一下。判定靠文件写入时间，不是精确进度，秒级延迟是正常的。
- **点一下看今天的花费**：气泡里是今日各来源的 token 与花费估算，口径与用量页
  完全一致（缓存读取计一次，输入不含缓存）。价格表里查不到的模型计入 tokens
  并标注「部分未标价」，不显示成 $0。
- **位置会记住**：拖动后坐标存进设置。重开时若该坐标已不在任何显示器的工作区内
  （比如拔了外接屏），会退回默认位置，而不是消失在屏幕外。
- **只读，不外发**：宠物只读取会话目录的文件修改时间与既有的用量数据，不解析
  会话内容，也不新增任何网络请求。主窗口关闭或应用退出时它一并关闭。

### 费用估算的口径

本地 agent 的会话记录里只有 token 数，没有金额，费用是用内置价格表换算出来的
**估算值，不是账单**。内置表见 `electron/adapters/pricing-table.ts`，
在「设置 → 模型价格表」里可以逐条覆盖，也可以导出/导入 CSV（按模型 key
匹配；表里没有的模型不会被写成 $0）。几个需要知道的口径：

- 价格照各家官方定价页录入，核对日期 **2026-09-04**。此后厂商调价不会自动同步。
- 全部折算为 **USD**。趋势页按金额直接求和，混币种会把 ¥ 和 $ 加在一起，
  所以只给人民币价的厂商（如 Kimi）按汇率折算，汇率写在该行注释里。
- 取**标准档非折扣价**，不用 Batch / Flex / 峰谷优惠。分档定价（长短上下文、
  峰谷时段）取常用档，另一档的数值写在行内注释。
- 价格表里没有的模型，费用列显示「-」而不是 0——未知比谎称免费好。
- Gemini 3.7 / 3.6 Flash 官方明示 2027-01-01 起价格翻倍，表内是现价，跨年需手动改。

换句话说：这个数字用来看趋势和量级，别用来对账。

在「设置 → 月度预算」里可以填一个每月美元上限。总览会显示本月累计对比预算。
价格表里没有的模型不会被当成 $0 来凑进度。

总览卡片右上角眼睛可把某个服务从首页拿掉，账号还在，到「管理」页可以筛
「总览已隐藏」再恢复。本地采集五家来源可在「设置 → 本地采集来源」单独关掉，
关掉后不再扫描，历史日桶仍留着。

## 本地模型监测

侧栏「模型监测」选择 Agent，按「日期 → 模型 → 会话」汇总。每个模型分别显示请求总次数、名称一致、名称差异、无法核验和 Tokens；展开模型可看各会话次数，同一会话切换模型会分别统计。详情只加载当天最近 200 条，汇总包含当天全部请求。只在页面打开时刷新，不写入用量账本或额外请求模型。

| 来源 | 本地数据 | 当前证据范围 |
| --- | --- | --- |
| Claude Code | 本地会话 + 原生进程内响应元数据日志 | Windows 原生版预加载脚本直接记录实际请求 model 与响应 model，按响应 ID 关联历史；重试单独计数、用量只计一次 |
| OpenCode | 只读 `opencode.db` + 本地插件的响应元数据日志 | 进程内 fetch 包装器覆盖内置与已配置 Provider 的 JSON/SSE 响应，读取服务器 model 并关联助手消息；嵌套包装不会重复计数 |
| Grok Build | 会话记录 + `compaction_requests` / `recap_requests` 原始归档 | 按 prompt_index 或唯一的原始输入哈希关联助手 model_id，合并一致的响应快照；重复快照不增加请求次数，冲突与重用编号不参与核验 |
| Antigravity | `~/.gemini/antigravity/conversations/*.db`，只读 | 生成元数据的 `response_model` / `response_model_full`，按明确的 `step_indices` 与响应 ID 关联；所选名称来自生成配置或同库唯一的配置枚举映射 |
| Codex | 当前和归档会话、可选桌面采集 | 原始响应 `model` 按响应 ID 关联后核对名称 |

Claude / OpenCode 在监测页点击「启用响应核验」安装一次（启用、关闭采集和「启动 Codex 并采集」前都会弹出系统确认框，列出将修改的环境变量、文件路径或要启动的程序，默认按钮是「取消」），之后使用原来的启动方式即可，无需 URL 或额外后台进程。OpenCode 插件写入 `~/.config/opencode/plugins`（支持 OPENCODE_CONFIG_DIR），安装后重新打开 OpenCode。Claude 脚本写入 `~/.claude/token-lens-monitor`，通过 Windows 用户 `BUN_OPTIONS` 预加载，只在原生 `claude.exe` 中启用；保留现有启动选项，安装后关闭旧终端并打开新终端。Bun 的预加载路径不能含空格，当前用户目录有空格时安装会报错。两者只保存模型、标识、时间与用量到 Token Lens userData 的 `model-responses`，不保存正文、URL、请求头或密钥。不想用了点同一处的「关闭采集」：只撤销安装时写下的东西——从 BUN_OPTIONS 去掉 Token Lens 追加的 `--preload=.../token-lens-monitor/claude.cjs`（路径大小写、正反斜杠、空格或制表符分隔都能识别；其余选项原样保留，只剩这一项时删除该变量）、删除 `~/.claude/token-lens-monitor` 和 OpenCode 插件目录里由 Token Lens 写入的文件（逐个核对文件首行标记，同名但不是 Token Lens 写的文件不动；目录里还有其他文件时目录保留）。若去掉后 BUN_OPTIONS 仍以其他写法引用 `token-lens-monitor/claude.cjs`（或改不了注册表），为免 Claude Code 因找不到预加载脚本而无法启动，脚本整套保留并给出提示，手动清理 BUN_OPTIONS 后再关一次即可；已采集的记录保留。卸载 Token Lens（安装版）时也会做同样的清理，升级安装不会触发。Grok 无需安装插件，只缓存模型元数据，不保存输入哈希或正文。

离线验证：`node scripts/check-agent-response-capture.cjs --runtime` 和 `node scripts/check-claude-response-capture.cjs` 使用本机程序对本地模拟服务器验证请求与独立响应模型，不调用付费模型。其他机器用 TOKEN_LENS_OPENCODE_EXE / TOKEN_LENS_CLAUDE_EXE 指定可执行文件。

Grok 的 `modelUsage` 通常来自响应 `model_id`，但字段缺失时会回填配置模型（见 [Grok Build 源码](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-chat-state/src/actor/mutations.rs) 的 `record_model_call_usage`）。因此只用原始助手响应 model_id 核验，modelUsage 仅用于展示整轮分项。`grok-4.7` 与 `grok-4.7-build` 等名称不同会统计为「名称差异」，可能是别名，不能据此证明模型错配。历史未保存或已被压缩删除的独立证据无法补造。

Antigravity 字段定义来自本机 2.19.1 自带的 protobuf 描述符，读取的是客户端保存的响应模型声明，不能证明服务器内部模型权重。配置名称与响应名称可能使用不同后缀，例如 `gemini-3.8-flash-high` 与 `gemini-3.8-flash`；页面的「名称差异」不代表已确认模型用错。同一配置枚举存在多个名称时不回填，缺少所选名称时仅显示「已记录响应」。生成 blob 可能含提示词，读取时仅解析指定元数据字段，缓存与返回值不保存正文。数据库或 WAL 改变时才重读，未识别的结构显示不可用或缺少证据。

### Codex 桌面采集（Windows 实验功能）

核对新响应时，先退出官方 Codex，再在 Token Lens 点击「启动 Codex 并采集」。Token Lens 用系统 .NET Framework 准备一个本地后端包装程序，通过仅对这次启动生效的 `CODEX_CLI_PATH` 启动官方 Codex，原样传递桌面与官方后端之间的通信。真实模型请求仍由官方后端发送，不需要 URL、代理或额外测试请求；官方登录、程序文件及全局配置保持不变。

采集器从原始 WebSocket/SSE 诊断消息读取 `response.model`，只把响应 ID、模型、时间和事件类型保存在 Token Lens 数据目录的 `model-capture/responses-*.jsonl`。聊天正文和原始流量不会写入该目录，也不会转发到桌面诊断日志。监测页面按响应 ID 关联本地会话，捕获前缺失的历史证据不会被补造；同一响应前后出现不同模型时显示差异。这里只核对服务器声明的模型名称，不证明内部模型权重。

每次需要监测时从 Token Lens 启动 Codex。退出 Codex 后通过原快捷方式打开即可恢复普通启动；Token Lens 不会自动关闭正在使用的 Codex。该入口目前面向微软商店版官方 Codex，首次需要系统内置的 .NET Framework 编译工具。官方桌面启动方式若有变化，可能需要更新采集器。

## 开发

```bash
npm install
npm run dev            # 同时启动前端 HMR + Electron
npm test               # 跑单元测试（vitest，覆盖 ui/ 与 electron/ 两侧）
npm run test:watch     # watch 模式
npm run typecheck      # 前端 + 主进程分别做类型检查
npm run lint           # ESLint（eslint.config.mjs）
npm run format         # Prettier 格式化（format:check 只检查不改）
```

> 全量格式化的提交记录在 `.git-blame-ignore-revs`，本地执行一次 `git config blame.ignoreRevsFile .git-blame-ignore-revs` 后 `git blame` 会跳过它（GitHub 网页的 blame 自动识别）。

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

- `electron/` - Electron 主进程（TypeScript，与 `shared/` 一起编译到 `electron-dist/`，入口 `electron-dist/electron/main.js`）
- `ui/` - 前端源码（React + Vite，构建到 `ui/dist/`）
- `shared/` - 主进程与界面共用的数据类型（`shared/types/`）和 IPC 契约（`shared/ipc.ts`：通道名、参数与返回值）。新增或修改 IPC 通道只改这里，preload 与主进程处理函数由编译器校验；界面经 `@shared/*` 引用
- `electron/adapters/` - 各服务适配器（余额/用量查询）
- `electron/local-usage/` - 本地 agent 用量采集器（Claude Code / Codex / OpenCode / Antigravity / Grok Build）
- `electron/pet/` - 桌面宠物（独立无边框窗口、会话目录监听、今日花费汇总）
- `scripts/` - 维护脚本（如 `sanitize-lockfile.cjs`）
- 测试配置：`vitest.config.mts`（独立于 `vite.config.ts`，后者 `root: "ui"` 会让 `electron/` 下的测试扫不到）
- 数据存储：`token-lens-data.json`（位于 userData 目录），密钥经 safeStorage 加密；
  该文件解析失败时不会被静默重建，而是改名成 `.corrupt-<时间戳>` 留档

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
