import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppBootstrap, BalanceResult, ServiceRecord } from "@/types";

/**
 * 全局 store 的行为测试：window.tokenLens 换成假的主进程 API，
 * 验证启动、刷新（单卡 / 全部）、错误、事件推送和各种「后发先至」的竞态处理。
 * store 里有模块级状态（init 单飞、监听只注册一次、请求序号），每个用例重新加载模块。
 */

const toast = vi.hoisted(() => ({ showToast: vi.fn() }));
const reporting = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/toast", () => toast);
vi.mock("@/lib/error-reporting", () => reporting);

type Fn = ReturnType<typeof vi.fn>;
type FakeApi = Record<string, Fn> & {
  emitBalance: (p: unknown) => void;
  emitLocalUsage: () => void;
};

const svc = (id: string, provider = "openai"): ServiceRecord =>
  ({
    id,
    name: id,
    provider,
    kind: "api",
    config: {},
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  }) as ServiceRecord;

const bal = (serviceId: string, remaining: number): BalanceResult =>
  ({
    serviceId,
    remaining,
    currency: "USD",
    fetchedAt: "2026-10-08T00:00:00.000Z",
  }) as BalanceResult;

function bootstrap(over: Partial<AppBootstrap> = {}): AppBootstrap {
  return {
    definitions: [],
    services: [svc("a"), svc("b")],
    settings: {
      refreshInterval: "",
      proxyMode: "",
      proxyCustomUrl: "",
      proxyBypassRules: "",
      requestTimeout: "",
      monthlyBudgetUsd: "",
      pinnedServiceIds: '["b","b"," "]',
      hiddenServiceIds: "not json",
    },
    lastBalances: { a: bal("a", 1) },
    petEnabled: true,
    todayLocal: [],
    monthLocal: [],
    ...over,
  } as AppBootstrap;
}

function fakeApi(): FakeApi {
  let balanceCb: ((p: unknown) => void) | undefined;
  let localCb: (() => void) | undefined;
  const api = {
    bootstrap: vi.fn(async () => bootstrap()),
    refreshService: vi.fn(async (id: string) => bal(id, 10)),
    listServices: vi.fn(async () => [svc("a")]),
    deleteService: vi.fn(async () => true),
    setSetting: vi.fn(async () => true),
    setPetEnabled: vi.fn(async () => true),
    listSnapshots: vi.fn(async () => []),
    listUsage: vi.fn(async () => []),
    refreshUsage: vi.fn(async () => ({})),
    listLocalDaily: vi.fn(async () => []),
    scanLocalUsage: vi.fn(async () => ({ records: [], unavailable: [] })),
    testProxy: vi.fn(async () => ({ targets: [] })),
    getPricingTable: vi.fn(async () => []),
    savePricingOverrides: vi.fn(async () => true),
    onBalanceUpdated: vi.fn((cb: (p: unknown) => void) => {
      balanceCb = cb;
      return () => undefined;
    }),
    onLocalUsageUpdated: vi.fn((cb: () => void) => {
      localCb = cb;
      return () => undefined;
    }),
    emitBalance: (p: unknown) => balanceCb?.(p),
    emitLocalUsage: () => localCb?.(),
  };
  return api as unknown as FakeApi;
}

let api: FakeApi;

async function loadStore() {
  vi.resetModules();
  const mod = await import("./app");
  return mod.useAppStore;
}

/** 手动控制完成时机的 Promise */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  api = fakeApi();
  vi.stubGlobal("window", { tokenLens: api });
  toast.showToast.mockClear();
  reporting.reportError.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("init", () => {
  it("用 bootstrap 填充状态：空设置回落默认值，ID 列表清洗，loaded 置真", async () => {
    const store = await loadStore();
    await store.getState().init();
    const s = store.getState();
    expect(s.loaded).toBe(true);
    expect(s.initError).toBeNull();
    expect(s.services.map((x) => x.id)).toEqual(["a", "b"]);
    expect(s.refreshInterval).toBe("5");
    expect(s.proxyMode).toBe("system");
    expect(s.requestTimeout).toBe("15");
    expect(s.proxyBypassRules).toContain("*.cn");
    expect(s.pinnedIds).toEqual(["b"]);
    expect(s.hiddenIds).toEqual([]);
    expect(s.petEnabled).toBe(true);
    // 先展示上次的余额，随后自动刷新一轮
    expect(api.refreshService).toHaveBeenCalledTimes(2);
  });

  it("单飞：并发调用（StrictMode 双 effect）只打一次 bootstrap、只刷新一轮", async () => {
    const store = await loadStore();
    await Promise.all([store.getState().init(), store.getState().init()]);
    await store.getState().init();
    expect(api.bootstrap).toHaveBeenCalledTimes(1);
    expect(api.refreshService).toHaveBeenCalledTimes(2);
    expect(api.onBalanceUpdated).toHaveBeenCalledTimes(1);
    expect(api.onLocalUsageUpdated).toHaveBeenCalledTimes(1);
  });

  it("bootstrap 失败：记录 initError、loaded 为假，之后可以重试成功", async () => {
    const store = await loadStore();
    api.bootstrap.mockRejectedValueOnce(new Error("数据文件损坏"));
    await store.getState().init();
    expect(store.getState()).toMatchObject({ initError: "数据文件损坏", loaded: false });
    expect(api.refreshService).not.toHaveBeenCalled();
    await store.getState().init();
    expect(store.getState()).toMatchObject({ initError: null, loaded: true });
    expect(api.bootstrap).toHaveBeenCalledTimes(2);
  });

  it("后台推送的余额事件：成功覆盖余额并清错误，失败只记错误、保留上次余额", async () => {
    const store = await loadStore();
    await store.getState().init();
    await flush();
    api.emitBalance({ id: "a", error: "HTTP 500" });
    expect(store.getState().errors.a).toBe("HTTP 500");
    expect(store.getState().balances.a?.remaining).toBe(10);
    api.emitBalance({ id: "a", balance: bal("a", 42) });
    expect(store.getState().errors.a).toBe("");
    expect(store.getState().balances.a?.remaining).toBe(42);
  });

  it("本地用量更新事件触发重读今日 / 本月数据", async () => {
    const store = await loadStore();
    await store.getState().init();
    api.listLocalDaily.mockClear();
    api.emitLocalUsage();
    await flush();
    expect(api.listLocalDaily).toHaveBeenCalledTimes(1);
  });
});

describe("刷新", () => {
  it("单卡刷新：进行中标记转圈，成功写入余额并清掉旧错误", async () => {
    const store = await loadStore();
    store.setState({ errors: { a: "旧错误" } });
    const d = deferred<BalanceResult>();
    api.refreshService.mockReturnValueOnce(d.promise);
    const p = store.getState().refreshService("a");
    expect(store.getState().refreshingIds).toEqual({ a: true });
    d.resolve(bal("a", 7));
    await p;
    expect(store.getState().refreshingIds).toEqual({});
    expect(store.getState().balances.a?.remaining).toBe(7);
    expect(store.getState().errors.a).toBe("");
  });

  it("单卡刷新失败：记录错误信息、保留上次余额、去掉转圈", async () => {
    const store = await loadStore();
    store.setState({ balances: { a: bal("a", 3) } });
    api.refreshService.mockRejectedValueOnce(new Error("API Key 无效或已过期"));
    await store.getState().refreshService("a");
    const s = store.getState();
    expect(s.errors.a).toBe("API Key 无效或已过期");
    expect(s.balances.a?.remaining).toBe(3);
    expect(s.refreshingIds).toEqual({});
  });

  it("全部刷新：部分失败时提示失败个数，结束后 refreshing 复位", async () => {
    const store = await loadStore();
    store.setState({ services: [svc("a"), svc("b"), svc("c")] });
    api.refreshService.mockImplementation(async (id: string) => {
      if (id === "b") throw new Error("x");
      return bal(id, 1);
    });
    const p = store.getState().refreshAll();
    expect(store.getState().refreshing).toBe(true);
    expect(store.getState().refreshingIds).toEqual({ a: true, b: true, c: true });
    await p;
    expect(store.getState().refreshing).toBe(false);
    expect(toast.showToast).toHaveBeenCalledWith("1 个服务刷新失败", "err");
  });

  it("全部刷新：全失败提示「全部刷新失败」，全成功不打扰", async () => {
    const store = await loadStore();
    store.setState({ services: [svc("a"), svc("b")] });
    api.refreshService.mockRejectedValue(new Error("x"));
    await store.getState().refreshAll();
    expect(toast.showToast).toHaveBeenLastCalledWith("全部刷新失败", "err");
    toast.showToast.mockClear();
    api.refreshService.mockResolvedValue(bal("a", 1));
    await store.getState().refreshAll();
    expect(toast.showToast).not.toHaveBeenCalled();
    expect(store.getState().errors).toEqual({ a: "", b: "" });
  });

  it("用量刷新只针对支持用量查询的服务，失败计入提示", async () => {
    const store = await loadStore();
    store.setState({
      services: [svc("a", "openai"), svc("k", "kimi")],
      definitions: [
        { provider: "openai", supportsUsage: true },
        { provider: "kimi", supportsUsage: false },
      ] as never,
    });
    api.refreshUsage.mockRejectedValueOnce(new Error("HTTP 403"));
    const period = { start: "2026-10-01", end: "2026-10-08" };
    const p = store.getState().refreshAllUsage(period);
    expect(store.getState().usageRefreshing).toBe(true);
    await p;
    expect(api.refreshUsage).toHaveBeenCalledTimes(1);
    expect(api.refreshUsage).toHaveBeenCalledWith("a", period);
    expect(store.getState().errors.a).toBe("HTTP 403");
    expect(store.getState().usageRefreshing).toBe(false);
    expect(toast.showToast).toHaveBeenCalledWith("全部用量刷新失败", "err");
  });
});

describe("后发先至：只采用最后一次请求的结果", () => {
  it("loadUsage：先发的慢请求晚回来时被丢弃", async () => {
    const store = await loadStore();
    const slow = deferred<unknown[]>();
    api.listUsage.mockReturnValueOnce(slow.promise).mockResolvedValueOnce([{ id: "new" }]);
    const first = store.getState().loadUsage("2026-01-01");
    await store.getState().loadUsage("2026-10-01");
    slow.resolve([{ id: "old" }]);
    await first;
    expect(store.getState().usageRecords).toEqual([{ id: "new" }]);
  });

  it("loadLocalDaily 与 scanLocalUsage 共用序号：扫描回来时若已有更新的查询，不覆盖", async () => {
    const store = await loadStore();
    const slowList = deferred<unknown[]>();
    api.listLocalDaily
      .mockReturnValueOnce(slowList.promise) // 扫描后的重载（慢）
      .mockResolvedValueOnce([{ date: "newer" }]); // 用户随后切了时间范围
    const scan = store.getState().scanLocalUsage("2026-09-01");
    await flush();
    await store.getState().loadLocalDaily("2026-10-01");
    slowList.resolve([{ date: "stale" }]);
    await scan;
    expect(store.getState().localDailyRecords).toEqual([{ date: "newer" }]);
    expect(store.getState().localUsageScanning).toBe(false);
  });

  it("loadSnapshots 同样丢弃过期结果", async () => {
    const store = await loadStore();
    const slow = deferred<unknown[]>();
    api.listSnapshots.mockReturnValueOnce(slow.promise).mockResolvedValueOnce([{ id: 2 }]);
    const first = store.getState().loadSnapshots();
    await store.getState().loadSnapshots("2026-10-01");
    slow.resolve([{ id: 1 }]);
    await first;
    expect(store.getState().snapshots).toEqual([{ id: 2 }]);
  });
});

describe("本地扫描", () => {
  it("意外不可用的来源弹提示；在设置里主动关闭的不提示", async () => {
    const store = await loadStore();
    api.scanLocalUsage.mockResolvedValueOnce({
      records: [],
      unavailable: [
        { source: "codex", reason: "已在设置中关闭" },
        { source: "opencode", reason: "数据库被占用" },
      ],
    });
    await store.getState().scanLocalUsage();
    expect(toast.showToast).toHaveBeenCalledWith("数据库被占用", "err");
    expect(store.getState().localUsageUnavailable).toHaveLength(2);
  });

  it("扫描失败：上报错误并继续抛给调用方，scanning 复位", async () => {
    const store = await loadStore();
    api.scanLocalUsage.mockRejectedValueOnce(new Error("EACCES"));
    await expect(store.getState().scanLocalUsage()).rejects.toThrow("EACCES");
    expect(reporting.reportError).toHaveBeenCalledWith("scanLocalUsage", expect.any(Error));
    expect(store.getState().localUsageScanning).toBe(false);
  });

  it("今日卡片的查询区间：至少覆盖近 14 天（月初也能算周对比），月中取月初", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const store = await loadStore();
    vi.setSystemTime(new Date(2026, 9, 3, 12));
    api.listLocalDaily.mockResolvedValueOnce([
      { date: "2026-10-03", source: "codex" },
      { date: "2026-09-25", source: "codex" },
    ]);
    await store.getState().loadTodayLocal();
    expect(api.listLocalDaily).toHaveBeenLastCalledWith("2026-09-20", "2026-10-03");
    expect(store.getState().todayLocal).toEqual([{ date: "2026-10-03", source: "codex" }]);
    expect(store.getState().monthLocal).toHaveLength(2);
    vi.setSystemTime(new Date(2026, 9, 25, 12));
    await store.getState().loadTodayLocal();
    expect(api.listLocalDaily).toHaveBeenLastCalledWith("2026-10-01", "2026-10-25");
  });
});

describe("服务与设置", () => {
  it("删除服务：同步移出置顶 / 隐藏列表（只在有变化时写设置），清掉余额与错误", async () => {
    const store = await loadStore();
    store.setState({
      services: [svc("a"), svc("b")],
      pinnedIds: ["a", "b"],
      hiddenIds: ["b"],
      balances: { a: bal("a", 1) },
      errors: { a: "x" },
    });
    await store.getState().deleteService("a");
    expect(api.deleteService).toHaveBeenCalledWith("a");
    expect(api.setSetting).toHaveBeenCalledTimes(1);
    expect(api.setSetting).toHaveBeenCalledWith("pinnedServiceIds", '["b"]');
    const s = store.getState();
    expect(s.services.map((x) => x.id)).toEqual(["b"]);
    expect(s.pinnedIds).toEqual(["b"]);
    expect(s.hiddenIds).toEqual(["b"]);
    expect(s.balances).toEqual({});
    expect(s.errors).toEqual({});
  });

  it("删除失败时状态不变", async () => {
    const store = await loadStore();
    store.setState({ services: [svc("a")], pinnedIds: ["a"] });
    api.deleteService.mockRejectedValueOnce(new Error("no"));
    await expect(store.getState().deleteService("a")).rejects.toThrow("no");
    expect(store.getState().services).toHaveLength(1);
    expect(store.getState().pinnedIds).toEqual(["a"]);
  });

  it("置顶 / 隐藏切换写入设置；设置写入失败时不改本地状态", async () => {
    const store = await loadStore();
    await store.getState().togglePinned("a");
    expect(api.setSetting).toHaveBeenLastCalledWith("pinnedServiceIds", '["a"]');
    expect(store.getState().pinnedIds).toEqual(["a"]);
    await store.getState().togglePinned("a");
    expect(store.getState().pinnedIds).toEqual([]);
    api.setSetting.mockRejectedValueOnce(new Error("不允许"));
    await expect(store.getState().toggleHidden("a")).rejects.toThrow();
    expect(store.getState().hiddenIds).toEqual([]);
  });

  it("预算保存失败（主进程校验不过）时保留原值", async () => {
    const store = await loadStore();
    store.setState({ monthlyBudgetUsd: "20" });
    api.setSetting.mockRejectedValueOnce(new Error("月度预算需为正数"));
    await expect(store.getState().saveMonthlyBudgetUsd("-1")).rejects.toThrow();
    expect(store.getState().monthlyBudgetUsd).toBe("20");
  });

  it("代理测试：无论成功失败都复位 proxyTesting", async () => {
    const store = await loadStore();
    api.testProxy.mockRejectedValueOnce(new Error("timeout"));
    await expect(store.getState().testProxy()).rejects.toThrow();
    expect(store.getState().proxyTesting).toBe(false);
    const result = { targets: [{ name: "x", ok: true, latencyMs: 1 }] };
    api.testProxy.mockResolvedValueOnce(result);
    await expect(store.getState().testProxy({ mode: "direct" })).resolves.toBe(result);
    expect(store.getState().proxyTestResult).toBe(result);
  });

  it("保存价格覆盖后重读合并后的价格表", async () => {
    const store = await loadStore();
    api.getPricingTable.mockResolvedValueOnce([{ key: "gpt" }]);
    await store.getState().savePricing({ gpt: { inputPerM: 1 } });
    expect(api.savePricingOverrides).toHaveBeenCalledWith({ gpt: { inputPerM: 1 } });
    expect(store.getState().pricingTable).toEqual([{ key: "gpt" }]);
  });

  it("导入备份后重读服务、置顶 / 隐藏与预算，不触发厂商刷新；失败只上报", async () => {
    const store = await loadStore();
    api.bootstrap.mockResolvedValueOnce(
      bootstrap({
        services: [svc("z")],
        settings: {
          ...bootstrap().settings,
          pinnedServiceIds: '["z"]',
          monthlyBudgetUsd: "50",
        },
      }),
    );
    await store.getState().reloadAfterBackupImport();
    expect(store.getState()).toMatchObject({ pinnedIds: ["z"], monthlyBudgetUsd: "50" });
    expect(store.getState().services.map((x) => x.id)).toEqual(["z"]);
    expect(api.refreshService).not.toHaveBeenCalled();
    api.bootstrap.mockRejectedValueOnce(new Error("x"));
    await store.getState().reloadAfterBackupImport();
    expect(reporting.reportError).toHaveBeenCalledWith(
      "reloadAfterBackupImport",
      expect.any(Error),
    );
  });
});
