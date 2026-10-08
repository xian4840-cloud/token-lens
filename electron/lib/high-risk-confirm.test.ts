import { describe, expect, it, vi } from "vitest";
import {
  buildConfirmContent,
  CANCEL_LABEL,
  createHighRiskConfirm,
  messageBoxOptions,
  type DialogLike,
  type HighRiskAction,
  type HighRiskContext,
} from "./high-risk-confirm";

const ctx: HighRiskContext = {
  home: "C:\\Users\\me",
  dataRoot: "C:\\Users\\me\\AppData\\Roaming\\Token Lens",
  openCodeConfigRoot: "C:\\Users\\me\\.config\\opencode",
  codexHome: "C:\\Users\\me\\.codex",
  localAppData: "C:\\Users\\me\\AppData\\Local",
  platform: "win32",
};
const ACTIONS: HighRiskAction[] = ["enable-claude", "enable-opencode", "disable-claude", "disable-opencode", "launch-codex"];
const PARENT = { name: "main-window" };
const EVENT = { sender: { id: 1 } };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(responses: Array<number | Promise<{ response: number }> | Error>) {
  const showMessageBox = vi.fn<DialogLike["showMessageBox"]>(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (typeof next === "number") return { response: next };
    return next ?? { response: 0 };
  });
  const getParent = vi.fn(() => PARENT);
  const confirm = createHighRiskConfirm({ dialog: { showMessageBox }, getParent, getContext: () => ctx });
  return { confirm, showMessageBox, getParent };
}

describe("高危操作的系统确认框", () => {
  it("点「继续」才执行，返回 ok 与原返回值；确认框以主窗口为父窗口、默认和取消按钮都是「取消」", async () => {
    const { confirm, showMessageBox, getParent } = setup([1]);
    const fn = vi.fn(() => ({ removed: ["x"], kept: [] }));
    await expect(confirm.run("disable-claude", EVENT, fn)).resolves.toEqual({ status: "ok", value: { removed: ["x"], kept: [] } });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getParent).toHaveBeenCalledWith(EVENT);
    const [parent, options] = showMessageBox.mock.calls[0];
    expect(parent).toBe(PARENT);
    expect(options).toMatchObject({ type: "warning", defaultId: 0, cancelId: 0, noLink: true });
    expect(options.buttons).toEqual([CANCEL_LABEL, "关闭采集"]);
  });

  it("异步操作的结果也会等到；操作本身抛错照常抛出，且不会卡住后续确认", async () => {
    const { confirm } = setup([1, 1]);
    await expect(confirm.run("launch-codex", EVENT, async () => 42)).resolves.toEqual({ status: "ok", value: 42 });
    await expect(confirm.run("launch-codex", EVENT, () => { throw new Error("未找到官方 Codex"); })).rejects.toThrow("未找到官方 Codex");
    expect(confirm.pending).toBe(false);
  });

  it("取消（含 Esc / 关窗，都返回 cancelId 0）什么都不做，返回 cancelled", async () => {
    const { confirm } = setup([0]);
    const fn = vi.fn();
    await expect(confirm.run("enable-claude", EVENT, fn)).resolves.toEqual({ status: "cancelled" });
    expect(fn).not.toHaveBeenCalled();
    expect(confirm.pending).toBe(false);
  });

  it("确认框本身出错按取消处理，不执行", async () => {
    const { confirm } = setup([new Error("no display")]);
    const fn = vi.fn();
    await expect(confirm.run("enable-opencode", EVENT, fn)).resolves.toEqual({ status: "cancelled" });
    expect(fn).not.toHaveBeenCalled();
    expect(confirm.pending).toBe(false);
  });

  it("同一时间只允许一个确认框：第二个高危调用立即返回 confirm-pending，不排队、不执行", async () => {
    const first = deferred<{ response: number }>();
    const { confirm, showMessageBox } = setup([first.promise, 1]);
    const fn1 = vi.fn(() => "first");
    const fn2 = vi.fn(() => "second");
    const p1 = confirm.run("enable-claude", EVENT, fn1);
    expect(confirm.pending).toBe(true);
    // 第一个确认框还没关，第二个调用必须立刻得到结果
    await expect(confirm.run("disable-opencode", EVENT, fn2)).resolves.toEqual({ status: "confirm-pending" });
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    first.resolve({ response: 1 });
    await expect(p1).resolves.toEqual({ status: "ok", value: "first" });
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).not.toHaveBeenCalled();
    // 被拒的请求没有被排队：之后也不会补弹、补执行
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    // 第一个关闭后，新的调用可以正常弹框
    await expect(confirm.run("disable-opencode", EVENT, fn2)).resolves.toEqual({ status: "ok", value: "second" });
    expect(showMessageBox).toHaveBeenCalledTimes(2);
  });

  it("文案只由主进程状态拼出：内容完全由 action 与上下文决定", async () => {
    const { confirm, showMessageBox } = setup([0, 0, 0, 0, 0]);
    for (const action of ACTIONS) await confirm.run(action, EVENT, () => undefined);
    expect(showMessageBox.mock.calls.map((c) => c[1])).toEqual(ACTIONS.map((a) => messageBoxOptions(buildConfirmContent(a, ctx))));
  });

  it("说清楚要改什么：环境变量、文件 / 目录、启动的程序", () => {
    const c = (a: HighRiskAction) => buildConfirmContent(a, ctx);
    expect(c("enable-claude").detail).toContain("HKCU\\Environment\\BUN_OPTIONS");
    expect(c("enable-claude").detail).toContain("--preload=C:/Users/me/.claude/token-lens-monitor/claude.cjs");
    expect(c("enable-claude").detail).toContain("C:\\Users\\me\\.claude\\token-lens-monitor");
    expect(c("enable-claude").detail).toContain("claude.cjs、_token-lens-fetch-models.cjs、claude-journal.json");
    expect(c("enable-opencode").detail).toContain("C:\\Users\\me\\.config\\opencode\\plugins");
    expect(c("enable-opencode").detail).toContain("token-lens-response-monitor.js");
    expect(c("disable-claude").detail).toContain("BUN_OPTIONS");
    expect(c("disable-claude").detail).toContain("C:\\Users\\me\\.claude\\token-lens-monitor");
    expect(c("disable-opencode").detail).toContain("C:\\Users\\me\\.config\\opencode\\plugins");
    expect(c("launch-codex").detail).toContain("ChatGPT.exe");
    expect(c("launch-codex").detail).toContain("C:\\Users\\me\\AppData\\Roaming\\Token Lens\\model-capture\\CodexCapture.exe");
    expect(c("launch-codex").detail).toContain("CODEX_CLI_PATH");
    expect(c("launch-codex").detail).toContain("C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin");
    for (const a of ACTIONS) {
      expect(c(a).title.length).toBeGreaterThan(0);
      expect(c(a).message).toMatch(/是否继续？$/);
    }
  });
});
