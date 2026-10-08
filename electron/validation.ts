import type { ServiceInput } from "./types";
import { getDefinition } from "./adapters";
import { sanitizePricingOverrides, type ModelPricing } from "./adapters/pricing";

/**
 * IPC 输入校验。渲染进程经 contextBridge 只能调用预定义 API，但仍在此层
 * 做边界校验作为纵深防御：防止异常/被污染数据写入存储或触发越界查询。
 */

/** 服务名称最大长度 */
const MAX_NAME_LEN = 100;
/** 用量查询周期最大跨度（天），防止一次拉取过大范围 */
const MAX_PERIOD_DAYS = 366;

/** 允许写入的设置 key 白名单，防 IPC 任意覆盖 */
const ALLOWED_SETTING_KEYS = new Set<string>([
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
]);

/**
 * 校验并清洗服务输入。
 * - name 非空且长度受限
 * - provider 须已注册
 * - fields 仅保留 schema 内字段（过滤多余 key），且必填字段非空
 */
export function validateServiceInput(input: unknown): ServiceInput {
  if (!input || typeof input !== "object") {
    throw new Error("无效的服务输入");
  }
  const { name, provider, fields } = input as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("服务名称不能为空");
  }
  if (name.length > MAX_NAME_LEN) {
    throw new Error(`服务名称过长（≤${MAX_NAME_LEN} 字符）`);
  }
  if (typeof provider !== "string") {
    throw new Error("缺少服务类型");
  }
  const def = getDefinition(provider);
  if (!def) throw new Error(`未知服务类型: ${provider}`);
  if (!fields || typeof fields !== "object") {
    throw new Error("缺少字段数据");
  }
  const allowedKeys = new Set(def.configSchema.map((f) => f.key));
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    if (!allowedKeys.has(k)) continue; // 过滤 schema 外字段
    if (typeof v !== "string") continue;
    clean[k] = v;
  }
  for (const f of def.configSchema) {
    if (f.required && !clean[f.key]) {
      throw new Error(`缺少必填字段: ${f.label}`);
    }
  }
  return { name: name.trim(), provider, fields: clean };
}

/** 校验设置 key 是否在白名单内 */
export function validateSettingKey(key: unknown): string {
  if (typeof key !== "string" || !ALLOWED_SETTING_KEYS.has(key)) {
    throw new Error("不允许的设置项");
  }
  return key;
}

/** 校验用量查询周期：合法日期、起 ≤ 止、跨度受限 */
export function validatePeriod(period: unknown): {
  start: string;
  end: string;
} {
  if (!period || typeof period !== "object") {
    throw new Error("无效的查询周期");
  }
  const { start, end } = period as Record<string, unknown>;
  if (typeof start !== "string" || typeof end !== "string") {
    throw new Error("周期起止需为字符串");
  }
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    throw new Error("周期起止非合法日期");
  }
  if (s.getTime() > e.getTime()) {
    throw new Error("周期起始不能晚于结束");
  }
  const days = (e.getTime() - s.getTime()) / 86_400_000;
  if (days > MAX_PERIOD_DAYS) {
    throw new Error(`周期跨度超过 ${MAX_PERIOD_DAYS} 天`);
  }
  return { start, end };
}

/**
 * 校验价格覆盖（IPC 写入口）：须为对象，否则抛错；值的清洗规则（已知字段、类型正确、
 * 价格不为负）与读入口共用 sanitizePricingOverrides，见 adapters/pricing.ts。
 */
export function validatePricingOverrides(value: unknown): Record<string, Partial<ModelPricing>> {
  if (!value || typeof value !== "object") {
    throw new Error("无效的价格覆盖");
  }
  return sanitizePricingOverrides(value);
}
