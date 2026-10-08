import { describe, expect, it } from "vitest";
import { monthKey, monthStartKey, toDateKey } from "./date";

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
