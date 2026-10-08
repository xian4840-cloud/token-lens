import type { PricingRow } from "../pricing";

export const DEEPSEEK_PRICING: PricingRow[] = [
  // ==========================================================================
  // DeepSeek — api-docs.deepseek.com/quick_start/pricing
  //
  // 官方按峰谷双价：谷时是峰时的一半。峰时为工作日 UTC 01:00–04:00 与
  // 06:00–10:00，其余时段走谷价。此处取**峰时价**（较高档）：调用时刻不在
  // 用量记录里，取低价会系统性低估账单，宁可报高不报低。
  // 谷价 = 表内数值 ÷ 2。
  // free 变体必须排在 flash 之前。
  // ==========================================================================
  {
    key: "deepseek-v4-flash-free",
    label: "DeepSeek V4 Flash (Free)",
    match: /deepseek[.\-_]*v?[.\-_]*4[.\-_]*flash[.\-_]*free/i,
    inputPerM: 0,
    outputPerM: 0,
    cacheReadPerM: 0,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "deepseek-v4-flash-vision",
    label: "DeepSeek V4 Flash Vision (Exp)",
    match: /deepseek[.\-_]*v?[.\-_]*4[.\-_]*flash[.\-_]*vision/i,
    inputPerM: 0.44,
    outputPerM: 1.32,
    cacheReadPerM: 0.014,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    match: /deepseek[.\-_]*v?[.\-_]*4[.\-_]*flash/i,
    inputPerM: 0.44,
    outputPerM: 1.32,
    cacheReadPerM: 0.014,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    match: /deepseek[.\-_]*v?[.\-_]*4[.\-_]*pro/i,
    inputPerM: 1.32,
    outputPerM: 3.96,
    cacheReadPerM: 0.044,
    cacheWritePerM: 0,
    currency: "USD",
  },
];
