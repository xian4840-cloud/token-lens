import type { PricingRow } from "../pricing";

export const MIMO_PRICING: PricingRow[] = [
  // ==========================================================================
  // 小米 MiMo — mimo.mi.com/docs/en-US/price/pay-as-you-go（海外站，美元；核对 2026-10-08）
  //
  // 缓存写入官方标注限时免费。国内站价格为人民币（v2.6-pro：¥3 / ¥6），
  // 此处直接采用官方海外美元价，无需折算。
  //
  // 2026-10：v2.6 系列上线，与 v2.5 对应款同价（v2.6-pro = v2.5-pro，
  // v2.6-flash = v2.5）。v2.5-pro / v2.5 将于 2026-10-21 10:00（北京时间）下线，
  // 行保留用于历史用量换算。ultraspeed 必须排在 v2.6-pro 之前。
  // ==========================================================================
  {
    // 2026-10 新增，官方不支持 Batch
    key: "mimo-v2.6-pro-ultraspeed",
    label: "MiMo V2.6 Pro UltraSpeed",
    match: /mimo[.\-_]*v?2[.\-_]*6[.\-_]*pro[.\-_]*ultra[.\-_]*speed/i,
    inputPerM: 4.35,
    outputPerM: 8.7,
    cacheReadPerM: 0.036,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    // 2026-10 新增
    key: "mimo-v2.6-pro",
    label: "MiMo V2.6 Pro",
    match: /mimo[.\-_]*v?2[.\-_]*6[.\-_]*pro/i,
    inputPerM: 0.435,
    outputPerM: 0.87,
    cacheReadPerM: 0.0036,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    // 2026-10 新增
    key: "mimo-v2.6-flash",
    label: "MiMo V2.6 Flash",
    match: /mimo[.\-_]*v?2[.\-_]*6[.\-_]*flash/i,
    inputPerM: 0.14,
    outputPerM: 0.28,
    cacheReadPerM: 0.0028,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    // 2026-10-21 下线
    key: "mimo-v2.5-pro",
    label: "MiMo V2.5 Pro (将下线)",
    match: /mimo[.\-_]*v?2[.\-_]*5[.\-_]*pro/i,
    inputPerM: 0.435,
    outputPerM: 0.87,
    cacheReadPerM: 0.0036,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    // 2026-10-21 下线
    key: "mimo-v2.5",
    label: "MiMo V2.5 (将下线)",
    match: /mimo[.\-_]*v?2[.\-_]*5(?!\d)/i,
    inputPerM: 0.14,
    outputPerM: 0.28,
    cacheReadPerM: 0.0028,
    cacheWritePerM: 0,
    currency: "USD",
  },
];
