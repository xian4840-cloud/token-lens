import { describe, expect, it } from "vitest";
import { normalizeIntervalMinutes } from "./scheduler";

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
