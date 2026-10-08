import { describe, expect, it } from "vitest";
import { highRiskNotExecutedMessage } from "./high-risk";

describe("highRiskNotExecutedMessage", () => {
  it("用户取消不算错误：不显示任何提示", () => {
    expect(highRiskNotExecutedMessage({ status: "cancelled" })).toBe("");
  });
  it("已有待确认的操作：提示先处理系统确认框", () => {
    expect(highRiskNotExecutedMessage({ status: "confirm-pending" })).toContain("待确认");
  });
});
