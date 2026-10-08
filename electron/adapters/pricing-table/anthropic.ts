import type { PricingRow } from "../pricing";

export const ANTHROPIC_PRICING: PricingRow[] = [
  // ==========================================================================
  // Anthropic — platform.claude.com/docs/en/about-claude/pricing（核对 2026-10-08）
  //
  // cacheWritePerM 取 5 分钟档（基础输入 ×1.25）。1 小时档是 ×2，但本地 agent
  // 默认走 5 分钟缓存。cacheReadPerM 一般为基础输入 ×0.1，例外：
  // Fable/Mythos 5.1 为 ×0.025，Opus 5.5 / Sonnet 5.5 为 ×0.05。
  //
  // 顺序关键：Opus 4.5 起降到 $5/$25，而 Opus 4/4.1 仍是 $15/$75。宽松的
  // `opus-4` 正则会连 4.6/4.8 一起吃掉，按 $15/$75 算等于虚报 3 倍，
  // 所以带小版本号的必须全部排在它前面。
  // ==========================================================================
  {
    // 5.1 缓存命中是 0.025× 输入（$0.25），必须排在 Fable 5 之前
    key: "claude-fable-5-1",
    label: "Claude Fable 5.1 / Mythos 5.1",
    match: /claude[.\-_]*(?:fable|mythos)[.\-_]*5[.\-_]*1(?!\d)/i,
    inputPerM: 10,
    outputPerM: 50,
    cacheReadPerM: 0.25,
    cacheWritePerM: 12.5,
    currency: "USD",
  },
  {
    key: "claude-fable-5",
    label: "Claude Fable 5 / Mythos 5",
    match: /claude[.\-_]*(?:fable|mythos)[.\-_]*5(?!\d)/i,
    inputPerM: 10,
    outputPerM: 50,
    cacheReadPerM: 1,
    cacheWritePerM: 12.5,
    currency: "USD",
  },
  {
    // 2026-10 新增，缓存命中 0.05× 输入（$0.20）。必须排在宽松的 opus-5 之前，
    // 否则 claude-opus-5-5 会落到 Opus 5 的 $5/$25 上
    key: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    match: /opus[.\-_]*5[.\-_]*5(?!\d)/i,
    inputPerM: 4,
    outputPerM: 20,
    cacheReadPerM: 0.2,
    cacheWritePerM: 5,
    currency: "USD",
  },
  {
    key: "claude-opus-5",
    label: "Claude Opus 5",
    match: /opus[.\-_]*5(?!\d)/i,
    inputPerM: 5,
    outputPerM: 25,
    cacheReadPerM: 0.5,
    cacheWritePerM: 6.25,
    currency: "USD",
  },
  {
    // 4.5 / 4.6 / 4.7 / 4.8 同价，合成一条规则；必须在 claude-opus-4 之前
    key: "claude-opus-4-5-plus",
    label: "Claude Opus 4.5–4.8",
    match: /opus[.\-_]*4[.\-_]*[5678](?!\d)/i,
    inputPerM: 5,
    outputPerM: 25,
    cacheReadPerM: 0.5,
    cacheWritePerM: 6.25,
    currency: "USD",
  },
  {
    // 仅剩 Opus 4 / 4.1（均已停用，Bedrock、Google Cloud 上仍可用）
    key: "claude-opus-4",
    label: "Claude Opus 4 / 4.1",
    match: /opus[.\-_]*4(?!\d)/i,
    inputPerM: 15,
    outputPerM: 75,
    cacheReadPerM: 1.5,
    cacheWritePerM: 18.75,
    currency: "USD",
  },
  {
    // 2026-10 新增，与 Sonnet 5 同为 $2/$10，但缓存命中是 0.05×（$0.10 而非 $0.20）；
    // 必须排在宽松的 sonnet-5 之前
    key: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    match: /sonnet[.\-_]*5[.\-_]*5(?!\d)/i,
    inputPerM: 2,
    outputPerM: 10,
    cacheReadPerM: 0.1,
    cacheWritePerM: 2.5,
    currency: "USD",
  },
  {
    key: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    match: /sonnet[.\-_]*5(?!\d)/i,
    // 上市促销 $2/$10 已转正，原定 2026-09-01 调到 $3/$15 取消
    inputPerM: 2,
    outputPerM: 10,
    cacheReadPerM: 0.2,
    cacheWritePerM: 2.5,
    currency: "USD",
  },
  {
    // Sonnet 4 / 4.5 / 4.6 同价 $3/$15，无需按小版本拆分
    key: "claude-sonnet-4",
    label: "Claude Sonnet 4–4.6",
    match: /sonnet[.\-_]*4(?!\d)/i,
    inputPerM: 3,
    outputPerM: 15,
    cacheReadPerM: 0.3,
    cacheWritePerM: 3.75,
    currency: "USD",
  },
  {
    // 2026-10 新增。按提示长度分档：≤100k 为 0.10/0.50（缓存读 0.01、5 分钟写 0.125），
    // >100k 为 0.50/2.50（缓存读 0.05、写 0.625）。此处取 ≤100k 档：Claude Code 里
    // Haiku 主要跑标题、摘要等短请求；长提示会算少，需要时在价格表页覆盖
    key: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    match: /haiku[.\-_]*5[.\-_]*5(?!\d)/i,
    inputPerM: 0.1,
    outputPerM: 0.5,
    cacheReadPerM: 0.01,
    cacheWritePerM: 0.125,
    currency: "USD",
  },
  {
    key: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    match: /haiku[.\-_]*4[.\-_]*5(?!\d)/i,
    inputPerM: 1,
    outputPerM: 5,
    cacheReadPerM: 0.1,
    cacheWritePerM: 1.25,
    currency: "USD",
  },
  // ---- Anthropic Claude 3.x（均已停用，保留用于历史用量换算）----
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
