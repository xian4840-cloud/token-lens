import { describe, expect, it } from "vitest";
import {
  backupPreviewStats,
  buildBackupPayload,
  mergeImportedIdList,
  parseBackupJson,
  saveDialogFilters,
  toLocalUsageRows,
} from "./backup";

describe("buildBackupPayload", () => {
  it("服务只带清单字段，丢掉 config（里面可能有非密但也不该外流的端点）", () => {
    const out = buildBackupPayload({
      services: [
        {
          id: "1",
          name: "ds",
          provider: "deepseek",
          kind: "api",
          createdAt: "2026-01-01",
          config: { apiBase: "http://evil" },
        },
      ],
      usageRecords: [{ model: "m" }],
      localDailyUsage: [{ date: "2026-09-01" }],
      settings: {
        refreshInterval: "15",
        proxyCustomUrl: "http://user:pass@proxy",
        monthlyBudgetUsd: "50",
      },
      exportedAt: "2026-09-12T00:00:00.000Z",
    });
    expect(out.app).toBe("token-lens");
    expect(out.version).toBe(1);
    expect(out.services[0]).toEqual({
      id: "1",
      name: "ds",
      provider: "deepseek",
      kind: "api",
      createdAt: "2026-01-01",
    });
    expect(JSON.stringify(out)).not.toContain("proxy");
    expect(JSON.stringify(out)).not.toContain("user:pass");
    expect(JSON.stringify(out)).not.toContain("evil");
    expect(out.settings.monthlyBudgetUsd).toBe("50");
    expect(out.settings.refreshInterval).toBe("15");
  });
});

describe("parseBackupJson", () => {
  it("拒绝含密钥或代理的文件", () => {
    expect(parseBackupJson('{"secrets":{}}').ok).toBe(false);
    const withProxy = JSON.stringify({
      app: "token-lens",
      version: 1,
      usageRecords: [],
      localDailyUsage: [],
      settings: { proxyCustomUrl: "http://127.0.0.1:7890" },
    });
    const r = parseBackupJson(withProxy);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/代理/);
  });

  it("接受我们自己导出的形状", () => {
    const raw = JSON.stringify(
      buildBackupPayload({
        services: [
          {
            id: "1",
            name: "n",
            provider: "deepseek",
            kind: "api",
            createdAt: "t",
          },
        ],
        usageRecords: [],
        localDailyUsage: [],
        settings: {},
        exportedAt: "t",
      }),
    );
    const r = parseBackupJson(raw);
    expect(r.ok).toBe(true);
  });
});

describe("toLocalUsageRows", () => {
  it("丢掉不认识的来源和缺字段的行", () => {
    expect(
      toLocalUsageRows([
        { source: "codex", model: "m", date: "2026-09-01", inputTokens: 10 },
        { source: "not-a-source", model: "m", date: "2026-09-01", inputTokens: 99 },
        { foo: 1 },
      ]),
    ).toEqual([
      expect.objectContaining({
        source: "codex",
        model: "m",
        date: "2026-09-01",
        inputTokens: 10,
      }),
    ]);
  });
});

describe("backupPreviewStats", () => {
  it("本地条数按可导入行算，不认识的来源不计", () => {
    const parsed = parseBackupJson(
      JSON.stringify(
        buildBackupPayload({
          services: [],
          usageRecords: [{ model: "a" }, { model: "b" }],
          localDailyUsage: [
            { source: "codex", model: "m", date: "2026-09-01", inputTokens: 1 },
            { source: "not-a-source", model: "m", date: "2026-09-01", inputTokens: 9 },
          ],
          settings: {},
          exportedAt: "2026-09-12T10:00:00.000Z",
        }),
      ),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(backupPreviewStats(parsed.payload)).toEqual({
      local: 1,
      usage: 2,
      services: 0,
      exportedAt: "2026-09-12T10:00:00.000Z",
    });
  });
});

describe("saveDialogFilters", () => {
  it("按扩展名给保存对话框过滤器", () => {
    expect(saveDialogFilters("a.json")[0]?.extensions).toEqual(["json"]);
    expect(saveDialogFilters("a.csv")[0]?.extensions).toEqual(["csv"]);
    expect(saveDialogFilters("a.txt")[0]?.extensions).toEqual(["txt"]);
  });
});

describe("parseBackupJson：旧格式与残缺文件", () => {
  const base = { app: "token-lens", version: 1 };

  it("没有 services / hiddenServiceIds 的旧备份照常接受", () => {
    const r = parseBackupJson(
      JSON.stringify({
        ...base,
        exportedAt: "2026-09-12T00:00:00.000Z",
        usageRecords: [{ serviceId: "a" }],
        localDailyUsage: [],
        settings: { pinnedServiceIds: "[]" },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.services).toEqual([]);
    expect(r.payload.settings.hiddenServiceIds).toBe("[]");
  });

  it("只缺某一类数据时按空处理", () => {
    const r = parseBackupJson(JSON.stringify({ ...base, usageRecords: [] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.localDailyUsage).toEqual([]);
  });

  it("三类数据都没有：明确报缺少用量数据", () => {
    const r = parseBackupJson(JSON.stringify(base));
    expect(r).toEqual({ ok: false, error: "缺少用量数据" });
  });

  it("字段存在但不是数组：说清是哪个字段", () => {
    for (const key of ["usageRecords", "localDailyUsage", "services"]) {
      const r = parseBackupJson(
        JSON.stringify({ ...base, usageRecords: [], localDailyUsage: [], [key]: "oops" }),
      );
      expect(r).toEqual({ ok: false, error: `备份格式无效：${key} 不是数组` });
    }
  });

  it("截断的 JSON、顶层数组、非对象、未知版本都给出明确错误", () => {
    const full = JSON.stringify({ ...base, usageRecords: [], localDailyUsage: [] });
    expect(parseBackupJson(full.slice(0, full.length - 5))).toEqual({
      ok: false,
      error: "不是合法 JSON",
    });
    expect(parseBackupJson("[]")).toEqual({ ok: false, error: "备份格式无效" });
    expect(parseBackupJson("123")).toEqual({ ok: false, error: "备份格式无效" });
    expect(parseBackupJson("null")).toEqual({ ok: false, error: "备份格式无效" });
    expect(parseBackupJson(JSON.stringify({ ...base, version: 2, usageRecords: [] }))).toEqual({
      ok: false,
      error: "不支持的备份版本（2）",
    });
    expect(parseBackupJson(JSON.stringify({ app: "other", version: 1 })).ok).toBe(false);
  });

  it("服务条目逐条清洗：缺 id/name/provider 的丢弃，缺 kind/createdAt 的补空串", () => {
    const r = parseBackupJson(
      JSON.stringify({
        ...base,
        usageRecords: [],
        services: [
          { id: "a", name: "A", provider: "deepseek" },
          { id: "", name: "B", provider: "deepseek" },
          { id: "c", provider: "deepseek" },
          { id: "d", name: "D" },
          null,
          "x",
        ],
        settings: "not-an-object",
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.services).toEqual([
      { id: "a", name: "A", provider: "deepseek", kind: "", createdAt: "" },
    ]);
    expect(r.payload.settings.refreshInterval).toBe("5");
  });
});

describe("mergeImportedIdList", () => {
  it("本机原有的保留在前，备份里的经映射追加，去重且只留存在的服务", () => {
    const idMap = new Map([["old-a", "new-a"]]);
    const existing = new Set(["mine", "new-a", "b"]);
    expect(
      mergeImportedIdList(["mine", "gone"], ["old-a", "b", "mine", "ghost"], idMap, existing),
    ).toEqual(["mine", "new-a", "b"]);
  });
});
