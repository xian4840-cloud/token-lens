import type { PricingRow } from "../pricing";

export const XAI_PRICING: PricingRow[] = [
  // ==========================================================================
  // xAI Grok — docs.x.ai/docs/models（取 <200k 提示档，核对 2026-10-08）
  //
  // 官方规则：提示达到 200k 阈值时整个请求全部 token 按高价档计费（翻倍），
  // 不是只对超出部分。此处取低档，长上下文会算少。
  // ==========================================================================
  {
    // 2026-10 新增，与 4.6 同价；≥200k 提示档为 4.00/12.00/1.00
    key: "grok-4.7",
    label: "Grok 4.7",
    match: /grok[.\-_]*4[.\-_]*7/i,
    inputPerM: 2,
    outputPerM: 6,
    cacheReadPerM: 0.5,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "grok-4.6",
    label: "Grok 4.6",
    match: /grok[.\-_]*4[.\-_]*6/i,
    inputPerM: 2,
    outputPerM: 6,
    cacheReadPerM: 0.5,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "grok-4.5",
    label: "Grok 4.5",
    match: /grok[.\-_]*4[.\-_]*5/i,
    inputPerM: 2,
    outputPerM: 6,
    cacheReadPerM: 0.3,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "grok-4.3",
    label: "Grok 4.3",
    match: /grok[.\-_]*4[.\-_]*3/i,
    inputPerM: 1.25,
    outputPerM: 2.5,
    cacheReadPerM: 0.2,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "grok-4.20",
    label: "Grok 4.20",
    match: /grok[.\-_]*4[.\-_]*20/i,
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
