import { describe, expect, it } from "vitest";
import { refreshFailureMessage, usageRefreshFailureMessage } from "./refresh-summary";

describe("refreshFailureMessage", () => {
  it("没服务或全成功不提示", () => {
    expect(refreshFailureMessage(0, 0)).toBeNull();
    expect(refreshFailureMessage(3, 0)).toBeNull();
  });

  it("全失败与部分失败文案不同", () => {
    expect(refreshFailureMessage(3, 3)).toBe("全部刷新失败");
    expect(refreshFailureMessage(3, 1)).toBe("1 个服务刷新失败");
  });
});

describe("usageRefreshFailureMessage", () => {
  it("全成功不提示，失败才说用量", () => {
    expect(usageRefreshFailureMessage(2, 0)).toBeNull();
    expect(usageRefreshFailureMessage(2, 2)).toBe("全部用量刷新失败");
    expect(usageRefreshFailureMessage(2, 1)).toBe("1 个服务用量刷新失败");
  });
});
