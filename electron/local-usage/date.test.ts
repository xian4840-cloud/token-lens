import { describe, expect, it } from "vitest";
import { localHistoryStartKey, monthKey, monthStartKey, toDateKey } from "./date";
import { compareLocalWindows } from "../../ui/src/lib/local-sources";

describe("monthStartKey / monthKey", () => {
  it("从合法日期键取出当月 1 号与 YYYY-MM", () => {
    expect(monthStartKey("2026-09-12")).toBe("2026-09-01");
    expect(monthKey("2026-09-12")).toBe("2026-09");
    expect(monthStartKey("2026-01-01")).toBe("2026-01-01");
  });

  it("非法键返回 undefined，不把垃圾字符串切片当日期", () => {
    expect(monthStartKey(undefined)).toBeUndefined();
    expect(monthStartKey("")).toBeUndefined();
    expect(monthStartKey("2026-9-12")).toBeUndefined();
    expect(monthStartKey("not-a-date")).toBeUndefined();
    expect(monthKey(null)).toBeUndefined();
  });
});

describe("toDateKey", () => {
  it("非法时间返回 undefined", () => {
    expect(toDateKey(undefined)).toBeUndefined();
    expect(toDateKey("不是日期")).toBeUndefined();
    expect(toDateKey(Number.NaN)).toBeUndefined();
  });
});

describe("localHistoryStartKey（bootstrap 下发的本地用量起点）", () => {
  it("月初取今天往前 13 天（跨到上个月），月中以后取当月 1 号", () => {
    expect(localHistoryStartKey("2026-10-03")).toBe("2026-09-20");
    expect(localHistoryStartKey("2026-01-05")).toBe("2025-12-23");
    expect(localHistoryStartKey("2026-10-14")).toBe("2026-10-01");
    expect(localHistoryStartKey("2026-10-20")).toBe("2026-10-01");
  });

  it("非法日期返回 undefined", () => {
    expect(localHistoryStartKey(undefined)).toBeUndefined();
    expect(localHistoryStartKey("bad")).toBeUndefined();
  });

  it("月初用 bootstrap 数据算「近 7 天 vs 前 7 天」，与 14 天全量数据结果一致（回归）", () => {
    const today = "2026-10-03";
    const all = Array.from({ length: 20 }, (_, i) => {
      const date = toDateKey(new Date(2026, 9, 3 - i).getTime())!;
      return {
        source: "codex",
        model: "m",
        date,
        sessions: 1,
        inputTokens: 100,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        scannedAt: "",
      };
    });
    const start = localHistoryStartKey(today)!;
    const boot = all.filter((r) => r.date >= start && r.date <= today);
    const oldBoot = all.filter((r) => r.date >= monthStartKey(today)! && r.date <= today);
    const expected = compareLocalWindows(all as never, today, 7);
    expect(compareLocalWindows(boot as never, today, 7)).toEqual(expected);
    // 旧口径（只给当月）在月初算出来的对比是错的
    expect(compareLocalWindows(oldBoot as never, today, 7)).not.toEqual(expected);
  });
});
