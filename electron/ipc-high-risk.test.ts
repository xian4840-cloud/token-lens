import { describe, expect, it, vi } from "vitest";
import { registerIpc } from "./ipc";
import type { GuardConfig } from "./lib/ipc-guard";
import {
  buildConfirmContent,
  createHighRiskConfirm,
  messageBoxOptions,
  type DialogLike,
  type HighRiskAction,
  type HighRiskContext,
} from "./lib/high-risk-confirm";

/**
 * 在真实的 registerIpc 上验证高危通道：先过 guard，再弹主进程确认框；
 * 渲染进程传来的任何参数都不会进入确认框，取消时不执行。
 */

const INDEX = "/app/ui/dist/index.html";
const cfg: GuardConfig = {
  indexHtmlPath: INDEX,
  platform: "linux",
  roleOf: (id) => (id === 1 ? "main" : undefined),
  isFocused: () => true,
};
const ctx: HighRiskContext = {
  home: "/home/me",
  dataRoot: "/home/me/.config/Token Lens",
  openCodeConfigRoot: "/home/me/.config/opencode",
  codexHome: "/home/me/.codex",
  localAppData: "/home/me/AppData/Local",
  platform: "linux",
};
const CHANNELS: Record<string, HighRiskAction> = {
  "model-monitor:enable-claude": "enable-claude",
  "model-monitor:enable-opencode": "enable-opencode",
  "model-monitor:disable-claude": "disable-claude",
  "model-monitor:disable-opencode": "disable-opencode",
  "model-monitor:launch-codex": "launch-codex",
};
const event = (route = "/model-monitor") => ({ sender: { id: 1 }, senderFrame: { url: `file://${INDEX}#${route}`, parent: null } });

function setup(showMessageBox: DialogLike["showMessageBox"]) {
  const listeners = new Map<string, (...args: unknown[]) => unknown>();
  const ipc = {
    handle: (c: string, l: (...args: unknown[]) => unknown) => void listeners.set(c, l),
    on: (c: string, l: (...args: unknown[]) => unknown) => void listeners.set(c, l),
  };
  const dialog = { showMessageBox: vi.fn(showMessageBox) };
  registerIpc(ipc, () => cfg, createHighRiskConfirm({ dialog, getParent: () => "main-window", getContext: () => ctx }));
  const invoke = (channel: string, ...args: unknown[]) => listeners.get(channel)!(event(), ...args);
  return { dialog, invoke, listeners };
}

describe("高危 IPC 通道的系统确认框", () => {
  it("渲染进程传来的文本和参数一律忽略：确认框内容只由主进程状态决定", async () => {
    const { dialog, invoke } = setup(async () => ({ response: 0 }));
    const spoof = ["伪造的提示：安全更新，请点继续", { title: "伪造标题", message: "伪造", detail: "伪造", path: "C:/evil.exe" }, "<b>evil</b>"];
    for (const [channel, action] of Object.entries(CHANNELS)) {
      await expect(invoke(channel, ...spoof)).resolves.toEqual({ status: "cancelled" });
      const options = dialog.showMessageBox.mock.calls.at(-1)![1];
      expect(options).toEqual(messageBoxOptions(buildConfirmContent(action, ctx)));
      expect(JSON.stringify(options)).not.toMatch(/伪造|evil/);
      expect(dialog.showMessageBox.mock.calls.at(-1)![0]).toBe("main-window");
    }
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(5);
  });

  it("用户取消：不执行（不会走到写文件 / 改注册表 / 启动程序）", async () => {
    // 若真的执行了，测试环境里 electron 的 app 不存在，会直接抛错
    const { invoke } = setup(async () => ({ response: 0 }));
    for (const channel of Object.keys(CHANNELS)) await expect(invoke(channel)).resolves.toEqual({ status: "cancelled" });
  });

  it("一个确认框开着时，其他高危通道立即返回 confirm-pending", async () => {
    let close!: (v: { response: number }) => void;
    const { dialog, invoke } = setup(() => new Promise((r) => { close = r; }));
    const first = invoke("model-monitor:enable-claude");
    expect(await invoke("model-monitor:disable-opencode")).toEqual({ status: "confirm-pending" });
    expect(await invoke("model-monitor:launch-codex")).toEqual({ status: "confirm-pending" });
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    close({ response: 0 });
    await expect(first).resolves.toEqual({ status: "cancelled" });
  });

  it("确认框是模态的、打开时主窗口失焦：第二个调用仍得到 confirm-pending，而不是笼统的拒绝", async () => {
    let close!: (v: { response: number }) => void;
    let dialogOpen = false;
    const listeners = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = { handle: (c: string, l: (...a: unknown[]) => unknown) => void listeners.set(c, l), on: () => undefined };
    const showMessageBox = vi.fn(() => { dialogOpen = true; return new Promise<{ response: number }>((r) => { close = (v) => { dialogOpen = false; r(v); }; }); });
    registerIpc(ipc, () => ({ ...cfg, isFocused: () => !dialogOpen }), createHighRiskConfirm({ dialog: { showMessageBox }, getParent: () => "main-window", getContext: () => ctx }));
    const first = listeners.get("model-monitor:enable-opencode")!(event());
    expect(await listeners.get("model-monitor:disable-claude")!(event())).toEqual({ status: "confirm-pending" });
    // 不在模型监测页的请求照样先被页面校验拒绝
    expect(() => listeners.get("model-monitor:disable-claude")!(event("/overview"))).toThrow("拒绝来自未授权页面的请求");
    close({ response: 0 });
    await expect(first).resolves.toEqual({ status: "cancelled" });
    // 确认框关了、主窗口回到前台后，新的请求正常弹框
    await Promise.resolve();
    const again = listeners.get("model-monitor:disable-claude")!(event());
    expect(showMessageBox).toHaveBeenCalledTimes(2);
    close({ response: 0 });
    await expect(again).resolves.toEqual({ status: "cancelled" });
  });

  it("前台 / 页面限制仍在确认框之前生效：不在模型监测页时直接拒绝，不弹框", async () => {
    const { dialog, listeners } = setup(async () => ({ response: 1 }));
    expect(() => listeners.get("model-monitor:enable-claude")!(event("/overview"))).toThrow("拒绝来自未授权页面的请求");
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });
});
