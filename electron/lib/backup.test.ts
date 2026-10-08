import { describe, expect, it } from "vitest";
import {
  backupPreviewStats,
  buildBackupPayload,
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
