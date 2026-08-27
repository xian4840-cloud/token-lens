import { describe, expect, it } from "vitest";
import { computeCost } from "./pricing";
import { DEFAULT_PRICING } from "./pricing-table";

/**
 * 价格表的风险不在数值本身（数值照官网抄，抄错只能靠核对发现），
 * 而在**正则顺序**：宽的规则排在具体规则前面，会静默把整个系列吃掉，
 * 界面上照样显示一个金额，只是错的。这类 bug 没有任何报错。
 *
 * 所以这里只测两件事：
 * 1. 每个模型名匹配到的是**预期那一行**（锁死顺序）。
 * 2. 表本身的结构约束（key 唯一、币种统一、价格非负）。
 */

/** 找出模型名实际命中的行 key，与 computeCost 的分派逻辑一致 */
function matchKey(model: string): string | undefined {
  return DEFAULT_PRICING.find((r) => r.match.test(model))?.key;
}

describe("价格表结构约束", () => {
  it("key 不重复（重复会让设置页覆盖写错行）", () => {
    const keys = DEFAULT_PRICING.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("币种全部是 USD", () => {
    // 趋势页把各行 cost 直接相加，混入 CNY 会把 ¥ 和 $ 加在一起
    const others = DEFAULT_PRICING.filter((r) => r.currency !== "USD");
    expect(others.map((r) => r.key)).toEqual([]);
  });

  it("价格非负，且输出价不低于输入价", () => {
    for (const r of DEFAULT_PRICING) {
      expect(r.inputPerM, r.key).toBeGreaterThanOrEqual(0);
      expect(r.outputPerM, r.key).toBeGreaterThanOrEqual(0);
      expect(r.cacheReadPerM, r.key).toBeGreaterThanOrEqual(0);
      expect(r.cacheWritePerM, r.key).toBeGreaterThanOrEqual(0);
      // 各家输出价一律不低于输入价；反了说明两列填颠倒了
      expect(r.outputPerM, r.key).toBeGreaterThanOrEqual(r.inputPerM);
    }
  });

  it("缓存读取价不高于输入价", () => {
    for (const r of DEFAULT_PRICING) {
      expect(r.cacheReadPerM, r.key).toBeLessThanOrEqual(r.inputPerM);
    }
  });
});

describe("Anthropic 正则顺序", () => {
  // 这是修复前真实算错的行：Opus 4.6 被宽松的 /opus-4/ 吃掉，
  // 按 $15/$75 计费，而官方价是 $5/$25，虚报 3 倍
  it("回归：Opus 4.6 不落到 Opus 4 的 $15/$75 上", () => {
    expect(matchKey("claude-opus-4-6-thinking")).toBe("claude-opus-4-5-plus");
  });

  it.each([
    ["claude-opus-4-5", "claude-opus-4-5-plus"],
    ["claude-opus-4-7", "claude-opus-4-5-plus"],
    ["claude-opus-4-8", "claude-opus-4-5-plus"],
    ["claude-opus-4-20250514", "claude-opus-4"],
    ["claude-opus-4-1-20250805", "claude-opus-4"],
    ["claude-opus-5", "claude-opus-5"],
    ["claude-fable-5", "claude-fable-5"],
    ["claude-mythos-5", "claude-fable-5"],
    ["claude-sonnet-5", "claude-sonnet-5"],
    ["claude-sonnet-4-6", "claude-sonnet-4"],
    ["claude-sonnet-4-5-20250929", "claude-sonnet-4"],
    ["claude-haiku-4-5-20251001", "claude-haiku-4-5"],
    ["claude-3-5-sonnet-20241022", "claude-3-5-sonnet"],
    ["claude-3-haiku-20240307", "claude-3-haiku"],
  ])("%s → %s", (model, key) => {
    expect(matchKey(model)).toBe(key);
  });

  it("Opus 4.6 按官方 $5/$25 计费", () => {
    const c = computeCost("claude-opus-4-6-thinking", {
      input: 1_000_000,
      output: 1_000_000,
    });
    expect(c?.cost).toBeCloseTo(30, 6);
  });
});

describe("OpenAI 正则顺序", () => {
  it.each([
    ["gpt-5.6-sol", "gpt-5.6-sol"],
    ["daybreak-blue-latest", "gpt-5.6-sol"],
    ["gpt-5.6-terra", "gpt-5.6-terra"],
    ["gpt-5.6-luna", "gpt-5.6-luna"],
    ["gpt-5.6-cyber", "gpt-5.6-cyber"],
    ["daybreak-red-latest", "gpt-5.6-cyber"],
    ["gpt-5.5-pro", "gpt-5.5-pro"],
    ["gpt-5.5", "gpt-5.5"],
    ["gpt-5.4-mini", "gpt-5.4-mini"],
    ["gpt-5.4-nano", "gpt-5.4-nano"],
    ["gpt-5.4", "gpt-5.4"],
    ["gpt-5.2-pro", "gpt-5.2-pro"],
    ["gpt-5-mini", "gpt-5-mini"],
    ["gpt-5-nano", "gpt-5-nano"],
    ["gpt-5-pro", "gpt-5-pro"],
    ["gpt-5", "gpt-5"],
    ["gpt-5.1", "gpt-5"],
    ["gpt-4.1-mini", "gpt-4.1-mini"],
    ["gpt-4o-mini", "gpt-4o-mini"],
    ["gpt-4o", "gpt-4o"],
    ["o4-mini", "o4-mini"],
    ["o3-pro", "o3-pro"],
  ])("%s → %s", (model, key) => {
    expect(matchKey(model)).toBe(key);
  });

  it("gpt-5.6-sol 不被泛化的 gpt-5 规则吃掉", () => {
    // sol 是 $4/$20，gpt-5 是 $1.25/$10，错配会低估三倍
    expect(matchKey("gpt-5.6-sol")).not.toBe("gpt-5");
  });
});

describe("智谱 GLM 正则顺序", () => {
  it.each([
    ["glm-5.3", "glm-5.3"],
    ["glm-5.2", "glm-5.2"],
    ["glm-5.1", "glm-5.1"],
    ["glm-5-turbo", "glm-5-turbo"],
    ["glm-5v-turbo", "glm-5v-turbo"],
    ["glm-5", "glm-5"],
    ["glm-4.7", "glm-4.7"],
    ["glm-4.7-flash", "glm-4.7-flash"],
    ["glm-4.7-flashx", "glm-4.7-flashx"],
    ["glm-4.6v", "glm-4.6v"],
    ["glm-4.6v-flash", "glm-4.6v-flash"],
    ["glm-4.5-air", "glm-4.5-air"],
    ["glm-4.5-airx", "glm-4.5-airx"],
    ["glm-4.5-x", "glm-4.5-x"],
    ["glm-4.5v", "glm-4.5v"],
    ["glm-4.5-flash", "glm-4.5-flash"],
    ["glm-4.5", "glm-4.5"],
    ["glm-4.6", "glm-4.5"],
  ])("%s → %s", (model, key) => {
    expect(matchKey(model)).toBe(key);
  });

  it("免费款计费为 0", () => {
    const c = computeCost("glm-4.7-flash", {
      input: 1_000_000,
      output: 1_000_000,
    });
    expect(c?.cost).toBe(0);
  });
});

describe("其余厂商正则顺序", () => {
  it.each([
    ["deepseek-v4-flash-free", "deepseek-v4-flash-free"],
    ["deepseek-v4-flash", "deepseek-v4-flash"],
    ["deepseek-v4-flash-vision-exp", "deepseek-v4-flash-vision"],
    ["deepseek-v4-pro", "deepseek-v4-pro"],
    ["kimi-k3", "kimi-k3"],
    ["mimo-v2.5-pro", "mimo-v2.5-pro"],
    ["mimo-v2.5", "mimo-v2.5"],
    ["grok-4.6", "grok-4.6"],
    // Grok Build 本地采集上报的模型 id（~/.grok/sessions 的 modelUsage key）
    ["grok-4.6-build", "grok-4.6"],
    ["grok-4.5", "grok-4.5"],
    ["grok-4.3", "grok-4.3"],
    ["grok-build-0.1", "grok-build"],
    ["gemini-3.7-flash", "gemini-3.7-flash"],
    ["gemini-3.7-flash-high", "gemini-3.7-flash"],
    ["gemini-3.6-flash", "gemini-3.6-flash"],
    ["gemini-3.5-flash", "gemini-3.5-flash"],
    ["gemini-3.5-flash-lite", "gemini-3.5-flash-lite"],
    ["gemini-3.1-pro-preview", "gemini-3.1-pro"],
    ["gemini-3.1-flash-lite", "gemini-3.1-flash-lite"],
    ["gemini-2.5-pro", "gemini-2.5-pro"],
    ["gemini-2.5-flash-lite", "gemini-2.5-flash-lite"],
    ["gemini-2.5-flash", "gemini-2.5-flash"],
  ])("%s → %s", (model, key) => {
    expect(matchKey(model)).toBe(key);
  });

  it("MiMo Pro 不与 DeepSeek Pro 混淆", () => {
    // 两者曾误填同一组价（0.435/0.87 实为 MiMo 的价）
    expect(matchKey("mimo-v2.5-pro")).toBe("mimo-v2.5-pro");
    expect(matchKey("deepseek-v4-pro")).toBe("deepseek-v4-pro");
    const mimo = DEFAULT_PRICING.find((r) => r.key === "mimo-v2.5-pro")!;
    const ds = DEFAULT_PRICING.find((r) => r.key === "deepseek-v4-pro")!;
    expect(mimo.inputPerM).not.toBe(ds.inputPerM);
  });
});

describe("匹配不到的模型", () => {
  it("返回 undefined 而不是 0（界面显示「-」而非「免费」）", () => {
    expect(computeCost("x-preview-f-free", { input: 100 })).toBeUndefined();
    expect(matchKey("some-unknown-model-v9")).toBeUndefined();
  });
});
