import { describe, expect, it } from "vitest";
import { MAX_MONTHLY_BUDGET_USD, parseMonthlyBudgetUsd } from "./budget";

describe("parseMonthlyBudgetUsd", () => {
  it("空值与非法值视为关闭，不把 NaN 当成预算", () => {
    expect(parseMonthlyBudgetUsd(undefined)).toBeNull();
    expect(parseMonthlyBudgetUsd(null)).toBeNull();
    expect(parseMonthlyBudgetUsd("")).toBeNull();
    expect(parseMonthlyBudgetUsd("   ")).toBeNull();
    expect(parseMonthlyBudgetUsd("abc")).toBeNull();
    expect(parseMonthlyBudgetUsd("0")).toBeNull();
    expect(parseMonthlyBudgetUsd("-10")).toBeNull();
    expect(parseMonthlyBudgetUsd("Infinity")).toBeNull();
  });

  it("正数原样返回，两端空白去掉", () => {
    expect(parseMonthlyBudgetUsd("50")).toBe(50);
    expect(parseMonthlyBudgetUsd("  12.5 ")).toBe(12.5);
  });

  it("超过上限夹到上限", () => {
    expect(parseMonthlyBudgetUsd(String(MAX_MONTHLY_BUDGET_USD + 1))).toBe(MAX_MONTHLY_BUDGET_USD);
  });
});
