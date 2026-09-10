import { describe, expect, it } from "vitest";
import { pickNumber, toFiniteNumber } from "./amount";

/**
 * 各家余额/用量接口的取数。
 *
 * 此前项目里有四份实现（bailian.parseAmount、zhipu-common.pickNumber、
 * kimi.pickNumber 与若干内联 Number()），边界行为各不相同：只有 zhipu 那份
 * 容忍千分位；deepseek / volcengine 直接 Number()，字段缺失时得到 NaN 并一路
 * 带进界面。合成一份之后这些边界只需定义一次，也就只需在这里钉一次。
 */

describe("toFiniteNumber", () => {
  it("数字原样通过", () => {
    expect(toFiniteNumber(0)).toBe(0);
    expect(toFiniteNumber(12.5)).toBe(12.5);
    expect(toFiniteNumber(-3)).toBe(-3);
  });

  it("拒绝非有限数", () => {
    expect(toFiniteNumber(Number.NaN)).toBeUndefined();
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(toFiniteNumber(Number.NEGATIVE_INFINITY)).toBeUndefined();
  });

  it("数字字符串可解析，含千分位与空白", () => {
    expect(toFiniteNumber("88.88")).toBe(88.88);
    expect(toFiniteNumber("1,234.56")).toBe(1234.56);
    expect(toFiniteNumber("  42  ")).toBe(42);
    expect(toFiniteNumber("1,234,567")).toBe(1234567);
  });

  it("空串与纯空白按「没给值」处理，不是 0", () => {
    // Number("") 是 0。若照搬，接口返回空串就会被显示成 ¥0.00——
    // 那是在替服务商编造一个它没说的数字
    expect(toFiniteNumber("")).toBeUndefined();
    expect(toFiniteNumber("   ")).toBeUndefined();
    expect(toFiniteNumber("\t\n")).toBeUndefined();
  });

  it("非数字字符串与空值返回 undefined", () => {
    expect(toFiniteNumber("abc")).toBeUndefined();
    expect(toFiniteNumber("12abc")).toBeUndefined();
    expect(toFiniteNumber(null)).toBeUndefined();
    expect(toFiniteNumber(undefined)).toBeUndefined();
  });

  it("非 number / string 类型一律拒绝", () => {
    expect(toFiniteNumber(true)).toBeUndefined();
    expect(toFiniteNumber({})).toBeUndefined();
    expect(toFiniteNumber([])).toBeUndefined();
    expect(toFiniteNumber([1])).toBeUndefined();
  });
});

describe("pickNumber", () => {
  it("按 keys 顺序取首个可解析的字段", () => {
    expect(pickNumber({ a: 1, b: 2 }, ["a", "b"])).toBe(1);
    expect(pickNumber({ b: 2 }, ["a", "b"])).toBe(2);
  });

  it("前一个字段存在但不可解析时继续往后找", () => {
    expect(pickNumber({ a: "abc", b: "7" }, ["a", "b"])).toBe(7);
    expect(pickNumber({ a: "", b: 7 }, ["a", "b"])).toBe(7);
    expect(pickNumber({ a: null, b: 7 }, ["a", "b"])).toBe(7);
  });

  it("0 是合法取值，不会被当成缺失跳过", () => {
    expect(pickNumber({ a: 0, b: 9 }, ["a", "b"])).toBe(0);
    expect(pickNumber({ a: "0.00", b: 9 }, ["a", "b"])).toBe(0);
  });

  it("全部取不到返回 undefined", () => {
    expect(pickNumber({ a: "x" }, ["a", "b"])).toBeUndefined();
    expect(pickNumber({}, ["a"])).toBeUndefined();
    expect(pickNumber(undefined, ["a"])).toBeUndefined();
  });
});
