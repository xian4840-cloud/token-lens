import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  listServices: vi.fn(),
  getSetting: vi.fn(),
  flushDb: vi.fn(),
  refreshServices: vi.fn(),
  scanAndPersistLocalUsage: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("./db", () => ({
  listServices: m.listServices,
  getSetting: m.getSetting,
  flushDb: m.flushDb,
}));
vi.mock("./refresh", () => ({ refreshServices: m.refreshServices }));
vi.mock("./local-usage", () => ({ scanAndPersistLocalUsage: m.scanAndPersistLocalUsage }));
vi.mock("./lib/logger", () => ({ logError: m.logError }));

const { normalizeIntervalMinutes, restart, stop, startScheduler, setMainWindow } =
  await import("./scheduler");

describe("normalizeIntervalMinutes", () => {
  it("正常数值原样返回", () => {
    expect(normalizeIntervalMinutes("5")).toBe(5);
    expect(normalizeIntervalMinutes("0.5")).toBe(0.5);
    expect(normalizeIntervalMinutes(30)).toBe(30);
  });

  it("不可解析的值退回默认值，而不是退化成 1 毫秒轮询（回归）", () => {
    // 此前是 `Number(setting ?? "5")` 直接喂给 restart，而 `NaN <= 0` 为 false，
    // 于是走到 setInterval(fn, NaN)，Node 把非数值延迟当作 1 毫秒——
    // 变成每毫秒把所有服务商的 API 轮询一遍。
    expect(normalizeIntervalMinutes("abc")).toBe(5);
    expect(normalizeIntervalMinutes("")).toBe(5);
    expect(normalizeIntervalMinutes(undefined)).toBe(5);
    expect(normalizeIntervalMinutes(Number.NaN)).toBe(5);
    expect(normalizeIntervalMinutes(Number.POSITIVE_INFINITY)).toBe(5);
  });

  it("显式的 0 或负数才表示关闭自动刷新", () => {
    expect(normalizeIntervalMinutes("0")).toBeNull();
    expect(normalizeIntervalMinutes(0)).toBeNull();
    expect(normalizeIntervalMinutes("-1")).toBeNull();
    expect(normalizeIntervalMinutes(-0.5)).toBeNull();
  });
});

/**
 * 后台定时刷新：按间隔触发、跳过待补密钥的服务、结果推给主窗口、
 * 上一轮没跑完不叠加、本地扫描失败只留痕。
 */
describe("调度器", () => {
  const send = vi.fn();
  let destroyed = false;
  const win = { isDestroyed: () => destroyed, webContents: { send } };
  const MIN = 60_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    destroyed = false;
    setMainWindow(win as never);
    m.listServices.mockReturnValue([
      { id: "a" },
      { id: "b" },
      { id: "restored", needsCredentials: true },
    ]);
    m.refreshServices.mockImplementation(async ([id]: string[]) =>
      id === "b"
        ? [{ status: "rejected", reason: new Error("HTTP 401 Unauthorized") }]
        : [{ status: "fulfilled", value: { serviceId: id, remaining: 1 } }],
    );
    m.scanAndPersistLocalUsage.mockResolvedValue(undefined);
  });
  afterEach(() => {
    stop();
    setMainWindow(null);
    vi.useRealTimers();
  });

  it("按间隔刷新：跳过待补密钥的服务，成功推余额、失败推用户可读的错误，最后落盘并扫描本地用量", async () => {
    restart(5);
    await vi.advanceTimersByTimeAsync(5 * MIN - 1);
    expect(m.refreshServices).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(m.refreshServices.mock.calls.map((c) => c[0])).toEqual([["a"], ["b"]]);
    expect(send).toHaveBeenCalledWith("balance:updated", {
      id: "a",
      balance: { serviceId: "a", remaining: 1 },
    });
    const errEvent = send.mock.calls.find((c) => c[1].id === "b")?.[1];
    expect(errEvent.error).toEqual(expect.any(String));
    expect(errEvent.error).not.toContain("HTTP 401 Unauthorized");
    expect(m.flushDb).toHaveBeenCalledTimes(1);
    expect(m.scanAndPersistLocalUsage).toHaveBeenCalledTimes(1);
  });

  it("上一轮还没跑完时下一轮直接跳过，不叠加请求", async () => {
    const pending: (() => void)[] = [];
    const release = () => pending.splice(0).forEach((r) => r());
    m.refreshServices.mockImplementation(
      () =>
        new Promise((r) => {
          pending.push(() => r([{ status: "fulfilled", value: {} }]));
        }),
    );
    m.listServices.mockReturnValue([{ id: "a" }]);
    restart(1);
    await vi.advanceTimersByTimeAsync(MIN);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(m.refreshServices).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(MIN);
    expect(m.refreshServices).toHaveBeenCalledTimes(2);
    // 收尾：放掉这一轮，锁是模块级的，别带进下一个用例
    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("窗口已销毁时不推送；本地扫描失败只记日志", async () => {
    destroyed = true;
    m.scanAndPersistLocalUsage.mockRejectedValue(new Error("EACCES"));
    restart(1);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(send).not.toHaveBeenCalled();
    expect(m.logError).toHaveBeenCalledWith("local-usage", expect.any(Error));
  });

  it("restart 替换旧定时器；0 / 负数 / NaN 关闭自动刷新", async () => {
    restart(1);
    restart(10);
    await vi.advanceTimersByTimeAsync(9 * MIN);
    expect(m.refreshServices).not.toHaveBeenCalled();
    for (const v of [0, -1, Number.NaN]) {
      restart(v);
      await vi.advanceTimersByTimeAsync(60 * MIN);
    }
    expect(m.refreshServices).not.toHaveBeenCalled();
  });

  it("startScheduler：立即扫一次本地用量，按设置的间隔启动；设置为 0 时不轮询", async () => {
    m.getSetting.mockReturnValue("2");
    startScheduler();
    expect(m.scanAndPersistLocalUsage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(m.refreshServices).toHaveBeenCalled();

    vi.clearAllMocks();
    m.getSetting.mockReturnValue("0");
    m.scanAndPersistLocalUsage.mockRejectedValue(new Error("boom"));
    startScheduler();
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(m.refreshServices).not.toHaveBeenCalled();
    expect(m.logError).toHaveBeenCalledWith("local-usage", expect.any(Error));
  });
});
