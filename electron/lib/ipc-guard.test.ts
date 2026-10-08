import { describe, expect, it, vi } from "vitest";
import {
  checkSender,
  createGuardedIpc,
  hashRoute,
  isTrustedAppUrl,
  MAIN_AND_PET,
  MAIN_ONLY,
  MODEL_MONITOR_HIGH_RISK,
  PET_ONLY,
  REJECT_MESSAGE,
  registerWindowRole,
  windowRoleOf,
  type GuardConfig,
  type WindowRole,
} from "./ipc-guard";

const POSIX_INDEX = "/opt/Token Lens/resources/app.asar/ui/dist/index.html";
const POSIX_URL = "file:///opt/Token%20Lens/resources/app.asar/ui/dist/index.html";
const WIN_INDEX = "C:\\Users\\me\\AppData\\Local\\Programs\\Token Lens\\resources\\app.asar\\ui\\dist\\index.html";
const WIN_URL = "file:///C:/Users/me/AppData/Local/Programs/Token%20Lens/resources/app.asar/ui/dist/index.html";

describe("isTrustedAppUrl", () => {
  const posix = { indexHtmlPath: POSIX_INDEX, platform: "linux" as const };
  const win = { indexHtmlPath: WIN_INDEX, platform: "win32" as const };

  it("生产环境只认打包内的 index.html，hash 路由不影响", () => {
    expect(isTrustedAppUrl(POSIX_URL, posix)).toBe(true);
    expect(isTrustedAppUrl(`${POSIX_URL}#/pet`, posix)).toBe(true);
    expect(isTrustedAppUrl(`${POSIX_URL}?x=1#/model-monitor`, posix)).toBe(true);
  });

  it("同目录的其他文件、别的 file:// 路径、http(s) 页面一律不认", () => {
    expect(isTrustedAppUrl(POSIX_URL.replace("index.html", "evil.html"), posix)).toBe(false);
    expect(isTrustedAppUrl("file:///tmp/index.html", posix)).toBe(false);
    expect(isTrustedAppUrl("https://example.com/", posix)).toBe(false);
    expect(isTrustedAppUrl("http://127.0.0.1:5173/", posix)).toBe(false);
    expect(isTrustedAppUrl("about:blank", posix)).toBe(false);
    expect(isTrustedAppUrl("not a url", posix)).toBe(false);
  });

  it("路径穿越写法规范化后仍须等于入口文件", () => {
    expect(isTrustedAppUrl(POSIX_URL.replace("/ui/dist/", "/ui/dist/../dist/"), posix)).toBe(true);
    expect(isTrustedAppUrl(POSIX_URL.replace("/ui/dist/index.html", "/ui/index.html"), posix)).toBe(false);
  });

  it("Windows：盘符与大小写不敏感", () => {
    expect(isTrustedAppUrl(WIN_URL, win)).toBe(true);
    expect(isTrustedAppUrl(WIN_URL.replace("C:/Users/me", "c:/users/ME"), win)).toBe(true);
    expect(isTrustedAppUrl(WIN_URL.replace("Token%20Lens", "Other"), win)).toBe(false);
  });

  it("开发模式只认 dev server 同源，不再认 file://", () => {
    const dev = { ...posix, devServerUrl: "http://127.0.0.1:5173" };
    expect(isTrustedAppUrl("http://127.0.0.1:5173/#/pet", dev)).toBe(true);
    expect(isTrustedAppUrl("http://localhost:5173/", dev)).toBe(false);
    expect(isTrustedAppUrl("http://127.0.0.1:5174/", dev)).toBe(false);
    expect(isTrustedAppUrl(POSIX_URL, dev)).toBe(false);
  });
});

describe("hashRoute", () => {
  it("取 hash 路由，去掉查询串", () => {
    expect(hashRoute(`${POSIX_URL}#/model-monitor`)).toBe("/model-monitor");
    expect(hashRoute(`${POSIX_URL}#/model-monitor?d=1`)).toBe("/model-monitor");
    expect(hashRoute(POSIX_URL)).toBe("/");
  });
});

function makeConfig(roles: Record<number, WindowRole>, focused = true): GuardConfig {
  return {
    indexHtmlPath: POSIX_INDEX,
    platform: "linux",
    roleOf: (id) => roles[id],
    isFocused: () => focused,
  };
}
const ev = (id: number, url = POSIX_URL, parent: unknown = null) => ({
  sender: { id },
  senderFrame: { url, parent },
});

describe("checkSender", () => {
  const cfg = makeConfig({ 1: "main", 2: "pet" });

  it("主窗口调普通通道放行；未登记的窗口（如登录窗口）拒绝", () => {
    expect(checkSender(ev(1), MAIN_ONLY, cfg)).toEqual({ ok: true, role: "main" });
    expect(checkSender(ev(9), MAIN_ONLY, cfg)).toMatchObject({ ok: false });
  });

  it("桌宠窗口只能调桌宠通道", () => {
    expect(checkSender(ev(2, `${POSIX_URL}#/pet`), MAIN_ONLY, cfg)).toMatchObject({ ok: false });
    expect(checkSender(ev(2, `${POSIX_URL}#/pet`), PET_ONLY, cfg)).toEqual({ ok: true, role: "pet" });
    expect(checkSender(ev(2, `${POSIX_URL}#/pet`), MAIN_AND_PET, cfg)).toEqual({ ok: true, role: "pet" });
    expect(checkSender(ev(1), PET_ONLY, cfg)).toMatchObject({ ok: false });
  });

  it("子 frame、frame 已销毁、页面被导航到外部 URL 都拒绝", () => {
    expect(checkSender(ev(1, POSIX_URL, {}), MAIN_ONLY, cfg)).toMatchObject({ ok: false, reason: "只接受顶层 frame" });
    expect(checkSender({ sender: { id: 1 }, senderFrame: null }, MAIN_ONLY, cfg)).toMatchObject({ ok: false });
    expect(checkSender(ev(1, "https://evil.example/"), MAIN_ONLY, cfg)).toMatchObject({ ok: false, reason: "发送页面不是本应用页面" });
  });

  it("高危通道：必须主窗口、在前台、且从模型监测页发起", () => {
    const at = (route: string) => ev(1, `${POSIX_URL}#${route}`);
    expect(checkSender(at("/model-monitor"), MODEL_MONITOR_HIGH_RISK, cfg)).toEqual({ ok: true, role: "main" });
    expect(checkSender(at("/model-monitor/x"), MODEL_MONITOR_HIGH_RISK, cfg)).toMatchObject({ ok: true });
    expect(checkSender(at("/settings"), MODEL_MONITOR_HIGH_RISK, cfg)).toMatchObject({ ok: false });
    expect(checkSender(at("/model-monitorX"), MODEL_MONITOR_HIGH_RISK, cfg)).toMatchObject({ ok: false });
    expect(checkSender(ev(2, `${POSIX_URL}#/model-monitor`), MODEL_MONITOR_HIGH_RISK, cfg)).toMatchObject({ ok: false });
    const unfocused = makeConfig({ 1: "main" }, false);
    expect(checkSender(at("/model-monitor"), MODEL_MONITOR_HIGH_RISK, unfocused)).toMatchObject({ ok: false, reason: "窗口不在前台" });
  });
});

describe("createGuardedIpc", () => {
  function fakeIpc() {
    const handlers = new Map<string, (e: any, ...a: any[]) => unknown>();
    const listeners = new Map<string, (e: any, ...a: any[]) => void>();
    return {
      handlers,
      listeners,
      handle: (c: string, fn: (e: any, ...a: any[]) => unknown) => void handlers.set(c, fn),
      on: (c: string, fn: (e: any, ...a: any[]) => void) => void listeners.set(c, fn),
    };
  }

  it("放行时把参数原样交给处理函数；拒绝时抛统一错误并回调 onReject", () => {
    const ipc = fakeIpc();
    const onReject = vi.fn();
    const guard = createGuardedIpc(ipc, () => makeConfig({ 1: "main", 2: "pet" }), onReject);
    guard.handle("x:echo", MAIN_ONLY, (_e, a, b) => [a, b]);
    expect(ipc.handlers.get("x:echo")!(ev(1), 1, "two")).toEqual([1, "two"]);
    expect(() => ipc.handlers.get("x:echo")!(ev(2), 1)).toThrow(REJECT_MESSAGE);
    expect(onReject).toHaveBeenCalledWith("x:echo", expect.stringContaining("pet"));
  });

  it("send 类通道拒绝时静默丢弃", () => {
    const ipc = fakeIpc();
    const fn = vi.fn();
    const guard = createGuardedIpc(ipc, () => makeConfig({ 1: "main", 2: "pet" }));
    guard.on("pet:drag-move", PET_ONLY, fn);
    ipc.listeners.get("pet:drag-move")!(ev(1));
    expect(fn).not.toHaveBeenCalled();
    ipc.listeners.get("pet:drag-move")!(ev(2));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("同一通道重复注册直接报错，避免策略被后注册的覆盖", () => {
    const guard = createGuardedIpc(fakeIpc(), () => makeConfig({}));
    guard.handle("a", MAIN_ONLY, () => 1);
    expect(() => guard.handle("a", MAIN_AND_PET, () => 1)).toThrow("重复注册");
  });
});

describe("registerWindowRole", () => {
  it("窗口销毁后自动注销", () => {
    let destroyed: (() => void) | undefined;
    registerWindowRole({ id: 42, once: (_e, cb) => { destroyed = cb; } }, "pet");
    expect(windowRoleOf(42)).toBe("pet");
    destroyed?.();
    expect(windowRoleOf(42)).toBeUndefined();
  });
});
