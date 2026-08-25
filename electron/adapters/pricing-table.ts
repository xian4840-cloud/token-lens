import type { PricingRow } from "./pricing";

/**
 * 内置模型价格表（默认 USD / 百万 tokens）。单独文件维护，方便增删模型。
 *
 * 价格来源于各家官网公开定价，可能滞后或变动，以官网为准。
 * 用户可在设置页覆盖任意条目（存 setting `pricingOverrides`，按 key 索引）。
 *
 * 2026 新模型（gpt-5.6 / glm-5.2 / deepseek-v4 / kimi-k3）由用户按官网核对后录入。
 *
 * 按数组顺序匹配，更具体的正则放前面
 * （如 deepseek-v4-flash-free 在 deepseek-v4-flash 前，避免被 flash 先吃掉）。
 */
export const DEFAULT_PRICING: PricingRow[] = [
  // ---- OpenAI GPT-5.6 系列 ----
  {
    key: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    match: /5[.-]6[.\-_]*sol/i,
    inputPerM: 5,
    outputPerM: 30,
    cacheReadPerM: 0.5,
    cacheWritePerM: 6.25,
    currency: "USD",
  },
  {
    key: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    match: /5[.-]6[.\-_]*luna/i,
    inputPerM: 0.2,
    outputPerM: 1.2,
    cacheReadPerM: 0.02,
    cacheWritePerM: 0.25,
    currency: "USD",
  },
  {
    key: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    match: /5[.-]6[.\-_]*terra/i,
    inputPerM: 2,
    outputPerM: 12,
    cacheReadPerM: 0.2,
    cacheWritePerM: 2.5,
    currency: "USD",
  },
  // ---- 智谱 GLM ----
  {
    key: "glm-5.2",
    label: "GLM-5.2",
    match: /glm[.\-_]*5[.\-_]*2/i,
    inputPerM: 1.4,
    outputPerM: 4.4,
    cacheReadPerM: 0.26,
    cacheWritePerM: 0,
    currency: "USD",
  },
  // ---- DeepSeek V4（free 必须在 flash 前）----
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
    key: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    match: /deepseek[.\-_]*v?[.\-_]*4[.\-_]*flash/i,
    inputPerM: 0.14,
    outputPerM: 0.28,
    cacheReadPerM: 0.0028,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    match: /deepseek[.\-_]*v?[.\-_]*4[.\-_]*pro/i,
    inputPerM: 0.435,
    outputPerM: 0.87,
    cacheReadPerM: 0.003625,
    cacheWritePerM: 0,
    currency: "USD",
  },
  // ---- Moonshot Kimi ----
  {
    key: "kimi-k3",
    label: "Kimi K3",
    match: /kimi[.\-_\s]*k?3/i,
    inputPerM: 3,
    outputPerM: 15,
    cacheReadPerM: 0.3,
    cacheWritePerM: 0,
    currency: "USD",
  },
  // ---- Google Gemini Flash（Antigravity 本地用量换算，价格经用户按官网核对 2026-08）----
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
    key: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    match: /gemini[.\-_]*3[.\-_]*6[.\-_]*flash/i,
    inputPerM: 1.5,
    outputPerM: 7.5,
    cacheReadPerM: 0.15,
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
  // ---- Anthropic Claude 4 系列 ----
  {
    key: "claude-opus-4",
    label: "Claude Opus 4",
    match: /opus[.\-_]*4/i,
    inputPerM: 15,
    outputPerM: 75,
    cacheReadPerM: 1.5,
    cacheWritePerM: 18.75,
    currency: "USD",
  },
  {
    key: "claude-sonnet-4",
    label: "Claude Sonnet 4",
    match: /sonnet[.\-_]*4/i,
    inputPerM: 3,
    outputPerM: 15,
    cacheReadPerM: 0.3,
    cacheWritePerM: 3.75,
    currency: "USD",
  },
  // ---- Anthropic Claude 3.5 系列 ----
  {
    key: "claude-3-5-sonnet",
    label: "Claude 3.5 Sonnet",
    match: /3[.\-_]5[.\-_]*sonnet/i,
    inputPerM: 3,
    outputPerM: 15,
    cacheReadPerM: 0.3,
    cacheWritePerM: 3.75,
    currency: "USD",
  },
  {
    key: "claude-3-5-haiku",
    label: "Claude 3.5 Haiku",
    match: /3[.\-_]5[.\-_]*haiku/i,
    inputPerM: 0.8,
    outputPerM: 4,
    cacheReadPerM: 0.08,
    cacheWritePerM: 1,
    currency: "USD",
  },
  // ---- Anthropic Claude 3 系列 ----
  {
    key: "claude-3-opus",
    label: "Claude 3 Opus",
    match: /3[.\-_]opus/i,
    inputPerM: 15,
    outputPerM: 75,
    cacheReadPerM: 1.5,
    cacheWritePerM: 18.75,
    currency: "USD",
  },
  {
    key: "claude-3-sonnet",
    label: "Claude 3 Sonnet",
    match: /3[.\-_]sonnet/i,
    inputPerM: 3,
    outputPerM: 15,
    cacheReadPerM: 0.3,
    cacheWritePerM: 3.75,
    currency: "USD",
  },
  {
    key: "claude-3-haiku",
    label: "Claude 3 Haiku",
    match: /3[.\-_]haiku/i,
    inputPerM: 0.25,
    outputPerM: 1.25,
    cacheReadPerM: 0.03,
    cacheWritePerM: 0.3,
    currency: "USD",
  },
];
