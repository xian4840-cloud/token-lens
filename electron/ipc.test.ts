import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 主进程 IPC 处理函数的行为测试：在真实的 registerIpc 上注入假的 ipcMain，
 * 依次验证发送方校验、参数校验、错误映射与各通道对存储 / 调度的调用。
 * 存储、调度、网络、日志都换成桩，只断言「传了什么、返回了什么」。
 */

const h = vi.hoisted(() => ({
  db: {
    listServices: vi.fn(() => [{ id: "svc-1" }]),
    deleteServiceRow: vi.fn(),
    listBalanceSnapshots: vi.fn(() => []),
    listUsageRecords: vi.fn(() => []),
    listLocalDailyUsage: vi.fn(() => []),
    clearAllLocalDailyUsage: vi.fn(),
    getSetting: vi.fn((_key: string): string | undefined => undefined),
    setSetting: vi.fn(),
    getLastBalances: vi.fn(() => ({})),
    upsertLocalDailyUsage: vi.fn(),
    dataStats: vi.fn(() => ({ bytes: 1 })),
  },
  refreshService: vi.fn(),
  refreshUsageInternal: vi.fn(),
  restartScheduler: vi.fn(),
  http: {
    applySessionProxy: vi.fn(async () => undefined),
    clearProxyAgentCache: vi.fn(),
    testNetworkConnectivity: vi.fn(async () => ({ targets: [] })),
  },
  logger: {
    clearLogs: vi.fn(),
    getLogPath: vi.fn(() => "/logs/token-lens.log"),
    getRecentLogs: vi.fn(() => []),
    logError: vi.fn(),
    logWarn: vi.fn(),
    write: vi.fn(),
  },
  scan: vi.fn(async () => ({ records: [], unavailable: [] })),
  clearUsageScanCache: vi.fn(),
  applyBackupImport: vi.fn(() => ({ services: 0 })),
  electron: {
    app: { getPath: vi.fn(() => "/user-data"), getAppPath: vi.fn(() => "/app") },
    dialog: { showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
    BrowserWindow: { fromWebContents: vi.fn((): unknown => null) },
    shell: { showItemInFolder: vi.fn(), openPath: vi.fn(async () => "") },
    webContents: { fromId: vi.fn() },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    safeStorage: { isEncryptionAvailable: vi.fn(() => true) },
  },
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("electron", () => h.electron);
vi.mock("./db", () => h.db);
vi.mock("./refresh", () => ({ refreshService: h.refreshService }));
vi.mock("./usage", () => ({ refreshUsageInternal: h.refreshUsageInternal }));
vi.mock("./scheduler", () => ({ restart: h.restartScheduler }));
vi.mock("./lib/logger", () => h.logger);
vi.mock("./local-usage", () => ({ scanAndPersistLocalUsage: h.scan }));
vi.mock("./local-usage/clear-cache", () => ({ clearUsageScanCache: h.clearUsageScanCache }));
vi.mock("./backup-import", () => ({ applyBackupImport: h.applyBackupImport }));
vi.mock("./lib/http", async (orig) => ({
  ...(await orig<typeof import("./lib/http")>()),
  ...h.http,
}));
vi.mock("node:fs", async (orig) => {
  const real = await orig<typeof import("node:fs")>();
  const promises = { ...real.promises, writeFile: h.writeFile };
  return { ...real, default: { ...real, promises }, promises };
});

const { registerIpc } = await import("./ipc");
const { REJECT_MESSAGE } = await import("./lib/ipc-guard");

const INDEX = "/app/ui/dist/index.html";
const MAIN_ID = 1;
const PET_ID = 2;

type Listener = (event: unknown, ...args: unknown[]) => unknown;

function setup() {
  const listeners = new Map<string, Listener>();
  const fakeIpc = {
    handle: (c: string, l: Listener) => void listeners.set(c, l),
    on: (c: string, l: Listener) => void listeners.set(c, l),
  };
  const confirm = { pending: false, run: vi.fn() };
  registerIpc(
    fakeIpc,
    () => ({
      indexHtmlPath: INDEX,
      platform: "linux",
      roleOf: (id) => (id === MAIN_ID ? "main" : id === PET_ID ? "pet" : undefined),
      isFocused: () => true,
    }),
    confirm as never,
  );
  const eventFrom = (id: number, url = `file://${INDEX}#/`, parent: unknown = null) => ({
    sender: { id },
    senderFrame: { url, parent },
  });
  const call = (channel: string, ...args: unknown[]) => {
    const l = listeners.get(channel);
    if (!l) throw new Error(`未注册的通道 ${channel}`);
    return Promise.resolve().then(() => l(eventFrom(MAIN_ID), ...args));
  };
  const callAs = (event: unknown, channel: string, ...args: unknown[]) =>
    Promise.resolve().then(() => listeners.get(channel)!(event, ...args));
  return { listeners, call, callAs, eventFrom };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.db.getSetting.mockImplementation(() => undefined);
});

describe("发送方校验", () => {
  it("未登记窗口、桌宠窗口、子 frame、外部页面调用主窗口通道一律拒绝，且不执行处理函数", async () => {
    const { callAs, eventFrom } = setup();
    const cases = [
      eventFrom(99),
      eventFrom(PET_ID, `file://${INDEX}#/pet`),
      eventFrom(MAIN_ID, `file://${INDEX}#/`, { url: "about:blank" }),
      eventFrom(MAIN_ID, "https://evil.example/#/"),
      { sender: { id: MAIN_ID }, senderFrame: null },
    ];
    for (const ev of cases) {
      await expect(callAs(ev, "services:delete", "svc-1")).rejects.toThrow(REJECT_MESSAGE);
    }
    expect(h.db.deleteServiceRow).not.toHaveBeenCalled();
    // 每次拒绝都留了日志，带上通道名
    expect(h.logger.logWarn).toHaveBeenCalledTimes(cases.length);
    expect(h.logger.logWarn.mock.calls[0]).toEqual([
      "ipc",
      expect.stringContaining("services:delete"),
    ]);
  });

  it("桌宠窗口可以上报前端异常（MAIN_AND_PET），主窗口同样可以", async () => {
    const { callAs, eventFrom } = setup();
    await expect(
      callAs(eventFrom(PET_ID, `file://${INDEX}#/pet`), "logs:report-renderer-error", "boom"),
    ).resolves.toBe(true);
    await expect(callAs(eventFrom(MAIN_ID), "logs:report-renderer-error", "boom2")).resolves.toBe(
      true,
    );
    expect(h.logger.write).toHaveBeenCalledWith("error", "renderer", "boom");
  });
});

describe("services:*", () => {
  it("update / delete / refresh 拒绝非法 id，不触碰存储", async () => {
    const { call } = setup();
    for (const bad of [undefined, "", 42, "x".repeat(500), { id: "a" }]) {
      await expect(call("services:delete", bad)).rejects.toThrow("无效的服务 id");
      await expect(call("services:refresh", bad)).rejects.toThrow("无效的服务 id");
      await expect(call("services:update", bad, { name: "n" })).rejects.toThrow("无效的服务 id");
    }
    expect(h.db.deleteServiceRow).not.toHaveBeenCalled();
    expect(h.refreshService).not.toHaveBeenCalled();
  });

  it("delete 成功返回 true", async () => {
    const { call } = setup();
    await expect(call("services:delete", "svc-1")).resolves.toBe(true);
    expect(h.db.deleteServiceRow).toHaveBeenCalledWith("svc-1");
  });

  it("refresh 成功时原样返回调度层结果", async () => {
    const { call } = setup();
    const bal = { serviceId: "svc-1", remaining: 3 };
    h.refreshService.mockResolvedValueOnce(bal);
    await expect(call("services:refresh", "svc-1")).resolves.toBe(bal);
    expect(h.refreshService).toHaveBeenCalledWith("svc-1");
  });

  it("refresh 失败时把上游错误换成给用户看的短句，不泄露原始响应", async () => {
    const { call } = setup();
    h.refreshService.mockRejectedValueOnce(new Error('HTTP 401 {"error":"invalid key sk-xxx"}'));
    const err = await call("services:refresh", "svc-1").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/sk-xxx|\{/);
    h.refreshService.mockRejectedValueOnce(new Error("缺少凭证，请到管理页补全"));
    await expect(call("services:refresh", "svc-1")).rejects.toThrow(/凭证/);
  });
});

describe("settings:set", () => {
  it("白名单外的 key、非字符串值直接拒绝", async () => {
    const { call } = setup();
    await expect(call("settings:set", "apiKey", "x")).rejects.toThrow("不允许的设置项");
    await expect(call("settings:set", "__proto__", "x")).rejects.toThrow("不允许的设置项");
    await expect(call("settings:set", "proxyMode", 1)).rejects.toThrow("设置值需为字符串");
    expect(h.db.setSetting).not.toHaveBeenCalled();
  });

  it("refreshInterval：非负数字才保存，保存后按新间隔重启定时器", async () => {
    const { call } = setup();
    await expect(call("settings:set", "refreshInterval", "-1")).rejects.toThrow("非负数字");
    await expect(call("settings:set", "refreshInterval", "abc")).rejects.toThrow("非负数字");
    expect(h.restartScheduler).not.toHaveBeenCalled();
    await expect(call("settings:set", "refreshInterval", "15")).resolves.toBe(true);
    expect(h.db.setSetting).toHaveBeenCalledWith("refreshInterval", "15");
    expect(h.restartScheduler).toHaveBeenCalledWith(15);
  });

  it("monthlyBudgetUsd：留空表示不限，非正数拒绝", async () => {
    const { call } = setup();
    await expect(call("settings:set", "monthlyBudgetUsd", "-5")).rejects.toThrow("正数");
    await expect(call("settings:set", "monthlyBudgetUsd", "abc")).rejects.toThrow("正数");
    await call("settings:set", "monthlyBudgetUsd", "  ");
    expect(h.db.setSetting).toHaveBeenLastCalledWith("monthlyBudgetUsd", "");
    await call("settings:set", "monthlyBudgetUsd", "20");
    expect(h.db.setSetting).toHaveBeenLastCalledWith("monthlyBudgetUsd", "20");
  });

  it("ID 列表类设置先清洗（去重、去空、丢非字符串）再保存", async () => {
    const { call } = setup();
    await call("settings:set", "pinnedServiceIds", JSON.stringify(["a", "a", " ", 3, "b"]));
    expect(h.db.setSetting).toHaveBeenLastCalledWith("pinnedServiceIds", '["a","b"]');
    await call("settings:set", "disabledLocalSources", "not json");
    expect(h.db.setSetting).toHaveBeenLastCalledWith("disabledLocalSources", "[]");
  });

  it("代理相关设置会重新应用会话代理；超时设置会丢掉缓存的连接池", async () => {
    const { call } = setup();
    await call("settings:set", "proxyMode", "direct");
    await call("settings:set", "proxyCustomUrl", "http://127.0.0.1:7890");
    await call("settings:set", "proxyBypassRules", "*.cn");
    expect(h.http.applySessionProxy).toHaveBeenCalledTimes(3);
    expect(h.http.clearProxyAgentCache).not.toHaveBeenCalled();
    await call("settings:set", "requestTimeout", "60");
    expect(h.http.clearProxyAgentCache).toHaveBeenCalledTimes(1);
    expect(h.db.setSetting).toHaveBeenLastCalledWith("requestTimeout", "60");
  });

  it("settings:get 校验 key 格式", async () => {
    const { call } = setup();
    h.db.getSetting.mockImplementation(() => "5");
    await expect(call("settings:get", "refreshInterval")).resolves.toBe("5");
    await expect(call("settings:get", "../etc")).rejects.toThrow("无效的设置项");
    await expect(call("settings:get", 1)).rejects.toThrow("无效的设置项");
  });
});

describe("查询类通道的参数校验", () => {
  it("snapshots / usage / local-daily 的时间参数必须可解析", async () => {
    const { call } = setup();
    await call("snapshots:list", "svc-1", "2026-10-01");
    expect(h.db.listBalanceSnapshots).toHaveBeenCalledWith("svc-1", "2026-10-01");
    await call("usage:list", null, undefined);
    expect(h.db.listUsageRecords).toHaveBeenCalledWith(undefined, undefined);
    await expect(call("local-daily:list", "yesterday")).rejects.toThrow("无效的时间");
    await expect(call("usage:list", "svc-1", 123)).rejects.toThrow("无效的时间");
  });

  it("usage:refresh 校验 id 与周期后才发请求", async () => {
    const { call } = setup();
    await expect(call("usage:refresh", "svc-1", { start: "x", end: "y" })).rejects.toThrow();
    await expect(call("usage:refresh", "svc-1", null)).rejects.toThrow("无效的查询周期");
    expect(h.refreshUsageInternal).not.toHaveBeenCalled();
    const period = { start: "2026-10-01T00:00:00.000Z", end: "2026-10-08T00:00:00.000Z" };
    await call("usage:refresh", "svc-1", period);
    expect(h.refreshUsageInternal).toHaveBeenCalledWith("svc-1", period);
  });

  it("proxy:test 只取认识的三个字段", async () => {
    const { call } = setup();
    await call("proxy:test", { mode: "custom", customUrl: "http://p:1", evil: "x" });
    const arg = (h.http.testNetworkConnectivity.mock.calls[0] as unknown[])[0];
    expect(arg).not.toHaveProperty("evil");
    expect(arg).toMatchObject({ mode: "custom", customUrl: "http://p:1" });
  });
});

describe("app:bootstrap", () => {
  it("设置缺失时给出默认值", async () => {
    const { call } = setup();
    const boot = (await call("app:bootstrap")) as {
      settings: Record<string, string>;
      petEnabled: boolean;
    };
    expect(boot.settings).toMatchObject({
      refreshInterval: "5",
      proxyMode: "system",
      proxyCustomUrl: "",
      requestTimeout: "15",
      monthlyBudgetUsd: "",
      pinnedServiceIds: "[]",
      hiddenServiceIds: "[]",
    });
    expect(boot.settings.proxyBypassRules).toContain("*.cn");
    expect(boot.petEnabled).toBe(false);
    // 今天一次、近 14 天以上一次
    expect(h.db.listLocalDailyUsage).toHaveBeenCalledTimes(2);
  });
});

describe("本地用量导入 / 清缓存", () => {
  it("import-rows：非数组和超量直接拒绝，合法行写入、非法行计入 skipped", async () => {
    const { call } = setup();
    await expect(call("local-usage:import-rows", "rows")).rejects.toThrow("无效的导入数据");
    await expect(call("local-usage:import-rows", new Array(50_001).fill({}))).rejects.toThrow(
      "导入行数过多",
    );
    const good = { source: "codex", model: "gpt-5", date: "2026-10-01", inputTokens: 10 };
    const r = await call("local-usage:import-rows", [
      good,
      { source: "unknown-agent", model: "m", date: "2026-10-01" },
      null,
    ]);
    expect(r).toEqual({ imported: 1, skipped: 2 });
    expect(h.db.upsertLocalDailyUsage).toHaveBeenCalledWith([
      expect.objectContaining({ source: "codex", model: "gpt-5", inputTokens: 10 }),
    ]);
  });

  it("clear-cache：依次清内存缓存、清历史桶、重新扫描", async () => {
    const { call } = setup();
    const order: string[] = [];
    h.clearUsageScanCache.mockImplementation(() => void order.push("cache"));
    h.db.clearAllLocalDailyUsage.mockImplementation(() => void order.push("buckets"));
    h.scan.mockImplementationOnce(async () => {
      order.push("scan");
      return { records: [], unavailable: [] };
    });
    await expect(call("local-usage:clear-cache")).resolves.toEqual({ success: true });
    expect(order).toEqual(["cache", "buckets", "scan"]);
  });

  it("clear-cache：任何一步失败都返回错误信息并记日志，不向渲染进程抛异常", async () => {
    const { call } = setup();
    h.scan.mockRejectedValueOnce(new Error("磁盘只读"));
    await expect(call("local-usage:clear-cache")).resolves.toEqual({
      success: false,
      error: "磁盘只读",
    });
    expect(h.logger.logError).toHaveBeenCalledWith("ipc", expect.stringContaining("磁盘只读"));
  });
});

describe("备份", () => {
  it("预览 / 导入：非字符串、过大、不是合法备份都拒绝，且不写入", async () => {
    const { call } = setup();
    for (const ch of ["app:preview-backup", "app:import-backup"]) {
      await expect(call(ch, { a: 1 })).rejects.toThrow("无效的备份内容");
      await expect(call(ch, "x".repeat(20_000_001))).rejects.toThrow("备份文件过大");
      await expect(call(ch, "{not json")).rejects.toThrow();
    }
    expect(h.applyBackupImport).not.toHaveBeenCalled();
  });

  it("backup-json 不含任何凭据字段", async () => {
    const { call } = setup();
    h.db.listServices.mockReturnValueOnce([
      {
        id: "s",
        name: "n",
        provider: "openai",
        kind: "api",
        config: {},
        credentials: { apiKey: "sk-secret" },
      },
    ] as never);
    const json = (await call("app:backup-json")) as string;
    expect(json).not.toContain("sk-secret");
    expect(JSON.parse(json)).toHaveProperty("services");
  });
});

describe("app:save-text", () => {
  it("参数类型不对、内容过大直接拒绝，不弹对话框", async () => {
    const { call } = setup();
    await expect(call("app:save-text", 1, "x")).rejects.toThrow("无效的导出内容");
    await expect(call("app:save-text", "a.csv", null)).rejects.toThrow("无效的导出内容");
    await expect(call("app:save-text", "a.csv", "x".repeat(20_000_001))).rejects.toThrow(
      "导出内容过大",
    );
    expect(h.electron.dialog.showSaveDialog).not.toHaveBeenCalled();
  });

  it("用户取消返回 false，不写文件；默认文件名去掉路径分隔符", async () => {
    const { call } = setup();
    h.electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    await expect(call("app:save-text", "../../etc/passwd.csv", "a,b")).resolves.toBe(false);
    const opts = h.electron.dialog.showSaveDialog.mock.calls[0][0] as { defaultPath: string };
    expect(opts.defaultPath).not.toMatch(/[/\\]/);
    expect(h.writeFile).not.toHaveBeenCalled();
  });

  it("写入成功返回 true；写入失败记日志并给出简短错误", async () => {
    const { call } = setup();
    h.electron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/a.csv" });
    await expect(call("app:save-text", "a.csv", "a,b")).resolves.toBe(true);
    expect(h.writeFile).toHaveBeenCalledWith("/tmp/a.csv", "a,b", "utf8");
    h.writeFile.mockRejectedValueOnce(new Error("EACCES: permission denied"));
    await expect(call("app:save-text", "a.csv", "a,b")).rejects.toThrow("写入文件失败");
    expect(h.logger.logError).toHaveBeenCalledWith("export", expect.any(Error));
  });
});

describe("日志通道", () => {
  it("前端上报的异常限长 4000，非字符串忽略", async () => {
    const { call } = setup();
    await expect(call("logs:report-renderer-error", { x: 1 })).resolves.toBe(false);
    await call("logs:report-renderer-error", "e".repeat(10_000));
    expect((h.logger.write.mock.calls[0] as unknown[])[2]).toHaveLength(4000);
  });

  it("reveal 定位到日志文件本身，clear 清空", async () => {
    const { call } = setup();
    await expect(call("logs:reveal")).resolves.toBe(true);
    expect(h.electron.shell.showItemInFolder).toHaveBeenCalledWith("/logs/token-lens.log");
    await expect(call("logs:clear")).resolves.toBe(true);
    expect(h.logger.clearLogs).toHaveBeenCalled();
  });
});

describe("价格表", () => {
  it("pricing:set 只保存与内置值不同的覆盖项", async () => {
    const { call } = setup();
    const table = (await call("pricing:get")) as { key: string; inputPerM: number }[];
    const first = table[0];
    await call("pricing:set", {
      [first.key]: { inputPerM: first.inputPerM },
      [table[1].key]: { inputPerM: 123 },
    });
    const saved = JSON.parse((h.db.setSetting.mock.calls.at(-1) as unknown[])[1] as string);
    expect(saved).not.toHaveProperty(first.key);
    expect(saved[table[1].key]).toMatchObject({ inputPerM: 123 });
  });

  it("pricing:get 读出存量负价时已清洗，展示内置价", async () => {
    const { call } = setup();
    const table = (await call("pricing:get")) as { key: string; inputPerM: number }[];
    const first = table[0];
    h.db.getSetting.mockImplementation((k: string) =>
      k === "pricingOverrides" ? JSON.stringify({ [first.key]: { inputPerM: -9 } }) : undefined,
    );
    const after = (await call("pricing:get")) as { key: string; inputPerM: number }[];
    expect(after[0]).toMatchObject({ key: first.key, inputPerM: first.inputPerM });
  });

  it("pricing:set 拒绝非对象；字段只保留认识的数值 / 币种", async () => {
    const { call } = setup();
    await expect(call("pricing:set", "x")).rejects.toThrow("无效的价格覆盖");
    expect(h.db.setSetting).not.toHaveBeenCalled();
    await call("pricing:set", { "made-up-model": { inputPerM: "1", evil: 2, outputPerM: 3 } });
    const saved = JSON.parse((h.db.setSetting.mock.calls.at(-1) as unknown[])[1] as string);
    expect(saved).toEqual({ "made-up-model": { outputPerM: 3 } });
  });
});
