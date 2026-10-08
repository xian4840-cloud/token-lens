import type { PricingRow } from "../pricing";

export const GEMINI_PRICING: PricingRow[] = [
  // ==========================================================================
  // Google Gemini — ai.google.dev/gemini-api/docs/pricing（Standard 档，核对 2026-10-08）
  //
  // Antigravity 的本地用量走这里换算。输出价已含 thinking tokens，与
  // local-usage/index.ts 里把 reasoningTokens 并入 output 的做法一致。
  //
  // 注意 3.8 / 3.7 / 3.6 Flash 是**按日期分档**的：官方明示 $0.75 仅到 2026-12-31，
  // 2027-01-01 起翻倍到 $1.50（输出 3.75 → 7.50，缓存 0.075 → 0.15）。
  // 表内先填现价，跨年后需要手动改或在价格表页覆盖。
  //
  // Flash-Lite 与 3.1 Flash-Lite 的音频输入单价是文本的两倍，本表按文本价填；
  // 编码 agent 不传音频，不影响。
  // ==========================================================================
  {
    // 2026-10 新增，与 3.7 Flash 同价，含同一个 2027 年翻倍条款
    key: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    match: /gemini[.\-_]*3[.\-_]*8[.\-_]*flash/i,
    inputPerM: 0.75,
    outputPerM: 3.75,
    cacheReadPerM: 0.075,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    match: /gemini[.\-_]*3[.\-_]*7[.\-_]*flash/i,
    inputPerM: 0.75,
    outputPerM: 3.75,
    cacheReadPerM: 0.075,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    // 与 3.7 Flash 同价，含同一个 2027 年翻倍条款
    key: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    match: /gemini[.\-_]*3[.\-_]*6[.\-_]*flash/i,
    inputPerM: 0.75,
    outputPerM: 3.75,
    cacheReadPerM: 0.075,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    match: /gemini[.\-_]*3[.\-_]*5[.\-_]*flash[.\-_]*lite/i,
    inputPerM: 0.3,
    outputPerM: 2.5,
    cacheReadPerM: 0.03,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    match: /gemini[.\-_]*3[.\-_]*5[.\-_]*flash/i,
    inputPerM: 1.5,
    outputPerM: 9,
    cacheReadPerM: 0.15,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    // 分档：>200k 提示为 4.00/18.00/0.40，此处取 ≤200k 常用档
    key: "gemini-3.1-pro",
    label: "Gemini 3.1 Pro",
    match: /gemini[.\-_]*3[.\-_]*1[.\-_]*pro/i,
    inputPerM: 2,
    outputPerM: 12,
    cacheReadPerM: 0.2,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    match: /gemini[.\-_]*3[.\-_]*1[.\-_]*flash[.\-_]*lite/i,
    inputPerM: 0.25,
    outputPerM: 1.5,
    cacheReadPerM: 0.025,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gemini-3.1-flash",
    label: "Gemini 3.1 Flash",
    match: /gemini[.\-_]*3[.\-_]*1[.\-_]*flash/i,
    inputPerM: 0.75,
    outputPerM: 4.5,
    cacheReadPerM: 0,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gemini-3-flash",
    label: "Gemini 3 Flash",
    match: /gemini[.\-_]*3[.\-_]*flash/i,
    inputPerM: 0.5,
    outputPerM: 3,
    cacheReadPerM: 0.05,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    // 分档：>200k 提示为 2.50/15.00/0.25，此处取 ≤200k 常用档
    key: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    match: /gemini[.\-_]*2[.\-_]*5[.\-_]*pro/i,
    inputPerM: 1.25,
    outputPerM: 10,
    cacheReadPerM: 0.125,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    match: /gemini[.\-_]*2[.\-_]*5[.\-_]*flash[.\-_]*lite/i,
    inputPerM: 0.1,
    outputPerM: 0.4,
    cacheReadPerM: 0.01,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    match: /gemini[.\-_]*2[.\-_]*5[.\-_]*flash/i,
    inputPerM: 0.3,
    outputPerM: 2.5,
    cacheReadPerM: 0.03,
    cacheWritePerM: 0,
    currency: "USD",
  },
];
