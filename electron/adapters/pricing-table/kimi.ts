import type { PricingRow } from "../pricing";

export const KIMI_PRICING: PricingRow[] = [
  // ==========================================================================
  // Moonshot Kimi — platform.kimi.ai/docs/pricing/chat（海外站，美元；核对 2026-10-08）
  //
  // 2026-10 起改用官方海外站美元价，不再按汇率折算国内人民币价（国内站
  // platform.kimi.com/docs/pricing/chat-k3：K3 为 ¥20 / ¥2 / ¥100）。
  //
  // K3 的缓存写入现在单独计费，按 TTL 分档：5 分钟 $3.00、1 小时 $6.00，
  // 不指定 TTL 默认 5 分钟档，此处取 5 分钟档。K2 系列官方未列缓存写入价，填 0。
  // highspeed 必须排在同系列普通款之前。
  // ==========================================================================
  {
    key: "kimi-k3",
    label: "Kimi K3",
    match: /kimi[.\-_\s]*k?3/i,
    inputPerM: 3,
    outputPerM: 15,
    cacheReadPerM: 0.3,
    cacheWritePerM: 3,
    currency: "USD",
  },
  {
    // 2026-10 新增
    key: "kimi-k2.7-code-highspeed",
    label: "Kimi K2.7 Code HighSpeed",
    match: /kimi[.\-_\s]*k?2[.\-_]*7[.\-_]*code[.\-_]*high[.\-_]*speed/i,
    inputPerM: 1.9,
    outputPerM: 8,
    cacheReadPerM: 0.38,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    // 2026-10 新增
    key: "kimi-k2.7-code",
    label: "Kimi K2.7 Code",
    match: /kimi[.\-_\s]*k?2[.\-_]*7/i,
    inputPerM: 0.95,
    outputPerM: 4,
    cacheReadPerM: 0.19,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    // 2026-10 新增
    key: "kimi-k2.6",
    label: "Kimi K2.6",
    match: /kimi[.\-_\s]*k?2[.\-_]*6/i,
    inputPerM: 0.95,
    outputPerM: 4,
    cacheReadPerM: 0.16,
    cacheWritePerM: 0,
    currency: "USD",
  },
];
