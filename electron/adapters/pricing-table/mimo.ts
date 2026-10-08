import type { PricingRow } from "../pricing";

export const MIMO_PRICING: PricingRow[] = [
  // ==========================================================================
  // 小米 MiMo — mimo.mi.com/docs/en-US/price/pay-as-you-go（海外站，美元）
  //
  // 缓存写入官方标注限时免费。国内站价格为人民币（pro：¥3 / ¥6），
  // 此处直接采用官方海外美元价，无需折算。
  // ==========================================================================
  {
    key: "mimo-v2.5-pro",
    label: "MiMo V2.5 Pro",
    match: /mimo[.\-_]*v?2[.\-_]*5[.\-_]*pro/i,
    inputPerM: 0.435,
    outputPerM: 0.87,
    cacheReadPerM: 0.0036,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "mimo-v2.5",
    label: "MiMo V2.5",
    match: /mimo[.\-_]*v?2[.\-_]*5/i,
    inputPerM: 0.14,
    outputPerM: 0.28,
    cacheReadPerM: 0.0028,
    cacheWritePerM: 0,
    currency: "USD",
  },
];
