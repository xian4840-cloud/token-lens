import { describe, expect, it } from "vitest";
import {
  measureLimit,
  parseQuotaLimits,
  planLevelLabel,
} from "./zhipu_plan";
import type { ZhipuEnvelope } from "./zhipu-common";

/**
 * 智谱 GLM Coding Plan 的配额解析。
 *
 * 这个适配器此前一个测试都没有，而它的核心是三个纯函数——不需要网络 mock，
 * 也就没有理由不测。窗口识别错了的后果不是报错，是卡片上多一行或少一行、
 * 或者把「每周」写成「5小时」，全靠肉眼发现。
 */

function envelope(limits: unknown[], data: Record<string, unknown> = {}): ZhipuEnvelope {
  return { code: 200, data: { ...data, limits } };
}

describe("measureLimit", () => {
  it("有总量与当前值时给出绝对值", () => {
    expect(
      measureLimit({ type: "TOKENS_LIMIT", usage: 100, currentValue: 30 }),
    ).toEqual({ used: 30, total: 100, remaining: 70, unit: "tokens" });
  });

  it("有总量与剩余值时反推已用", () => {
    expect(measureLimit({ usage: 500, remaining: 200 })).toEqual({
      used: 300,
      total: 500,
      remaining: 200,
      unit: "tokens",
    });
  });

  it("只有百分比时退回 100 分制", () => {
    expect(measureLimit({ percentage: 42 })).toEqual({
      used: 42,
      total: 100,
      remaining: 58,
      unit: "%",
    });
  });

  it("百分比超界会被夹到 0~100", () => {
    // 脏数据宁可夹紧，也不能把 >100% 写进进度条宽度
    expect(measureLimit({ percentage: 137 })?.used).toBe(100);
    expect(measureLimit({ percentage: 137 })?.remaining).toBe(0);
    expect(measureLimit({ percentage: -5 })?.used).toBe(0);
    expect(measureLimit({ percentage: -5 })?.remaining).toBe(100);
  });

  it("MCP / 工具类窗口的单位是「次」而不是 tokens", () => {
    expect(
      measureLimit({ type: "TIME_LIMIT", usage: 200, currentValue: 50 }),
    ).toEqual({ used: 50, total: 200, remaining: 150, unit: "次" });
  });

  it("没有任何可用数字时返回 undefined（而不是编一个 0）", () => {
    // 返回 0 会让卡片显示「剩余 0」——凭空断言用户额度用尽了
    expect(measureLimit({})).toBeUndefined();
    expect(measureLimit({ usage: 0, currentValue: 0 })).toBeUndefined();
    expect(measureLimit({ usage: 100 })).toBeUndefined();
    expect(measureLimit({ percentage: Number.NaN })).toBeUndefined();
  });

  it("绝对值优先于百分比", () => {
    expect(measureLimit({ usage: 100, currentValue: 30, percentage: 99 })?.total).toBe(
      100,
    );
  });
});

describe("parseQuotaLimits", () => {
  const threeWindows = envelope(
    [
      { type: "TOKENS_LIMIT", unit: 3, number: 5, usage: 100, currentValue: 30 },
      { type: "TOKENS_LIMIT", unit: 6, number: 7, usage: 1000, currentValue: 100 },
      { type: "TIME_LIMIT", usage: 200, currentValue: 50 },
    ],
    { planName: "pro" },
  );

  it("拆出 5 小时 / 每周 / MCP 三类窗口", () => {
    const { windows } = parseQuotaLimits(threeWindows);
    expect(windows.map((w) => w.label)).toEqual(["5小时", "每周", "MCP / 工具"]);
    expect(windows.map((w) => w.kind)).toEqual(["tokens", "tokens", "mcp"]);
  });

  it("token 窗口按时间窗从短到长排列", () => {
    // 排序决定了 breakdown 的第一条，而总览页把第一条当卡片主数字
    const { windows } = parseQuotaLimits(threeWindows);
    expect(windows[0].durationMin).toBe(300);
    expect(windows[1].durationMin).toBe(10_080);
  });

  it("同一标签只保留时间窗更短的那个", () => {
    // 两个都是「5小时」窗口时留短的，避免明细里出现两行同名项
    const { windows } = parseQuotaLimits(
      envelope([
        { type: "TOKENS_LIMIT", unit: 3, number: 5, usage: 100, currentValue: 1 },
        { type: "TOKENS_LIMIT", unit: 3, number: 6, usage: 100, currentValue: 2 },
      ]),
    );
    expect(windows).toHaveLength(1);
    expect(windows[0].durationMin).toBe(300);
  });

  it("取不到数字的窗口被跳过，不占位", () => {
    const { windows } = parseQuotaLimits(
      envelope([{ type: "TOKENS_LIMIT", unit: 3, number: 5 }]),
    );
    expect(windows).toEqual([]);
  });

  it("limits 缺失或结构不符时返回空，不抛异常", () => {
    expect(parseQuotaLimits({ code: 200, data: {} }).windows).toEqual([]);
    expect(parseQuotaLimits({ code: 200, data: [] }).windows).toEqual([]);
    expect(parseQuotaLimits({ code: 200 }).windows).toEqual([]);
    expect(parseQuotaLimits({ code: 200, data: { limits: "oops" } }).windows).toEqual(
      [],
    );
  });

  it("重置时间兼容秒级与毫秒级时间戳", () => {
    const sec = parseQuotaLimits(
      envelope([{ usage: 10, currentValue: 1, nextResetTime: 1_800_000_000 }]),
    );
    const ms = parseQuotaLimits(
      envelope([{ usage: 10, currentValue: 1, nextResetTime: 1_800_000_000_000 }]),
    );
    expect(sec.windows[0].resetAt).toBe(ms.windows[0].resetAt);
    expect(sec.windows[0].resetAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("非法重置时间不产生 Invalid Date", () => {
    for (const bad of [0, -1, Number.NaN]) {
      const { windows } = parseQuotaLimits(
        envelope([{ usage: 10, currentValue: 1, nextResetTime: bad }]),
      );
      expect(windows[0].resetAt).toBeUndefined();
    }
  });
});

describe("planLevelLabel", () => {
  it("认识常见的套餐名并翻成中文标签", () => {
    expect(planLevelLabel({ planName: "pro" })).toBe("Pro");
    expect(planLevelLabel({ planName: "TEAM" })).toBe("团队版");
    expect(planLevelLabel({ plan_type: "max" })).toBe("Max");
  });

  it("不认识的取值原样返回，不臆断成某一档", () => {
    expect(planLevelLabel({ planName: "某个新套餐" })).toBe("某个新套餐");
  });

  it("没有可用字段时返回 undefined", () => {
    expect(planLevelLabel(undefined)).toBeUndefined();
    expect(planLevelLabel({})).toBeUndefined();
    expect(planLevelLabel({ planName: "   " })).toBeUndefined();
  });
});
