/**
 * 模型定价换算逻辑。价格数据见 ./pricing-table（单独文件维护，方便增删模型）。
 *
 * 仅用于对「已有 token 用量」补算费用（如本地 agent 采集、Anthropic
 * usage_reports 只给 token 不给钱）。OpenAI costs API 等官方直接返回 cost
 * 的服务不经过此处。
 *
 * 用户可在设置页覆盖任意条目（存 setting `pricingOverrides`，按 key 索引），
 * computeCost 会先查覆盖再查默认。
 */

import { DEFAULT_PRICING } from "./pricing-table";

export interface ModelPricing {
  /** 输入 token 单价（/ 1M tokens） */
  inputPerM: number;
  /** 输出 token 单价（/ 1M tokens） */
  outputPerM: number;
  /** 缓存读取（命中）单价（/ 1M tokens） */
  cacheReadPerM?: number;
  /** 缓存写入（创建）单价（/ 1M tokens） */
  cacheWritePerM?: number;
  /** 货币，默认 USD */
  currency?: string;
}

/** 设置页展示用的价格行（无正则，可序列化） */
export interface PricingRowDisplay {
  key: string;
  label: string;
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;
  currency: string;
}

/** 内置价格行：多一个 match 正则用于按模型名分派 */
export interface PricingRow extends PricingRowDisplay {
  match: RegExp;
}

export interface TokenUsage {
  input?: number;
  output?: number;
  cacheCreation?: number;
  cacheRead?: number;
}

/** Anthropic token 明细（兼容旧调用） */
export interface AnthropicTokenBreakdown {
  input?: number;
  output?: number;
  cacheCreation?: number;
  cacheRead?: number;
}

const USD = "USD";

/**
 * 按模型名 + token 明细换算费用。模型名按 DEFAULT_PRICING 正则分派 provider，
 * 无需调用方指定。overrides（设置页覆盖）按 key 优先于默认。
 * 匹配不到返回 undefined（前端费用列显示「-」）。
 */
export function computeCost(
  model: string,
  tokens: TokenUsage,
  overrides?: Record<string, Partial<ModelPricing>>,
): { cost: number; currency: string } | undefined {
  const row = DEFAULT_PRICING.find((r) => r.match.test(model));
  if (!row) return undefined;
  const o = overrides?.[row.key] ?? {};
  const inputPerM = o.inputPerM ?? row.inputPerM;
  const outputPerM = o.outputPerM ?? row.outputPerM;
  const cacheReadPerM = o.cacheReadPerM ?? row.cacheReadPerM ?? 0;
  const cacheWritePerM = o.cacheWritePerM ?? row.cacheWritePerM ?? 0;
  const cost =
    ((tokens.input ?? 0) * inputPerM +
      (tokens.output ?? 0) * outputPerM +
      (tokens.cacheRead ?? 0) * cacheReadPerM +
      (tokens.cacheCreation ?? 0) * cacheWritePerM) /
    1_000_000;
  return { cost, currency: o.currency ?? row.currency ?? USD };
}

/** 合并默认 + override，返回设置页展示用的有效价表 */
export function getPricingTable(
  overrides?: Record<string, Partial<ModelPricing>>,
): PricingRowDisplay[] {
  return DEFAULT_PRICING.map((r) => {
    const o = overrides?.[r.key] ?? {};
    return {
      key: r.key,
      label: r.label,
      inputPerM: o.inputPerM ?? r.inputPerM,
      outputPerM: o.outputPerM ?? r.outputPerM,
      cacheReadPerM: o.cacheReadPerM ?? r.cacheReadPerM ?? 0,
      cacheWritePerM: o.cacheWritePerM ?? r.cacheWritePerM ?? 0,
      currency: o.currency ?? r.currency ?? USD,
    };
  });
}

/** 从 setting 原始字符串解析 overrides，容错 */
export function parseOverrides(
  raw: string | undefined,
): Record<string, Partial<ModelPricing>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, Partial<ModelPricing>>;
    }
  } catch {
    // 损坏 JSON 忽略，回退默认
  }
  return {};
}

/**
 * 兼容旧调用：Anthropic 适配器 fetchUsage 用此把 token 换算成费用。
 * 内部委托 computeCost（用内置默认价，不应用 override）。
 */
export function computeAnthropicCost(
  model: string,
  tokens: AnthropicTokenBreakdown,
): number | undefined {
  return computeCost(model, tokens)?.cost;
}
