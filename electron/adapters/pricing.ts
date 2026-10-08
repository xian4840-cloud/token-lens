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

import { logWarn } from "../lib/logger";
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
  /** 该行是否有用户覆盖（用于显示「恢复默认」） */
  overridden?: boolean;
  defaults?: {
    inputPerM: number;
    outputPerM: number;
    cacheReadPerM: number;
    cacheWritePerM: number;
  };
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
      overridden: Object.keys(o).length > 0,
      defaults: {
        inputPerM: r.inputPerM,
        outputPerM: r.outputPerM,
        cacheReadPerM: r.cacheReadPerM ?? 0,
        cacheWritePerM: r.cacheWritePerM ?? 0,
      },
    };
  });
}

/**
 * 剔除与内置表取值完全相同的覆盖项。
 *
 * 设置页保存时会把整张表（81 行）都当作覆盖写回来——它展示的本来就是合并后的
 * 有效值，无从区分哪几行是用户真改过的。不清理的话，用户只改一个模型的价格，
 * 其余 80 行也被一并钉死在当天的数值上：此后版本更新内置价表，对这些行永远
 * 不再生效。而且界面上完全看不出来——合并后的显示值仍然是那些覆盖值——
 * 也没有「恢复默认」可点，用户没有任何办法退回去。
 *
 * 取值确有差异的覆盖一律保留；内置表里查不到的 key（旧版本遗留）也无从比较，
 * 原样留下。
 */
export function pruneDefaultOverrides(
  overrides: Record<string, Partial<ModelPricing>>,
): Record<string, Partial<ModelPricing>> {
  const byKey = new Map(DEFAULT_PRICING.map((r) => [r.key, r]));
  const out: Record<string, Partial<ModelPricing>> = {};
  for (const [key, o] of Object.entries(overrides)) {
    const row = byKey.get(key);
    if (!row) {
      out[key] = o;
      continue;
    }
    const same =
      (o.inputPerM ?? row.inputPerM) === row.inputPerM &&
      (o.outputPerM ?? row.outputPerM) === row.outputPerM &&
      (o.cacheReadPerM ?? row.cacheReadPerM ?? 0) === (row.cacheReadPerM ?? 0) &&
      (o.cacheWritePerM ?? row.cacheWritePerM ?? 0) ===
        (row.cacheWritePerM ?? 0) &&
      (o.currency ?? row.currency ?? USD) === (row.currency ?? USD);
    if (!same) out[key] = o;
  }
  return out;
}

/**
 * 从 setting 原始字符串解析 overrides，容错。
 *
 * 这是唯一把存储字符串变成对象的入口（设置页展示与用量换算都经过它），
 * 所以冗余项的剔除放在这里做：存量数据也能在下次读取时自愈。
 */
export function parseOverrides(
  raw: string | undefined,
): Record<string, Partial<ModelPricing>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return pruneDefaultOverrides(
        parsed as Record<string, Partial<ModelPricing>>,
      );
    }
  } catch (e) {
    logWarn(
      "pricing",
      `pricingOverrides 不是合法 JSON，已回退内置价格：${e instanceof Error ? e.message : String(e)}`,
    );
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
