import { describe, expect, it } from "vitest";
import { isAutoFilledName, nextServiceName } from "@/lib/service-name";

// 用真实的服务定义子集，避免用假数据测出「看着对但实际不成立」的结论
const DEFS = [
  { provider: "bailian", label: "阿里云百炼" },
  { provider: "scnet_token_plan", label: "超算互联网 Token Plan" },
  { provider: "volcengine_plan", label: "火山方舟 Coding Plan" },
  { provider: "deepseek", label: "DeepSeek" },
] as const;

describe("isAutoFilledName", () => {
  it("空白名称视为未定制", () => {
    expect(isAutoFilledName("", DEFS)).toBe(true);
    expect(isAutoFilledName("   ", DEFS)).toBe(true);
  });

  it("等于某个服务类型默认名的视为自动填入", () => {
    expect(isAutoFilledName("阿里云百炼", DEFS)).toBe(true);
    expect(isAutoFilledName("超算互联网 Token Plan", DEFS)).toBe(true);
  });

  it("用户自定义名必须保住", () => {
    expect(isAutoFilledName("工作号", DEFS)).toBe(false);
    expect(isAutoFilledName("小号", DEFS)).toBe(false);
    expect(isAutoFilledName("公司账号", DEFS)).toBe(false);
  });

  it("首尾空格不影响判断", () => {
    expect(isAutoFilledName("  阿里云百炼  ", DEFS)).toBe(true);
    expect(isAutoFilledName("  工作号  ", DEFS)).toBe(false);
  });
});

describe("nextServiceName", () => {
  // 这条就是实际发生过的错误：名称留在「百炼」而服务已切成超算互联网
  it("回归：从百炼切到超算互联网时名称跟着改", () => {
    expect(nextServiceName("阿里云百炼", "scnet_token_plan", DEFS)).toBe(
      "超算互联网 Token Plan",
    );
  });

  it("名称为空时填入新服务类型名", () => {
    expect(nextServiceName("", "deepseek", DEFS)).toBe("DeepSeek");
  });

  it("用户自定义的名称不被覆盖", () => {
    expect(nextServiceName("工作号", "scnet_token_plan", DEFS)).toBe("工作号");
    expect(nextServiceName("小号", "deepseek", DEFS)).toBe("小号");
  });

  it("未知 provider 时返回空串而非 undefined", () => {
    expect(nextServiceName("", "not_exist", DEFS)).toBe("");
  });

  it("切到同一个服务类型时名称不变", () => {
    expect(nextServiceName("DeepSeek", "deepseek", DEFS)).toBe("DeepSeek");
  });
});
