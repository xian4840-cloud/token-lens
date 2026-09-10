import { describe, expect, it } from "vitest";
import { pivotDailyUsage } from "./local-sources";
import { visibleTokens } from "./format";
import type { LocalDailyUsageRecord, LocalSource } from "@/types";

/**
 * 每日用量的透视（用量页与趋势页共用）。
 *
 * 这两个页面原本各写了一份几乎逐行相同的实现。合成一份之后，
 * 「各分项之和等于合计」这类不变量才有一处可测——它此前不成立：
 * 合计用的是 visibleTokens（含缓存写），而分项只列了缓存读。
 */

function rec(
  partial: Partial<LocalDailyUsageRecord> & { date: string; model: string },
): LocalDailyUsageRecord {
  return {
    id: 0,
    source: "codex" as LocalSource,
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
    scannedAt: "2026-09-10T00:00:00.000Z",
    ...partial,
  };
}

describe("pivotDailyUsage", () => {
  it("各分项之和等于合计（回归）", () => {
    const rows = pivotDailyUsage([
      rec({
        date: "2026-09-01",
        model: "m",
        inputTokens: 1_000,
        outputTokens: 400,
        reasoningTokens: 50,
        cacheReadTokens: 20_000,
        cacheCreationTokens: 300,
      }),
    ]);
    const r = rows[0];
    const parts =
      (r.input ?? 0) +
      (r.output ?? 0) +
      (r.cacheRead ?? 0) +
      (r.cacheCreation ?? 0);
    expect(parts).toBe(r.total);
    // 且合计与单一事实来源 visibleTokens 一致
    expect(r.total).toBe(21_750);
  });

  it("output 含推理、input 不含缓存，分项不重复计", () => {
    const r = pivotDailyUsage([
      rec({
        date: "2026-09-01",
        model: "m",
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 5,
        cacheReadTokens: 7,
        cacheCreationTokens: 3,
      }),
    ])[0];
    expect(r.input).toBe(100);
    expect(r.output).toBe(25);
    expect(r.cacheRead).toBe(7);
    expect(r.cacheCreation).toBe(3);
    expect(r.total).toBe(135);
  });

  it("按日期分组、按来源堆叠", () => {
    const rows = pivotDailyUsage([
      rec({ date: "2026-09-01", model: "a", source: "codex", inputTokens: 10 }),
      rec({ date: "2026-09-01", model: "b", source: "opencode", inputTokens: 20 }),
      rec({ date: "2026-09-02", model: "a", source: "codex", inputTokens: 30 }),
    ]);
    expect(rows.map((r) => r.date)).toEqual(["09-01", "09-02"]);
    expect(rows[0].codex).toBe(10);
    expect(rows[0].opencode).toBe(20);
    expect(rows[0].total).toBe(30);
    expect(rows[1].total).toBe(30);
  });

  it("日期按字典序升序，与后端返回顺序无关", () => {
    const rows = pivotDailyUsage([
      rec({ date: "2026-09-10", model: "m" }),
      rec({ date: "2026-09-02", model: "m" }),
      rec({ date: "2026-09-01", model: "m" }),
    ]);
    expect(rows.map((r) => r.date)).toEqual(["09-01", "09-02", "09-10"]);
  });

  it("模型分项按用量降序，最常用的排前面", () => {
    const rows = pivotDailyUsage([
      rec({ date: "2026-09-01", model: "small", inputTokens: 10 }),
      rec({ date: "2026-09-01", model: "big", inputTokens: 1_000 }),
      rec({ date: "2026-09-01", model: "mid", inputTokens: 100 }),
    ]);
    expect(rows[0].models?.codex.map((m) => m.model)).toEqual([
      "big",
      "mid",
      "small",
    ]);
  });

  it("同来源同模型跨记录累加到一条分项", () => {
    const rows = pivotDailyUsage([
      rec({ date: "2026-09-01", model: "m", inputTokens: 10 }),
      rec({ date: "2026-09-01", model: "m", inputTokens: 5 }),
    ]);
    expect(rows[0].models?.codex).toEqual([{ model: "m", tokens: 15 }]);
  });

  it("metric=cost 时只填金额列，不填 token 分项", () => {
    const rows = pivotDailyUsage(
      [
        rec({ date: "2026-09-01", model: "m", inputTokens: 100, cost: 1.5 }),
        rec({ date: "2026-09-01", model: "m", inputTokens: 200, cost: 2.5 }),
      ],
      "cost",
    );
    expect(rows[0].codex).toBe(4);
    // 金额行里混入 token 维度的量没有意义
    expect(rows[0].input).toBeUndefined();
    expect(rows[0].total).toBeUndefined();
    // models 恒为对象（收尾 map 无条件设置），但金额模式下没有分项可列
    expect(rows[0].models?.codex).toBeUndefined();
  });

  it("cost 为 null（价格表匹配不到）按 0 计，不产生 NaN", () => {
    const rows = pivotDailyUsage(
      [rec({ date: "2026-09-01", model: "unknown", cost: null })],
      "cost",
    );
    expect(rows[0].codex).toBe(0);
    expect(Number.isFinite(rows[0].codex as number)).toBe(true);
  });

  it("空输入返回空数组", () => {
    expect(pivotDailyUsage([])).toEqual([]);
  });

  it("每条记录的合计与 visibleTokens 逐一吻合", () => {
    const records = [
      rec({ date: "2026-09-01", model: "a", inputTokens: 11, cacheReadTokens: 22 }),
      rec({ date: "2026-09-01", model: "b", outputTokens: 33, reasoningTokens: 44 }),
      rec({ date: "2026-09-02", model: "c", cacheCreationTokens: 55 }),
    ];
    const rows = pivotDailyUsage(records);
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const expectByDay = new Map<string, number>();
    for (const r of records) {
      const key = r.date.slice(5);
      expectByDay.set(key, (expectByDay.get(key) ?? 0) + visibleTokens(r));
    }
    for (const [date, sum] of expectByDay) {
      expect(byDate.get(date)?.total).toBe(sum);
    }
  });
});
