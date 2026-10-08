import type { PricingRow } from "../pricing";

export const DEEPSEEK_PRICING: PricingRow[] = [
  // ==========================================================================
  // DeepSeek — api-docs.deepseek.com/quick_start/pricing（核对 2026-10-08）
  //
  // 官方按峰谷双价：谷时是峰时的一半。峰时为工作日 UTC 01:00–04:00 与
  // 06:00–10:00，其余时段走谷价。此处取**峰时价**（较高档）：调用时刻不在
  // 用量记录里，取低价会系统性低估账单，宁可报高不报低。
  // 谷价 = 表内数值 ÷ 2。
  // free 变体必须排在 flash 之前。
  //
  // 2026-10：新模型名 `deepseek-flash`（DeepSeek-V4.1-Flash）。旧名
  // `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 仍可调用，但对应模型已退役，
  // 官方注明这些请求由 V4.1-Flash 承接并**按 Flash 价计费**，所以旧 key 保留
  // （用户覆盖按 key 存），价格改成与 deepseek-flash 一致。
  // ==========================================================================
  {
    // 官方页已不再列出免费款；保留供历史用量（如 OpenCode 免费通道）按 0 计
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
    // 已退役，请求按 deepseek-flash 计费
    key: "deepseek-v4-flash-vision",
    label: "DeepSeek V4 Flash Vision (Exp，已退役)",
    match: /deepseek[.\-_]*v?[.\-_]*4[.\-_]*flash[.\-_]*vision/i,
    inputPerM: 0.3,
    outputPerM: 1.2,
    cacheReadPerM: 0.006,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    // 已退役，请求按 deepseek-flash 计费
    key: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash (已退役)",
    match: /deepseek[.\-_]*v?[.\-_]*4[.\-_]*flash/i,
    inputPerM: 0.3,
    outputPerM: 1.2,
    cacheReadPerM: 0.006,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    // 2026-10 新增；也接受带版本号的 deepseek-v4.1-flash 写法
    key: "deepseek-flash",
    label: "DeepSeek Flash (V4.1)",
    match: /deepseek[.\-_]*(?:v?4[.\-_]*1[.\-_]*)?flash/i,
    inputPerM: 0.3,
    outputPerM: 1.2,
    cacheReadPerM: 0.006,
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
