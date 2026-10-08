import type { PricingRow } from "../pricing";

export const KIMI_PRICING: PricingRow[] = [
  // ==========================================================================
  // Moonshot Kimi — platform.kimi.com/docs/pricing/chat-k3
  //
  // 官方国内页只给人民币（K3：缓存命中 ¥2 / 未命中 ¥20 / 输出 ¥100），
  // 这里按 1 USD ≈ 7.1 CNY 折算成美元，保持全表币种统一：
  // 20 ÷ 7.1 ≈ 2.82、100 ÷ 7.1 ≈ 14.08、2 ÷ 7.1 ≈ 0.28。
  // 汇率会漂，需要精确账单请在价格表页覆盖此行。
  // ==========================================================================
  {
    key: "kimi-k3",
    label: "Kimi K3",
    match: /kimi[.\-_\s]*k?3/i,
    inputPerM: 2.82,
    outputPerM: 14.08,
    cacheReadPerM: 0.28,
    cacheWritePerM: 0,
    currency: "USD",
  },
];
