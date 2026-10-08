import { beforeAll, describe, expect, it } from "vitest";
import { registerAllAdapters } from "./adapters";
import {
  validatePeriod,
  validatePricingOverrides,
  validateServiceInput,
  validateSettingKey,
} from "./validation";

/**
 * IPC 信任边界的输入校验。
 *
 * 渲染进程经 contextBridge 只能调预定义 API，这层是纵深防御：挡住异常或被污染的
 * 数据写进存储、触发越界查询。此前 133 行没有任何测试——校验被放松时，
 * 不会有任何东西报警。
 */

beforeAll(() => {
  // validateServiceInput 靠适配器注册表判断 provider 是否合法
  registerAllAdapters();
});

describe("validateServiceInput", () => {
  it("接受合法输入并去掉名称两端空白", () => {
    const out = validateServiceInput({
      name: "  我的 DeepSeek  ",
      provider: "deepseek",
      fields: { apiKey: "sk-xxx" },
    });
    expect(out.name).toBe("我的 DeepSeek");
    expect(out.provider).toBe("deepseek");
    expect(out.fields.apiKey).toBe("sk-xxx");
  });

  it("拒绝未注册的服务类型", () => {
    expect(() =>
      validateServiceInput({ name: "x", provider: "not-a-provider", fields: {} }),
    ).toThrow(/未知服务类型/);
  });

  it("拒绝空名称与超长名称", () => {
    const base = { provider: "deepseek", fields: { apiKey: "k" } };
    expect(() => validateServiceInput({ ...base, name: "   " })).toThrow(/不能为空/);
    expect(() => validateServiceInput({ ...base, name: "a".repeat(101) })).toThrow(/过长/);
  });

  it("拒绝非对象输入与缺失的字段集合", () => {
    expect(() => validateServiceInput(null)).toThrow(/无效/);
    expect(() => validateServiceInput("x")).toThrow(/无效/);
    expect(() => validateServiceInput({ name: "x", provider: "deepseek" })).toThrow(/缺少字段数据/);
  });

  it("丢弃 schema 之外的字段（防止任意键写进存储）", () => {
    const out = validateServiceInput({
      name: "x",
      provider: "deepseek",
      fields: { apiKey: "k", __proto__hack: "v", extra: "v" },
    });
    expect(Object.keys(out.fields)).toEqual(["apiKey"]);
  });

  it("丢弃非字符串字段值（用可选字段验证，避免混入必填校验）", () => {
    const out = validateServiceInput({
      name: "x",
      provider: "openai",
      fields: { apiKey: "k", orgId: 123 } as unknown as Record<string, string>,
    });
    expect(out.fields.apiKey).toBe("k");
    expect(out.fields.orgId).toBeUndefined();
  });

  it("必填字段的值非字符串时，按缺失处理并报错", () => {
    // 丢弃非字符串值发生在必填校验之前，所以这里抛的是缺字段而不是类型错误。
    // 记下来是为了防止有人把顺序调过来——那会让一个数字型 apiKey 一路写进存储。
    expect(() =>
      validateServiceInput({
        name: "x",
        provider: "deepseek",
        fields: { apiKey: 123 } as unknown as Record<string, string>,
      }),
    ).toThrow(/缺少必填字段/);
  });

  it("必填字段缺失或为空串时报错", () => {
    expect(() => validateServiceInput({ name: "x", provider: "deepseek", fields: {} })).toThrow(
      /缺少必填字段/,
    );
    expect(() =>
      validateServiceInput({ name: "x", provider: "deepseek", fields: { apiKey: "" } }),
    ).toThrow(/缺少必填字段/);
  });
});

describe("validateSettingKey", () => {
  it("放行白名单内的设置项", () => {
    for (const k of [
      "refreshInterval",
      "pricingOverrides",
      "proxyMode",
      "proxyCustomUrl",
      "proxyBypassRules",
      "requestTimeout",
      "monthlyBudgetUsd",
      "pinnedServiceIds",
      "hiddenServiceIds",
      "disabledLocalSources",
    ]) {
      expect(validateSettingKey(k)).toBe(k);
    }
  });

  it("拒绝白名单外的键（防止任意覆盖设置）", () => {
    expect(() => validateSettingKey("petEnabled")).toThrow(/不允许/);
    expect(() => validateSettingKey("__proto__")).toThrow(/不允许/);
    expect(() => validateSettingKey(123)).toThrow(/不允许/);
    expect(() => validateSettingKey(undefined)).toThrow(/不允许/);
  });
});

describe("validatePeriod", () => {
  it("接受合法区间并原样返回", () => {
    const out = validatePeriod({
      start: "2026-09-01T00:00:00Z",
      end: "2026-09-30T00:00:00Z",
    });
    expect(out.start).toBe("2026-09-01T00:00:00Z");
  });

  it("起止需为字符串且是合法日期", () => {
    expect(() => validatePeriod(null)).toThrow(/无效/);
    expect(() => validatePeriod({ start: 1, end: 2 })).toThrow(/字符串/);
    expect(() => validatePeriod({ start: "不是日期", end: "2026-09-30" })).toThrow(/非合法日期/);
  });

  it("拒绝起始晚于结束", () => {
    expect(() => validatePeriod({ start: "2026-09-30", end: "2026-09-01" })).toThrow(/不能晚于/);
  });

  it("拒绝跨度超过 366 天（防止一次拉取过大范围）", () => {
    expect(() => validatePeriod({ start: "2024-01-01", end: "2026-01-01" })).toThrow(/跨度超过/);
    // 恰好 365 天应放行
    expect(() => validatePeriod({ start: "2026-01-01", end: "2027-01-01" })).not.toThrow();
  });
});

describe("validatePricingOverrides", () => {
  it("只保留已知的数值字段与 currency", () => {
    const out = validatePricingOverrides({
      "gpt-5": { inputPerM: 1, outputPerM: 2, currency: "USD", junk: "x" },
    });
    expect(out["gpt-5"]).toEqual({ inputPerM: 1, outputPerM: 2, currency: "USD" });
  });

  it("丢弃非有限数与非字符串币种", () => {
    const out = validatePricingOverrides({
      a: { inputPerM: Number.NaN },
      b: { outputPerM: Number.POSITIVE_INFINITY },
      c: { currency: 42 },
      d: { inputPerM: "1" },
    });
    // 全部字段都被过滤掉，条目本身不应留下空壳
    expect(out).toEqual({});
  });

  it("拒绝非对象输入，跳过非对象条目", () => {
    expect(() => validatePricingOverrides(null)).toThrow(/无效/);
    expect(() => validatePricingOverrides("x")).toThrow(/无效/);
    expect(validatePricingOverrides({ a: null, b: "x", c: 1 })).toEqual({});
  });

  it("0 是合法价格（免费模型）", () => {
    expect(validatePricingOverrides({ a: { inputPerM: 0 } })).toEqual({
      a: { inputPerM: 0 },
    });
  });
});
