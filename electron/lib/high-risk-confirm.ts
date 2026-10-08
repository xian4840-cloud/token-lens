import path from "node:path";
import type { HighRiskResult } from "../../shared/types";

/**
 * 高危操作（改用户环境变量、往用户目录装 / 删脚本、启动外部程序）执行前的系统确认框。
 *
 * 为什么放在主进程：ipc-guard 只能确认请求来自主窗口的模型监测页，挡不住被注入脚本的渲染进程
 * 直接调用。原生确认框由主进程弹出，渲染进程无法替用户点「继续」。
 *
 * 约束：
 * - 确认框的全部文案和显示的路径都只由主进程状态（用户目录、userData、主进程环境变量）拼出，
 *   不接收、也不拼接渲染进程传来的任何字符串或参数，免得被注入脚本伪造内容诱导用户点击；
 * - 同一时间只允许一个确认框：已有确认框未关闭时，其他高危调用立即返回 confirm-pending，不排队；
 * - 默认按钮与取消按钮都是「取消」（回车 / Esc / 关窗都不会执行）。
 */

export type HighRiskAction = "enable-claude" | "enable-opencode" | "disable-claude" | "disable-opencode" | "launch-codex";

/** 交给渲染进程的结果：确认后执行返回 ok；用户取消或已有待确认的操作时不执行（定义在 shared/types） */
export type { HighRiskResult };

/** 拼文案用到的主进程状态（全部来自主进程，见 highRiskContextFromMain） */
export interface HighRiskContext {
  /** os.homedir() */
  home: string;
  /** app.getPath("userData") */
  dataRoot: string;
  /** 主进程环境里的 OPENCODE_CONFIG_DIR，没有则为 ~/.config/opencode */
  openCodeConfigRoot: string;
  /** 主进程环境里的 CODEX_HOME，没有则为 ~/.codex */
  codexHome: string;
  /** 主进程环境里的 LOCALAPPDATA，没有则为 ~/AppData/Local */
  localAppData: string;
  /** 用于路径拼接与显示，Windows 上是 win32 */
  platform: NodeJS.Platform;
}

export interface ConfirmContent {
  title: string;
  message: string;
  detail: string;
  confirmLabel: string;
}

export const CANCEL_LABEL = "取消";
export const CONFIRM_PENDING: HighRiskResult<never> = Object.freeze({ status: "confirm-pending" }) as HighRiskResult<never>;

export function buildConfirmContent(action: HighRiskAction, ctx: HighRiskContext): ConfirmContent {
  const p = ctx.platform === "win32" ? path.win32 : path.posix;
  const claudeDir = p.join(ctx.home, ".claude", "token-lens-monitor");
  const claudePreload = p.join(claudeDir, "claude.cjs");
  const preloadFlag = `--preload=${claudePreload.replaceAll("\\", "/")}`;
  const plugins = p.join(ctx.openCodeConfigRoot, "plugins");
  const responses = p.join(ctx.dataRoot, "model-responses");
  const captureDir = p.join(ctx.dataRoot, "model-capture");
  const undo = "可随时在本页点「关闭采集」撤销；卸载 Token Lens 时也会自动清理。";
  switch (action) {
    case "enable-claude":
      return {
        title: "启用 Claude Code 响应核验",
        message: "将修改用户环境变量 BUN_OPTIONS，并在用户目录写入 3 个文件。是否继续？",
        detail: [
          "· 用户环境变量 HKCU\\Environment\\BUN_OPTIONS：在末尾追加",
          `    ${preloadFlag}`,
          "  原有内容保留。之后新启动的 Bun 程序（包括原生版 Claude Code）都会预加载该脚本。",
          `· 写入目录 ${claudeDir}：`,
          "    claude.cjs、_token-lens-fetch-models.cjs、claude-journal.json",
          `· 采集记录写入 ${p.join(responses, "claude-code.jsonl")}，只含模型、标识、时间与用量，不含正文、URL、请求头或密钥。`,
          "",
          undo,
        ].join("\n"),
        confirmLabel: "启用",
      };
    case "enable-opencode":
      return {
        title: "启用 OpenCode 响应核验",
        message: "将在 OpenCode 插件目录写入 2 个文件。是否继续？",
        detail: [
          `· 写入目录 ${plugins}：`,
          "    token-lens-response-monitor.js、_token-lens-fetch-models.cjs",
          "  重新打开 OpenCode 后插件生效。不修改环境变量。",
          `· 采集记录写入 ${p.join(responses, "opencode.jsonl")}，只含模型、标识、时间与用量，不含正文、URL、请求头或密钥。`,
          "",
          undo,
        ].join("\n"),
        confirmLabel: "启用",
      };
    case "disable-claude":
      return {
        title: "关闭 Claude Code 响应核验",
        message: "将修改用户环境变量 BUN_OPTIONS，并删除 Token Lens 写入的文件。是否继续？",
        detail: [
          "· 用户环境变量 HKCU\\Environment\\BUN_OPTIONS：去掉 Token Lens 追加的",
          "    --preload=…/.claude/token-lens-monitor/claude.cjs",
          "  其余选项原样保留；只剩这一项时删除该变量。",
          `· 删除目录 ${claudeDir} 里由 Token Lens 写入的`,
          "    claude.cjs、_token-lens-fetch-models.cjs、claude-journal.json",
          "  逐个核对文件首行标记，不是 Token Lens 写的不动；目录空了才删除目录。",
          "· 若 BUN_OPTIONS 去掉后仍以其他写法引用该脚本，为免 Claude Code 无法启动，文件会保留并提示。",
          `· 已采集的记录（${responses}）保留。`,
        ].join("\n"),
        confirmLabel: "关闭采集",
      };
    case "disable-opencode":
      return {
        title: "关闭 OpenCode 响应核验",
        message: "将删除 OpenCode 插件目录里 Token Lens 写入的文件。是否继续？",
        detail: [
          `· 删除目录 ${plugins} 里由 Token Lens 写入的`,
          "    token-lens-response-monitor.js、_token-lens-fetch-models.cjs",
          "  逐个核对文件首行标记，不是 Token Lens 写的不动；插件目录和其他插件不受影响。",
          `· 已采集的记录（${responses}）保留。`,
        ].join("\n"),
        confirmLabel: "关闭采集",
      };
    case "launch-codex":
      return {
        title: "启动 Codex 并采集",
        message: "将启动官方 Codex 桌面版，并让它通过 Token Lens 的采集器连接官方后端。是否继续？",
        detail: [
          "· 启动的程序：Microsoft Store 应用 OpenAI.Codex 安装目录里的 app\\ChatGPT.exe（由系统查询安装位置）。Codex 已在运行时只准备采集器、不启动。",
          `· 采集器：${p.join(captureDir, "CodexCapture.exe")}`,
          "  首次使用或版本更新时，用系统自带的 .NET Framework 编译器（csc.exe）从 Token Lens 内置的 CodexCapture.cs 编译生成。",
          `· 仅对这一次启动的 Codex 进程设置环境变量：CODEX_CLI_PATH 指向上述采集器，CODEX_HOME=${ctx.codexHome}；`,
          `  采集器再转交给官方后端 ${p.join(ctx.localAppData, "OpenAI", "Codex", "bin")} 下最新的 codex.exe。`,
          `· 只记录响应元数据到 ${captureDir}。不修改全局环境变量、证书或 Codex 设置。`,
        ].join("\n"),
        confirmLabel: "启动 Codex",
      };
  }
}

/** dialog.showMessageBox 的最小子集，便于测试注入 */
export interface MessageBoxOptionsLike {
  type: "warning";
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  noLink: boolean;
}
export interface DialogLike {
  showMessageBox(window: unknown, options: MessageBoxOptionsLike): Promise<{ response: number }>;
}

export interface HighRiskConfirmDeps {
  dialog: DialogLike;
  /** 确认框的父窗口（主窗口）；event 只用于定位窗口，不读取其中任何字符串 */
  getParent: (event: unknown) => unknown;
  getContext: () => HighRiskContext;
}

export interface HighRiskConfirm {
  /** 弹确认框；确认后执行 fn。fn 抛错照常抛给调用方 */
  run<T>(action: HighRiskAction, event: unknown, fn: () => T | Promise<T>): Promise<HighRiskResult<Awaited<T>>>;
  /** 是否有确认框正开着 */
  readonly pending: boolean;
}

export function messageBoxOptions(content: ConfirmContent): MessageBoxOptionsLike {
  return {
    type: "warning",
    title: content.title,
    message: content.message,
    detail: content.detail,
    // 0 = 取消（默认 / Esc / 关窗），1 = 继续
    buttons: [CANCEL_LABEL, content.confirmLabel],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}

export function createHighRiskConfirm(deps: HighRiskConfirmDeps): HighRiskConfirm {
  let pending = false;
  return {
    get pending() {
      return pending;
    },
    async run(action, event, fn) {
      if (pending) return CONFIRM_PENDING;
      pending = true;
      let confirmed = false;
      try {
        const options = messageBoxOptions(buildConfirmContent(action, deps.getContext()));
        const { response } = await deps.dialog.showMessageBox(deps.getParent(event), options);
        confirmed = response === 1;
      } catch {
        confirmed = false;
      } finally {
        pending = false;
      }
      if (!confirmed) return { status: "cancelled" };
      return { status: "ok", value: await fn() };
    },
  };
}
