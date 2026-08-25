import { describe, expect, it } from "vitest";
import { pickBalance } from "./siliconflow";

// 这也是 electron/ 目录下的第一个测试文件：
// vitest 若仍继承 vite.config.ts 的 root: "ui"，这些用例会被静默跳过。
describe("pickBalance", () => {
  it("优先取 totalBalance（赠费 + 充值的可用总额）", () => {
    expect(
      pickBalance({
        id: "u1",
        name: "n",
        balance: "0.88",
        chargeBalance: "88.00",
        totalBalance: "88.88",
      }),
    ).toBe(88.88);
  });

  // 回归：早先读 data.balance，充值 ¥88 的账号会显示成 0.88
  it("不会误取只代表赠费的 balance", () => {
    expect(
      pickBalance({
        id: "u1",
        name: "n",
        balance: "0.88",
        chargeBalance: "88.00",
        totalBalance: "88.88",
      }),
    ).not.toBe(0.88);
  });

  it("totalBalance 缺失时用赠费加充值兜底", () => {
    expect(
      pickBalance({ id: "u1", name: "n", balance: "0.88", chargeBalance: "88.00" }),
    ).toBeCloseTo(88.88, 10);
  });

  it("只有一个字段时按该字段计", () => {
    expect(pickBalance({ id: "u1", name: "n", chargeBalance: "12.5" })).toBe(12.5);
    expect(pickBalance({ id: "u1", name: "n", balance: "3" })).toBe(3);
  });

  it("余额为 0 是有效值，不可当作缺失", () => {
    expect(pickBalance({ id: "u1", name: "n", totalBalance: "0" })).toBe(0);
    expect(pickBalance({ id: "u1", name: "n", balance: "0.00" })).toBe(0);
  });

  // 宁可返回 undefined 让卡片显示占位符，也不能把 NaN 交给格式化与进度条
  it("字段全缺或不是数字时返回 undefined", () => {
    expect(pickBalance({ id: "u1", name: "n" })).toBeUndefined();
    expect(pickBalance({ id: "u1", name: "n", totalBalance: "abc" })).toBeUndefined();
    expect(pickBalance(undefined)).toBeUndefined();
  });

  it("totalBalance 非法但另两个字段可用时仍能求和", () => {
    expect(
      pickBalance({
        id: "u1",
        name: "n",
        balance: "1.5",
        chargeBalance: "2.5",
        totalBalance: "null",
      }),
    ).toBe(4);
  });
});
