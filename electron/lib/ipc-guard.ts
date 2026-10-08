import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * IPC 发送方校验。
 *
 * 为什么需要：ipcMain.handle 默认接受任何 webContents 发来的请求。preload 只暴露给
 * 我们自己的页面，但只要渲染进程被注入脚本（XSS、被诱导导航到外部页面、
 * 将来引入 iframe），它就能调到写注册表、启动外部程序这类高危通道。
 * 这里在主进程侧逐个通道再把一道关：
 *
 * 1. 只认我们自己登记过的窗口（主窗口 / 桌宠窗口），且只认顶层 frame；
 * 2. 发送页面的 URL 必须是本应用的页面：生产环境是打包内的 ui/dist/index.html
 *    （file://），开发环境是 dev server 同源；
 * 3. 每个通道声明允许的窗口角色：桌宠窗口只能调桌宠需要的几个通道；
 * 4. 高危通道（改注册表 / 往用户目录装脚本 / 启动外部程序）额外要求：
 *    主窗口、窗口处于前台、当前页面就是对应功能页。
 *
 * 本模块不 import electron，便于单测；与 Electron 的对接在 ipc.ts 里。
 */

export type WindowRole = "main" | "pet";

export interface ChannelPolicy {
  roles: readonly WindowRole[];
  /** 高危通道：额外要求窗口在前台，且发起页面的路由以 route 开头（hash 路由，如 "/model-monitor"） */
  highRisk?: { route: string };
}

export const MAIN_ONLY: ChannelPolicy = { roles: ["main"] };
export const PET_ONLY: ChannelPolicy = { roles: ["pet"] };
export const MAIN_AND_PET: ChannelPolicy = { roles: ["main", "pet"] };
export const MODEL_MONITOR_HIGH_RISK: ChannelPolicy = {
  roles: ["main"],
  highRisk: { route: "/model-monitor" },
};

/** IpcMainInvokeEvent / IpcMainEvent 里本模块用到的部分 */
export interface SenderEventLike {
  sender: { id: number };
  senderFrame?: { url: string; parent: unknown } | null;
}

export interface GuardConfig {
  /** 生产环境 ui/dist/index.html 的绝对路径 */
  indexHtmlPath: string;
  /** 开发模式的 dev server 地址；打包后的应用必须传 undefined */
  devServerUrl?: string;
  /** webContents.id -> 登记的窗口角色 */
  roleOf: (webContentsId: number) => WindowRole | undefined;
  /** 该 webContents 所在窗口是否在前台（高危通道用） */
  isFocused: (webContentsId: number) => boolean;
  platform?: NodeJS.Platform;
  /**
   * 高危通道「忙碌」时直接交给调用方的结果（例如已有系统确认框开着时返回 { status: "confirm-pending" }），
   * 不忙时返回 undefined。在角色 / URL / 路由校验通过之后、前台校验之前判断：
   * 系统确认框是模态的，打开时主窗口会失焦，若先做前台校验，第二个请求只会得到笼统的拒绝。
   */
  highRiskBusy?: () => unknown;
}

export type SenderCheck =
  | { ok: true; role: WindowRole; busyResult?: unknown }
  | { ok: false; reason: string };

/** 页面 URL 是否是本应用自己的页面 */
export function isTrustedAppUrl(
  url: string,
  cfg: Pick<GuardConfig, "indexHtmlPath" | "devServerUrl" | "platform">,
): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (cfg.devServerUrl) {
    try {
      return u.origin === new URL(cfg.devServerUrl).origin;
    } catch {
      return false;
    }
  }
  if (u.protocol !== "file:") return false;
  const platform = cfg.platform ?? process.platform;
  let filePath: string;
  try {
    // 去掉 hash / query 再转路径：路由在 hash 里
    filePath = fileURLToPath(`file://${u.host}${u.pathname}`, { windows: platform === "win32" });
  } catch {
    return false;
  }
  const p = platform === "win32" ? path.win32 : path.posix;
  const a = p.normalize(filePath);
  const b = p.normalize(cfg.indexHtmlPath);
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** hash 路由，如 file:///.../index.html#/model-monitor?x=1 -> "/model-monitor" */
export function hashRoute(url: string): string {
  try {
    const hash = new URL(url).hash.replace(/^#/, "");
    return hash.split("?")[0] || "/";
  } catch {
    return "";
  }
}

export function checkSender(
  event: SenderEventLike,
  policy: ChannelPolicy,
  cfg: GuardConfig,
): SenderCheck {
  const role = cfg.roleOf(event.sender.id);
  if (!role) return { ok: false, reason: "未登记的窗口" };
  if (!policy.roles.includes(role)) return { ok: false, reason: `该通道不对 ${role} 窗口开放` };
  const frame = event.senderFrame;
  if (!frame) return { ok: false, reason: "发送方 frame 已销毁" };
  if (frame.parent != null) return { ok: false, reason: "只接受顶层 frame" };
  if (!isTrustedAppUrl(frame.url, cfg)) return { ok: false, reason: "发送页面不是本应用页面" };
  if (policy.highRisk) {
    const route = hashRoute(frame.url);
    const want = policy.highRisk.route;
    if (route !== want && !route.startsWith(`${want}/`)) {
      return { ok: false, reason: `只能从 ${want} 页面发起` };
    }
    const busyResult = cfg.highRiskBusy?.();
    if (busyResult !== undefined) return { ok: true, role, busyResult };
    if (!cfg.isFocused(event.sender.id)) return { ok: false, reason: "窗口不在前台" };
  }
  return { ok: true, role };
}

export const REJECT_MESSAGE = "拒绝来自未授权页面的请求";

export interface IpcMainLike {
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void;
  on(channel: string, listener: (event: any, ...args: any[]) => void): unknown;
}

export interface GuardedIpc {
  handle(
    channel: string,
    policy: ChannelPolicy,
    listener: (event: any, ...args: any[]) => unknown,
  ): void;
  on(channel: string, policy: ChannelPolicy, listener: (event: any, ...args: any[]) => void): void;
  /** 已注册的通道与策略（测试与审计用） */
  readonly policies: ReadonlyMap<string, ChannelPolicy>;
}

export function createGuardedIpc(
  ipc: IpcMainLike,
  getConfig: () => GuardConfig,
  onReject?: (channel: string, reason: string) => void,
): GuardedIpc {
  const policies = new Map<string, ChannelPolicy>();
  const register = (channel: string, policy: ChannelPolicy) => {
    if (policies.has(channel)) throw new Error(`IPC 通道重复注册: ${channel}`);
    policies.set(channel, policy);
  };
  return {
    policies,
    handle(channel, policy, listener) {
      register(channel, policy);
      ipc.handle(channel, (event: SenderEventLike, ...args: unknown[]) => {
        const r = checkSender(event, policy, getConfig());
        if (!r.ok) {
          onReject?.(channel, r.reason);
          throw new Error(REJECT_MESSAGE);
        }
        if (r.busyResult !== undefined) return r.busyResult;
        return listener(event, ...args);
      });
    },
    on(channel, policy, listener) {
      register(channel, policy);
      ipc.on(channel, (event: SenderEventLike, ...args: unknown[]) => {
        const r = checkSender(event, policy, getConfig());
        if (!r.ok || r.busyResult !== undefined) {
          // send 类通道没有返回值，静默丢弃并记日志
          if (!r.ok) onReject?.(channel, r.reason);
          return;
        }
        listener(event, ...args);
      });
    },
  };
}

/** 窗口角色登记表：窗口销毁时自动注销 */
const roles = new Map<number, WindowRole>();

export function registerWindowRole(
  wc: { id: number; once(event: "destroyed", cb: () => void): unknown },
  role: WindowRole,
): void {
  const id = wc.id;
  roles.set(id, role);
  wc.once("destroyed", () => {
    if (roles.get(id) === role) roles.delete(id);
  });
}

export function windowRoleOf(webContentsId: number): WindowRole | undefined {
  return roles.get(webContentsId);
}
