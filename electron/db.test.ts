import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAllLocalDailyUsage,
  flushDb,
  initDbAt,
  deleteServiceRow,
  getSecrets,
  getService,
  insertService,
  listBalanceSnapshots,
  listLocalDailyUsage,
  listServices,
  listUsageRecords,
  replaceLocalDailyUsageBySource,
  saveBalanceSnapshot,
  saveUsageRecords,
  setSetting,
  getSetting,
  upsertLocalDailyUsage,
  saveLastBalance,
  getLastBalances,
  importUsageRecords,
  dataStats,
} from "./db";
import { getRecentLogs } from "./lib/logger";
import type { BalanceResult, LocalDailyUsageRecord, ServiceRecord } from "./types";
import type { LocalUsageRow } from "./local-usage/types";

/**
 * db.ts 是全项目最该有测试的模块：用户的全部服务配置、密钥密文与历史数据
 * 都在它手上，而在此之前它一个测试都没有——initDb 依赖 Electron 的
 * app.getPath，等于整个模块在测试里跑不起来。initDbAt 就是为此拆出来的。
 */

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-db-"));
  file = path.join(dir, "token-lens-data.json");
});

afterEach(() => {
  flushDb(); // 清掉防抖定时器，避免悬挂的 timer 拖住测试进程
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeRaw(content: string): void {
  fs.writeFileSync(file, content, "utf8");
}

/** 直接写一份完整存储文件（用于构造历史数据 / 损坏数据） */
function writeStore(partial: Record<string, unknown>): void {
  writeRaw(
    JSON.stringify({
      services: [],
      secrets: {},
      balanceSnapshots: [],
      usageRecords: [],
      localDailyUsage: [],
      settings: {},
      counters: { balanceSnapshot: 0, usageRecord: 0, localDailyUsage: 0 },
      ...partial,
    }),
  );
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function dateKeyDaysAgo(n: number): string {
  return daysAgo(n).slice(0, 10);
}

function service(id: string): ServiceRecord {
  return {
    id,
    name: `svc-${id}`,
    provider: "deepseek",
    kind: "api",
    config: {},
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  };
}

function daily(
  partial: Partial<LocalDailyUsageRecord> & {
    source: LocalDailyUsageRecord["source"];
    date: string;
    model: string;
  },
): LocalDailyUsageRecord {
  return {
    id: 0,
    sessions: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    cost: null,
    currency: null,
    firstAt: null,
    lastAt: null,
    scannedAt: daysAgo(0),
    ...partial,
  };
}

function row(
  source: LocalUsageRow["source"],
  model: string,
  date: string,
  inputTokens = 100,
): LocalUsageRow {
  return {
    source,
    model,
    date,
    sessions: 1,
    inputTokens,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
  };
}

describe("数据文件损坏时的处理", () => {
  it("JSON 解析失败 -> 留档为 .corrupt-*，以空数据启动", () => {
    writeRaw("{ 这不是合法 JSON");
    initDbAt(file);

    expect(listServices()).toEqual([]);
    expect(fs.existsSync(file)).toBe(true); // 已写出新的空存储
    const backups = fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"));
    expect(backups).toHaveLength(1);
    // 留档的是原始内容，用户还能拿它去抢救密钥
    expect(fs.readFileSync(path.join(dir, backups[0]), "utf8")).toBe(
      "{ 这不是合法 JSON",
    );
  });

  it("结构不符（services 不是数组）同样按损坏处理", () => {
    // 缺了 services，首次 listServices 会直接抛异常，表现成「打开即报错」
    writeStore({ services: "oops" });
    initDbAt(file);
    expect(listServices()).toEqual([]);
    expect(fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"))).toHaveLength(1);
  });

  it("文件不存在时直接以空数据启动，不留档", () => {
    initDbAt(file);
    expect(listServices()).toEqual([]);
    expect(fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"))).toHaveLength(0);
  });

  it("文件正常时原样载入，不留档", () => {
    writeStore({ services: [service("a")] });
    initDbAt(file);
    expect(listServices().map((s) => s.id)).toEqual(["a"]);
    expect(fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"))).toHaveLength(0);
  });

  it("旧版文件缺 localDailyUsage / counters 时补默认值", () => {
    writeRaw(JSON.stringify({ services: [service("a")], secrets: {} }));
    initDbAt(file);
    expect(listServices().map((s) => s.id)).toEqual(["a"]);
    expect(listLocalDailyUsage()).toEqual([]);
  });
});

describe("本地用量落盘", () => {
  beforeEach(() => initDbAt(file));

  it("upsert 覆盖同 (来源,模型,日期) 的桶，保留其它桶", () => {
    upsertLocalDailyUsage([row("codex", "m1", "2026-09-01", 100)]);
    upsertLocalDailyUsage([
      row("codex", "m1", "2026-09-01", 999),
      row("codex", "m2", "2026-09-01", 50),
    ]);
    flushDb();

    const all = listLocalDailyUsage();
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.model === "m1")?.inputTokens).toBe(999);
    expect(all.find((r) => r.model === "m2")?.inputTokens).toBe(50);
  });

  it("replaceLocalDailyUsageBySource 只清掉该来源", () => {
    upsertLocalDailyUsage([
      row("codex", "m1", "2026-09-01"),
      row("opencode", "m2", "2026-09-01"),
    ]);
    replaceLocalDailyUsageBySource("codex", [row("codex", "m3", "2026-09-02")]);
    flushDb();

    const all = listLocalDailyUsage();
    expect(all.filter((r) => r.source === "codex").map((r) => r.model)).toEqual(["m3"]);
    expect(all.filter((r) => r.source === "opencode")).toHaveLength(1);
  });

  it("replaceLocalDailyUsageBySource 会删掉新结果里不再出现的旧日期", () => {
    // 这正是「整体替换」相对 upsert 的意义：修好统计口径后，
    // 虚高的历史桶必须能被清掉，只 upsert 是清不掉的
    upsertLocalDailyUsage([
      row("codex", "m1", "2026-08-01"),
      row("codex", "m1", "2026-09-01"),
    ]);
    replaceLocalDailyUsageBySource("codex", [row("codex", "m1", "2026-09-01")]);
    flushDb();

    expect(listLocalDailyUsage().map((r) => r.date)).toEqual(["2026-09-01"]);
  });
});

describe("listLocalDailyUsage 的日期范围", () => {
  beforeEach(() => {
    initDbAt(file);
    upsertLocalDailyUsage([
      row("codex", "m1", "2026-09-01"),
      row("codex", "m1", "2026-09-05"),
      row("codex", "m1", "2026-09-10"),
    ]);
    flushDb();
  });

  it("日期键原样使用，不做时区换算", () => {
    // toDateKey 走 new Date("YYYY-MM-DD")，那是按 UTC 零点解析的，
    // 在 UTC 以西的时区取本地年月日会退回前一天，范围查询会少一天
    expect(listLocalDailyUsage("2026-09-05", "2026-09-05").map((r) => r.date)).toEqual([
      "2026-09-05",
    ]);
    expect(listLocalDailyUsage("2026-09-05", undefined).map((r) => r.date)).toEqual([
      "2026-09-05",
      "2026-09-10",
    ]);
    expect(listLocalDailyUsage(undefined, "2026-09-05").map((r) => r.date)).toEqual([
      "2026-09-01",
      "2026-09-05",
    ]);
  });

  it("不传范围时返回全部", () => {
    expect(listLocalDailyUsage()).toHaveLength(3);
  });
});

describe("用量记录", () => {
  beforeEach(() => initDbAt(file));

  it("同服务同周期重写而不是累加", () => {
    const period = "2026-09-01|2026-09-30";
    saveUsageRecords("s1", [{ model: "m", totalTokens: 100 }], period);
    saveUsageRecords("s1", [{ model: "m", totalTokens: 250 }], period);
    flushDb();

    const all = listUsageRecords("s1");
    expect(all).toHaveLength(1);
    expect(all[0].totalTokens).toBe(250);
  });

  it("不同周期的记录并存", () => {
    saveUsageRecords("s1", [{ model: "m", totalTokens: 100 }], "p1");
    saveUsageRecords("s1", [{ model: "m", totalTokens: 200 }], "p2");
    flushDb();
    expect(listUsageRecords("s1")).toHaveLength(2);
  });
});

describe("删除服务", () => {
  it("级联清掉该服务的快照、用量记录与密钥", () => {
    writeStore({
      services: [service("a"), service("b")],
      secrets: { a: { apiKey: "x" }, b: { apiKey: "y" } },
      balanceSnapshots: [
        { id: 1, serviceId: "a", balance: 1, currency: "USD", recordedAt: daysAgo(0) },
        { id: 2, serviceId: "b", balance: 2, currency: "USD", recordedAt: daysAgo(0) },
      ],
      usageRecords: [
        {
          id: 1,
          serviceId: "a",
          model: null,
          normalizedModel: null,
          cost: null,
          promptTokens: null,
          completionTokens: null,
          totalTokens: 1,
          period: "p",
          currency: null,
          recordedAt: daysAgo(0),
        },
      ],
    });
    initDbAt(file);
    deleteServiceRow("a");
    flushDb();

    expect(listServices().map((s) => s.id)).toEqual(["b"]);
    expect(listBalanceSnapshots().map((s) => s.serviceId)).toEqual(["b"]);
    expect(listUsageRecords()).toHaveLength(0);
    // 密钥清掉后重新载入不应再出现
    initDbAt(file);
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      secrets: Record<string, unknown>;
    };
    expect(raw.secrets.a).toBeUndefined();
    expect(raw.secrets.b).toBeDefined();
  });
});

describe("启动时的历史压缩", () => {
  it("7 天前的快照按 (服务,天) 降采样为每天最后一条", () => {
    writeStore({
      services: [service("a")],
      balanceSnapshots: [
        { id: 1, serviceId: "a", balance: 10, currency: "USD", recordedAt: daysAgo(30) },
        {
          id: 2,
          serviceId: "a",
          balance: 20,
          currency: "USD",
          recordedAt: new Date(Date.parse(daysAgo(30)) + 3_600_000).toISOString(),
        },
        { id: 3, serviceId: "a", balance: 30, currency: "USD", recordedAt: daysAgo(1) },
      ],
    });
    initDbAt(file);

    const snaps = listBalanceSnapshots().sort((a, b) => a.id - b.id);
    // 30 天前的两条并成一条（保留较晚的那条），最近的一条原样保留
    expect(snaps).toHaveLength(2);
    expect(snaps[0].balance).toBe(20);
    expect(snaps[1].balance).toBe(30);
  });

  it("超过保留期的用量记录与本地日桶被丢弃", () => {
    writeStore({
      usageRecords: [
        {
          id: 1,
          serviceId: "a",
          model: null,
          normalizedModel: null,
          cost: null,
          promptTokens: null,
          completionTokens: null,
          totalTokens: 1,
          period: "p",
          currency: null,
          recordedAt: daysAgo(400),
        },
        {
          id: 2,
          serviceId: "a",
          model: null,
          normalizedModel: null,
          cost: null,
          promptTokens: null,
          completionTokens: null,
          totalTokens: 2,
          period: "p2",
          currency: null,
          recordedAt: daysAgo(10),
        },
      ],
      localDailyUsage: [
        daily({ source: "codex", model: "m", date: dateKeyDaysAgo(400), id: 1 }),
        daily({ source: "codex", model: "m", date: dateKeyDaysAgo(10), id: 2 }),
      ],
    });
    initDbAt(file);

    expect(listUsageRecords().map((r) => r.id)).toEqual([2]);
    expect(listLocalDailyUsage().map((r) => r.id)).toEqual([2]);
  });
});

describe("设置与落盘", () => {
  beforeEach(() => initDbAt(file));

  it("设置可读回并持久化到文件", () => {
    setSetting("refreshInterval", "15");
    flushDb();
    expect(getSetting("refreshInterval")).toBe("15");

    initDbAt(file);
    expect(getSetting("refreshInterval")).toBe("15");
  });

  it("flushDb 用临时文件 + rename，不留残余 .tmp", () => {
    insertService(service("a"));
    flushDb();
    expect(fs.existsSync(file + ".tmp")).toBe(false);
    expect(listServices()).toHaveLength(1);
  });

  it("防抖未到点时文件尚未更新，flushDb 立即落盘", () => {
    insertService(service("a"));
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { services: unknown[] };
    expect(raw.services).toHaveLength(0); // 仍在防抖窗口内

    flushDb();
    const after = JSON.parse(fs.readFileSync(file, "utf8")) as { services: unknown[] };
    expect(after.services).toHaveLength(1);
  });
});

describe("余额快照的落盘条件", () => {
  beforeEach(() => initDbAt(file));

  it("没有数字的刷新不落盘（趋势页本来就不画这些点）", () => {
    // 仅校验 Key 的适配器（Gemini / Groq / Together）每次刷新都走到这里且恒无数字
    saveBalanceSnapshot("s1", undefined, "USD");
    saveBalanceSnapshot("s1", Number.NaN, "USD");
    saveBalanceSnapshot("s1", Number.POSITIVE_INFINITY, "USD");
    flushDb();

    expect(listBalanceSnapshots()).toHaveLength(0);
  });

  it("0 是合法余额，必须落盘", () => {
    saveBalanceSnapshot("s1", 0, "CNY");
    flushDb();

    const snaps = listBalanceSnapshots();
    expect(snaps).toHaveLength(1);
    expect(snaps[0].balance).toBe(0);
  });

  it("跳过时不消耗计数器，落盘的数字仍然连续", () => {
    saveBalanceSnapshot("s1", undefined, "USD");
    saveBalanceSnapshot("s1", 12.5, "USD");
    flushDb();

    const snaps = listBalanceSnapshots();
    expect(snaps).toHaveLength(1);
    expect(snaps[0].id).toBe(1);
  });
});

describe("clearAllLocalDailyUsage", () => {
  beforeEach(() => initDbAt(file));

  it("清空全部来源的桶", () => {
    upsertLocalDailyUsage([
      row("codex", "m1", "2026-09-01"),
      row("opencode", "m2", "2026-09-01"),
    ]);
    expect(listLocalDailyUsage()).toHaveLength(2);

    clearAllLocalDailyUsage();
    flushDb();
    expect(listLocalDailyUsage()).toEqual([]);
  });

  it("落盘结果也变空（走内存状态而非直接改写文件）", () => {
    // 旧实现直接读改写 token-lens-data.json，绕过 db 的内存状态：
    // 文件被清空了，内存里还是旧的，随后任何一次 persist 都会盖回去
    upsertLocalDailyUsage([row("codex", "m1", "2026-09-01")]);
    clearAllLocalDailyUsage();
    flushDb();

    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      localDailyUsage: unknown[];
    };
    expect(raw.localDailyUsage).toEqual([]);
  });

  it("不影响设置与服务（只清用量桶）", () => {
    insertService(service("a"));
    setSetting("refreshInterval", "15");
    upsertLocalDailyUsage([row("codex", "m1", "2026-09-01")]);

    clearAllLocalDailyUsage();
    flushDb();

    expect(listServices().map((s) => s.id)).toEqual(["a"]);
    expect(getSetting("refreshInterval")).toBe("15");
  });
});

describe("密钥解密失败时留痕", () => {
  it("跳过解不开的字段，并记下是哪个服务的哪个字段（回归）", () => {
    // 密文解不开（换机器、数据损坏、系统加密不可用）时字段会被跳过，
    // 适配器随后抛「缺少 API Key」——而用户明明填过。不留痕的话，
    // 他没有任何线索说明密钥为什么不见了，只会以为是自己没保存或应用坏了。
    writeStore({
      services: [service("svc-1")],
      secrets: { "svc-1": { apiKey: "bm90LWEtcmVhbC1jaXBoZXI=" } },
    });
    initDbAt(file);

    expect(getSecrets("svc-1")).toEqual({});

    const entry = getRecentLogs().find(
      (e) => e.scope === "db" && e.message.includes("解密失败"),
    );
    expect(entry, "解密失败没有留下任何日志").toBeDefined();
    expect(entry?.message).toContain("svc-1");
    expect(entry?.message).toContain("apiKey");
    // 只写字段名，不写密文更不写明文
    expect(entry?.message).not.toContain("bm90LWEtcmVhbC1jaXBoZXI=");
  });

  it("没有密钥记录的服务不产生日志", () => {
    writeStore({ services: [service("svc-2")], secrets: {} });
    initDbAt(file);
    expect(getSecrets("svc-2")).toEqual({});
    expect(
      getRecentLogs().some((e) => e.scope === "db" && e.message.includes("svc-2")),
    ).toBe(false);
  });
});

describe("lastBalance", () => {
  beforeEach(() => initDbAt(file));

  function result(partial: Partial<BalanceResult> = {}): BalanceResult {
    return {
      remaining: 12.5,
      currency: "USD",
      fetchedAt: "2026-09-11T08:00:00.000Z",
      breakdown: [{ label: "月配额", remaining: 12.5, used: 7.5, total: 20 }],
      ...partial,
    };
  }

  it("写入后能读回完整卡片所需字段，不只是一个数字", () => {
    saveLastBalance("s1", result());
    flushDb();
    const all = getLastBalances();
    expect(all.s1?.remaining).toBe(12.5);
    expect(all.s1?.breakdown?.[0]?.label).toBe("月配额");
    expect(all.s1?.fetchedAt).toBe("2026-09-11T08:00:00.000Z");
  });

  it("不把 raw 落盘（那是适配器内部的整段响应，UI 不用）", () => {
    saveLastBalance("s1", result({ raw: { huge: "payload" } }));
    flushDb();
    expect(getLastBalances().s1?.raw).toBeUndefined();
    const disk = JSON.parse(fs.readFileSync(file, "utf8")) as {
      lastBalances: Record<string, { raw?: unknown }>;
    };
    expect(disk.lastBalances.s1.raw).toBeUndefined();
  });

  it("仅校验 Key 的结果（无数字、只有 statusLabel）也要留下", () => {
    saveLastBalance(
      "gemini",
      result({ remaining: undefined, statusLabel: "Key 有效", currency: "USD" }),
    );
    flushDb();
    expect(getLastBalances().gemini?.statusLabel).toBe("Key 有效");
  });

  it("删服务时级联清掉上次余额", () => {
    insertService(service("a"));
    insertService(service("b"));
    saveLastBalance("a", result({ remaining: 1 }));
    saveLastBalance("b", result({ remaining: 2 }));
    deleteServiceRow("a");
    flushDb();
    expect(getLastBalances().a).toBeUndefined();
    expect(getLastBalances().b?.remaining).toBe(2);
  });

  it("旧文件没有 lastBalances 字段时以空对象启动，不抛异常", () => {
    writeStore({ services: [service("a")] });
    initDbAt(file);
    expect(getLastBalances()).toEqual({});
  });

  it("lastBalances 若被写成数组则当成缺失，不在落盘时把余额丢掉", () => {
    writeStore({ services: [service("a")], lastBalances: [] });
    initDbAt(file);
    saveLastBalance("a", result({ remaining: 3 }));
    flushDb();
    const disk = JSON.parse(fs.readFileSync(file, "utf8")) as {
      lastBalances: Record<string, { remaining?: number }>;
    };
    expect(disk.lastBalances.a.remaining).toBe(3);
  });
});

describe("导入与统计", () => {
  beforeEach(() => initDbAt(file));

  it("importUsageRecords 丢掉坏行、没有 serviceId 或本机没有该服务的行，并分配新 id", () => {
    insertService(service("s1"));
    const r = importUsageRecords([
      { serviceId: "s1", model: "m", totalTokens: 10, period: "p" },
      { model: "no-service" },
      null,
      "not-an-object",
      { serviceId: "ghost", model: "m", period: "p" },
      { serviceId: "s1", cost: Number.NaN, totalTokens: 2 },
    ]);
    expect(r).toEqual({ imported: 2, skipped: 4 });
    const rows = listUsageRecords();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).not.toBe(rows[1]?.id);
    expect(rows[1]?.cost).toBeNull();
  });

  it("dataStats 计入服务与文件大小", () => {
    insertService(service("a"));
    flushDb();
    const s = dataStats();
    expect(s.services).toBe(1);
    expect(s.bytes).toBeGreaterThan(0);
  });
});
