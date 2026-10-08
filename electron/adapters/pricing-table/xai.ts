import type { PricingRow } from "../pricing";

export const XAI_PRICING: PricingRow[] = [
  // ==========================================================================
  // xAI Grok — docs.x.ai/docs/models（取 <200k 提示档，核对 2026-10-08）
  //
  // 官方规则：提示达到 200k 阈值时整个请求全部 token 按高价档计费（翻倍），
  // 不是只对超出部分。此处取低档，长上下文会算少。
  //
  // 不收录 Grok 4（grok-4-0709）：核对 2026-10-08 时 docs.x.ai/docs/models 与
  // docs.x.ai/docs/pricing 都已不再列出它的价格。官方迁移说明
  // docs.x.ai/developers/migration/may-15-retirement 写明它已于 2026-05-15 退役，
  // 此后对该名字的请求转发给 grok-4.3 并按 grok-4.3 计费；退役前的原价官方已不再给出。
  // 所以 grok-4 / grok-4-0709 / grok-4-latest 保持匹配不到（显示「-」）。
  // 同一说明里 grok-4-1-fast-* 也已退役并改按 grok-4.3 计费，下面 4.1 Fast 行保留的是
  // 退役前的价，用于历史用量。
  // ==========================================================================
  {
    // 2026-10 新增，与 4.6 同价；≥200k 提示档为 4.00/12.00/1.00
    key: "grok-4.7",
    label: "Grok 4.7",
    match: /grok[.\-_]*4[.\-_]*7(?!\d)/i,
    inputPerM: 2,
    outputPerM: 6,
    cacheReadPerM: 0.5,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "grok-4.6",
    label: "Grok 4.6",
    match: /grok[.\-_]*4[.\-_]*6(?!\d)/i,
    inputPerM: 2,
    outputPerM: 6,
    cacheReadPerM: 0.5,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "grok-4.5",
    label: "Grok 4.5",
    match: /grok[.\-_]*4[.\-_]*5(?!\d)/i,
    inputPerM: 2,
    outputPerM: 6,
    cacheReadPerM: 0.3,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "grok-4.3",
    label: "Grok 4.3",
    match: /grok[.\-_]*4[.\-_]*3(?!\d)/i,
    inputPerM: 1.25,
    outputPerM: 2.5,
    cacheReadPerM: 0.2,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "grok-4.20",
    label: "Grok 4.20",
    match: /grok[.\-_]*4[.\-_]*20(?!\d)/i,
    inputPerM: 1.25,
    outputPerM: 2.5,
    cacheReadPerM: 0.2,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "grok-4.1-fast",
    label: "Grok 4.1 Fast",
    match: /grok[.\-_]*4[.\-_]*1[.\-_]*fast/i,
    inputPerM: 0.2,
    outputPerM: 0.5,
    cacheReadPerM: 0,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "grok-build",
    label: "Grok Build 0.1",
    match: /grok[.\-_]*build/i,
    inputPerM: 1,
    outputPerM: 2,
    cacheReadPerM: 0.2,
    cacheWritePerM: 0,
    currency: "USD",
  },
];
