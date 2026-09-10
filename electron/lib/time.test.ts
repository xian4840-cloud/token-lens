import { describe, expect, it } from "vitest";
import { MAX_DATE_MS, epochToIso, msToIso, secToIso } from "./time";

/**
 * 时间戳换算。
 *
 * 这条路径的错误形态很刺眼：new Date(越界值) 得到 Invalid Date，
 * 紧接着的 toISOString() 抛 RangeError: Invalid time value。而越界值来自外部
 * 数据（接口的时间字段、第三方会话库的整数列），不受我们控制。此前项目里有
 * 5 处各自 new Date(...).toISOString()，只有一处做了上界检查——漏掉的地方
 * 一旦踩中，用户看到的是那句英文报错，连已经解析成功的金额一起丢掉。
 *
 * 所以这里逐档钉住：只返回 ISO 或 undefined，永不抛。
 */

describe("msToIso", () => {
  it("正常毫秒时间戳转 ISO", () => {
    expect(msToIso(1_800_000_000_000)).toBe("2027-01-15T08:00:00.000Z");
    expect(msToIso(1)).toBe("1970-01-01T00:00:00.001Z");
  });

  it("恰好在上界内的值可用，越过上界返回 undefined（回归）", () => {
    // 8.64e15 是 Date 的合法上界；再大一点 new Date() 就是 Invalid Date
    expect(msToIso(MAX_DATE_MS)).toBeDefined();
    expect(msToIso(MAX_DATE_MS + 1)).toBeUndefined();
    expect(msToIso(1e16)).toBeUndefined();
    expect(msToIso(1.7e18)).toBeUndefined();
  });

  it("非正、非有限、空值一律返回 undefined", () => {
    for (const bad of [0, -1, -1e18, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      expect(msToIso(bad), String(bad)).toBeUndefined();
    }
  });

  it("永不抛异常（这正是它存在的理由）", () => {
    const candidates = [1e18, 1e21, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE];
    for (const v of candidates) {
      expect(() => msToIso(v), String(v)).not.toThrow();
      expect(msToIso(v), String(v)).toBeUndefined();
    }
  });
});

describe("secToIso", () => {
  it("秒级时间戳先乘 1000", () => {
    expect(secToIso(1_800_000_000)).toBe(msToIso(1_800_000_000_000));
  });

  it("乘完溢出为 Infinity 时返回 undefined，不抛", () => {
    expect(secToIso(Number.MAX_VALUE)).toBeUndefined();
    expect(secToIso(1e300)).toBeUndefined();
    expect(secToIso(1e15)).toBeUndefined(); // 1e18 ms 已越界
  });

  it("非正与空值返回 undefined", () => {
    for (const bad of [0, -1, null, undefined, Number.NaN]) {
      expect(secToIso(bad), String(bad)).toBeUndefined();
    }
  });
});

describe("epochToIso", () => {
  it("按量级区分秒与毫秒", () => {
    expect(epochToIso(1_800_000_000)).toBe(msToIso(1_800_000_000_000));
    expect(epochToIso(1_800_000_000_000)).toBe(msToIso(1_800_000_000_000));
  });

  it("越界值返回 undefined，不抛（回归）", () => {
    // 纳秒级时间戳：数量级远超 1e12，会被当成毫秒直接越界
    expect(epochToIso(1.7e18)).toBeUndefined();
    expect(epochToIso(1e16)).toBeUndefined();
    expect(() => epochToIso(1e18)).not.toThrow();
  });

  it("空值返回 undefined", () => {
    expect(epochToIso(null)).toBeUndefined();
    expect(epochToIso(undefined)).toBeUndefined();
  });
});
