import type { PricingRow } from "./pricing";

/**
 * 内置模型价格表（USD / 百万 tokens）。单独文件维护，方便增删模型。
 *
 * 价格来源于各家官方定价页，核对日期 2026-08-25，可能滞后或变动，以官网为准。
 * 用户可在设置页覆盖任意条目（存 setting `pricingOverrides`，按 key 索引）。
 *
 * ## 三条录入规则
 *
 * 1. **一律折算成 USD。** 趋势页按 `cost` 直接求和（见 ui/src/pages/Trends.tsx），
 *    表里混入人民币行会把 ¥ 和 $ 加在一起，汇总金额直接错。国内厂商官方页给
 *    人民币价的（Kimi、MiMo），取其海外站美元价；只有人民币价的按当期汇率折算
 *    并在该行注明。
 * 2. **取标准档、非折扣价。** 不用 Batch / Flex / off-peak / 促销价——本地 agent
 *    的调用走的是标准档，按折扣价算会系统性低估。分档定价（长短上下文、峰谷）
 *    取常用档并在行内注明另一档的数值。
 * 3. **cacheWritePerM 只在厂商确实单独收费时才填。** 国内多家缓存写入限时免费，
 *    填 0 是事实而非占位。Anthropic / OpenAI 的缓存写入有明确倍率，必须填。
 *
 * ## 匹配规则
 *
 * 按数组顺序匹配，更具体的正则必须放前面，否则会被宽的先吃掉。已知的几处顺序陷阱：
 * - `-free` 变体放在同系列付费款之前（deepseek-v4-flash-free / glm-4.7-flash）。
 * - Claude 4.5+ 与 Claude 4/4.1 价格差 3 倍（$5/$25 vs $15/$75），
 *   所以 opus-4.5~4.8 的正则必须排在宽松的 `opus-4` 之前。
 * - `gpt-5.6-*` 三个子型号互不重叠，但都要放在任何泛化的 gpt-5 规则之前。
 */
export const DEFAULT_PRICING: PricingRow[] = [
  // ==========================================================================
  // OpenAI — developers.openai.com/api/docs/pricing（标准档、短上下文）
  //
  // 长上下文档价格翻倍（sol 8/30、terra 4/18、luna 0.4/1.8），此处取短上下文：
  // 编码 agent 绝大多数请求在阈值以内，按长上下文价算会普遍高估。
  // ==========================================================================
  {
    key: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    match: /5[.-]6[.\-_]*sol|daybreak[.\-_]*blue/i,
    // 促销价，官方注明至少持续到 2026-11-21；原价请留意官网
    inputPerM: 4,
    outputPerM: 20,
    cacheReadPerM: 0.4,
    cacheWritePerM: 5,
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
    key: "gpt-5.6-cyber",
    label: "GPT-5.6 Cyber",
    match: /5[.-]6[.\-_]*cyber|daybreak[.\-_]*red/i,
    inputPerM: 12.5,
    outputPerM: 75,
    cacheReadPerM: 1.25,
    cacheWritePerM: 15.625,
    currency: "USD",
  },
  {
    key: "gpt-5.5-pro",
    label: "GPT-5.5 Pro",
    match: /gpt[.\-_]*5[.\-_]*5[.\-_]*pro/i,
    inputPerM: 30,
    outputPerM: 180,
    // Pro 系列官方表无缓存输入价
    cacheReadPerM: 0,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gpt-5.5-cyber",
    label: "GPT-5.5 Cyber",
    match: /gpt[.\-_]*5[.\-_]*5[.\-_]*cyber/i,
    inputPerM: 12.5,
    outputPerM: 75,
    cacheReadPerM: 1.25,
    cacheWritePerM: 15.625,
    currency: "USD",
  },
  {
    key: "gpt-5.5",
    label: "GPT-5.5",
    match: /gpt[.\-_]*5[.\-_]*5/i,
    inputPerM: 5,
    outputPerM: 30,
    cacheReadPerM: 0.5,
    cacheWritePerM: 6.25,
    currency: "USD",
  },
  {
    key: "gpt-5.4-pro",
    label: "GPT-5.4 Pro",
    match: /gpt[.\-_]*5[.\-_]*4[.\-_]*pro/i,
    inputPerM: 30,
    outputPerM: 180,
    cacheReadPerM: 0,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    match: /gpt[.\-_]*5[.\-_]*4[.\-_]*mini/i,
    inputPerM: 0.75,
    outputPerM: 4.5,
    cacheReadPerM: 0.075,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gpt-5.4-nano",
    label: "GPT-5.4 nano",
    match: /gpt[.\-_]*5[.\-_]*4[.\-_]*nano/i,
    inputPerM: 0.2,
    outputPerM: 1.25,
    cacheReadPerM: 0.02,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gpt-5.4",
    label: "GPT-5.4",
    match: /gpt[.\-_]*5[.\-_]*4/i,
    inputPerM: 2.5,
    outputPerM: 15,
    cacheReadPerM: 0.25,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gpt-5.2-pro",
    label: "GPT-5.2 Pro",
    match: /gpt[.\-_]*5[.\-_]*2[.\-_]*pro/i,
    inputPerM: 21,
    outputPerM: 168,
    cacheReadPerM: 0,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gpt-5.2",
    label: "GPT-5.2",
    match: /gpt[.\-_]*5[.\-_]*2/i,
    inputPerM: 1.75,
    outputPerM: 14,
    cacheReadPerM: 0.175,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gpt-5-pro",
    label: "GPT-5 Pro",
    match: /gpt[.\-_]*5[.\-_]*pro/i,
    inputPerM: 15,
    outputPerM: 120,
    cacheReadPerM: 0,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gpt-5-mini",
    label: "GPT-5 mini",
    match: /gpt[.\-_]*5[.\-_]*mini/i,
    inputPerM: 0.25,
    outputPerM: 2,
    cacheReadPerM: 0.025,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gpt-5-nano",
    label: "GPT-5 nano",
    match: /gpt[.\-_]*5[.\-_]*nano/i,
    inputPerM: 0.05,
    outputPerM: 0.4,
    cacheReadPerM: 0.005,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    // gpt-5 与 gpt-5.1 同价；放在所有更具体的 gpt-5.x 规则之后兜底
    key: "gpt-5",
    label: "GPT-5 / GPT-5.1",
    match: /gpt[.\-_]*5(?:[.\-_]*1)?\b/i,
    inputPerM: 1.25,
    outputPerM: 10,
    cacheReadPerM: 0.125,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "o4-mini",
    label: "o4-mini / o3-mini",
    match: /\bo[34][.\-_]*mini/i,
    inputPerM: 1.1,
    outputPerM: 4.4,
    cacheReadPerM: 0.275,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "o3-pro",
    label: "o3-pro",
    match: /\bo3[.\-_]*pro/i,
    inputPerM: 20,
    outputPerM: 80,
    cacheReadPerM: 0,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "o3",
    label: "o3",
    match: /\bo3\b/i,
    inputPerM: 2,
    outputPerM: 8,
    cacheReadPerM: 0.5,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gpt-4.1-mini",
    label: "GPT-4.1 mini",
    match: /gpt[.\-_]*4[.\-_]*1[.\-_]*mini/i,
    inputPerM: 0.4,
    outputPerM: 1.6,
    cacheReadPerM: 0.1,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gpt-4.1-nano",
    label: "GPT-4.1 nano",
    match: /gpt[.\-_]*4[.\-_]*1[.\-_]*nano/i,
    inputPerM: 0.1,
    outputPerM: 0.4,
    cacheReadPerM: 0.025,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gpt-4.1",
    label: "GPT-4.1",
    match: /gpt[.\-_]*4[.\-_]*1/i,
    inputPerM: 2,
    outputPerM: 8,
    cacheReadPerM: 0.5,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gpt-4o-mini",
    label: "GPT-4o mini",
    match: /gpt[.\-_]*4o[.\-_]*mini/i,
    inputPerM: 0.15,
    outputPerM: 0.6,
    cacheReadPerM: 0.075,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "gpt-4o",
    label: "GPT-4o",
    match: /gpt[.\-_]*4o/i,
    inputPerM: 2.5,
    outputPerM: 10,
    cacheReadPerM: 1.25,
    cacheWritePerM: 0,
    currency: "USD",
  },
  // ==========================================================================
  // 智谱 GLM — docs.z.ai/guides/overview/pricing（海外站，美元）
  //
  // 缓存写入官方标注「限时免费」，故 cacheWritePerM 全填 0，是事实不是占位。
  // -flash 免费款必须排在同系列付费款之前。
  // ==========================================================================
  {
    key: "glm-5.3",
    label: "GLM-5.3",
    match: /glm[.\-_]*5[.\-_]*3/i,
    inputPerM: 1.4,
    outputPerM: 4.4,
    cacheReadPerM: 0.26,
    cacheWritePerM: 0,
    currency: "USD",
  },
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
  {
    key: "glm-5.1",
    label: "GLM-5.1",
    match: /glm[.\-_]*5[.\-_]*1/i,
    inputPerM: 1.4,
    outputPerM: 4.4,
    cacheReadPerM: 0.26,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "glm-5-turbo",
    label: "GLM-5-Turbo",
    match: /glm[.\-_]*5[.\-_]*turbo/i,
    inputPerM: 1.2,
    outputPerM: 4,
    cacheReadPerM: 0.24,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "glm-5v-turbo",
    label: "GLM-5V-Turbo",
    match: /glm[.\-_]*5v[.\-_]*turbo/i,
    inputPerM: 1.2,
    outputPerM: 4,
    cacheReadPerM: 0.24,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "glm-4.7-flash",
    label: "GLM-4.7-Flash (免费)",
    match: /glm[.\-_]*4[.\-_]*7[.\-_]*flash(?![.\-_]*x)/i,
    inputPerM: 0,
    outputPerM: 0,
    cacheReadPerM: 0,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "glm-4.7-flashx",
    label: "GLM-4.7-FlashX",
    match: /glm[.\-_]*4[.\-_]*7[.\-_]*flashx/i,
    inputPerM: 0.07,
    outputPerM: 0.4,
    cacheReadPerM: 0.01,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "glm-4.7",
    label: "GLM-4.7",
    match: /glm[.\-_]*4[.\-_]*7/i,
    inputPerM: 0.6,
    outputPerM: 2.2,
    cacheReadPerM: 0.11,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "glm-5",
    label: "GLM-5",
    match: /glm[.\-_]*5\b/i,
    inputPerM: 1,
    outputPerM: 3.2,
    cacheReadPerM: 0.2,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "glm-4.6v-flash",
    label: "GLM-4.6V-Flash (免费)",
    match: /glm[.\-_]*4[.\-_]*6v[.\-_]*flash(?![.\-_]*x)/i,
    inputPerM: 0,
    outputPerM: 0,
    cacheReadPerM: 0,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "glm-4.6v",
    label: "GLM-4.6V",
    match: /glm[.\-_]*4[.\-_]*6v/i,
    inputPerM: 0.3,
    outputPerM: 0.9,
    cacheReadPerM: 0.05,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "glm-4.5-flash",
    label: "GLM-4.5-Flash (免费)",
    match: /glm[.\-_]*4[.\-_]*5[.\-_]*flash/i,
    inputPerM: 0,
    outputPerM: 0,
    cacheReadPerM: 0,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "glm-4.5-airx",
    label: "GLM-4.5-AirX",
    match: /glm[.\-_]*4[.\-_]*5[.\-_]*airx/i,
    inputPerM: 1.1,
    outputPerM: 4.5,
    cacheReadPerM: 0.22,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "glm-4.5-air",
    label: "GLM-4.5-Air",
    match: /glm[.\-_]*4[.\-_]*5[.\-_]*air/i,
    inputPerM: 0.2,
    outputPerM: 1.1,
    cacheReadPerM: 0.03,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "glm-4.5-x",
    label: "GLM-4.5-X",
    match: /glm[.\-_]*4[.\-_]*5[.\-_]*x\b/i,
    inputPerM: 2.2,
    outputPerM: 8.9,
    cacheReadPerM: 0.45,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "glm-4.5v",
    label: "GLM-4.5V",
    match: /glm[.\-_]*4[.\-_]*5v/i,
    inputPerM: 0.6,
    outputPerM: 1.8,
    cacheReadPerM: 0.11,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    // GLM-4.5 与 GLM-4.6 同价；放在所有 4.5-* / 4.6v 变体之后兜底
    key: "glm-4.5",
    label: "GLM-4.5 / GLM-4.6",
    match: /glm[.\-_]*4[.\-_]*[56]\b/i,
    inputPerM: 0.6,
    outputPerM: 2.2,
    cacheReadPerM: 0.11,
    cacheWritePerM: 0,
    currency: "USD",
  },
  // ==========================================================================
  // DeepSeek — api-docs.deepseek.com/quick_start/pricing
  //
  // 官方按峰谷双价：谷时是峰时的一半。峰时为工作日 UTC 01:00–04:00 与
  // 06:00–10:00，其余时段走谷价。此处取**峰时价**（较高档）：调用时刻不在
  // 用量记录里，取低价会系统性低估账单，宁可报高不报低。
  // 谷价 = 表内数值 ÷ 2。
  // free 变体必须排在 flash 之前。
  // ==========================================================================
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
    key: "deepseek-v4-flash-vision",
    label: "DeepSeek V4 Flash Vision (Exp)",
    match: /deepseek[.\-_]*v?[.\-_]*4[.\-_]*flash[.\-_]*vision/i,
    inputPerM: 0.44,
    outputPerM: 1.32,
    cacheReadPerM: 0.014,
    cacheWritePerM: 0,
    currency: "USD",
  },
  {
    key: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    match: /deepseek[.\-_]*v?[.\-_]*4[.\-_]*flash/i,
    inputPerM: 0.44,
    outputPerM: 1.32,
    cacheReadPerM: 0.014,
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
  // ==========================================================================
  // Google Gemini — ai.google.dev/gemini-api/docs/pricing（Standard 档）
  //
  // Antigravity 的本地用量走这里换算。输出价已含 thinking tokens，与
  // local-usage/index.ts 里把 reasoningTokens 并入 output 的做法一致。
  //
  // 注意 3.7 / 3.6 Flash 是**按日期分档**的：官方明示 $0.75 仅到 2026-12-31，
  // 2027-01-01 起翻倍到 $1.50（输出 3.75 → 7.50，缓存 0.075 → 0.15）。
  // 表内先填现价，跨年后需要手动改或在价格表页覆盖。
  //
  // Flash-Lite 与 3.1 Flash-Lite 的音频输入单价是文本的两倍，本表按文本价填；
  // 编码 agent 不传音频，不影响。
  // ==========================================================================
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
  // ==========================================================================
  // Anthropic — platform.claude.com/docs/zh-CN/about-claude/pricing
  //
  // cacheWritePerM 取 5 分钟档（基础输入 ×1.25）。1 小时档是 ×2，但本地 agent
  // 默认走 5 分钟缓存。cacheReadPerM 固定为基础输入 ×0.1。
  //
  // 顺序关键：Opus 4.5 起降到 $5/$25，而 Opus 4/4.1 仍是 $15/$75。宽松的
  // `opus-4` 正则会连 4.6/4.8 一起吃掉，按 $15/$75 算等于虚报 3 倍，
  // 所以带小版本号的必须全部排在它前面。
  // ==========================================================================
  {
    key: "claude-fable-5",
    label: "Claude Fable 5 / Mythos 5",
    match: /claude[.\-_]*(?:fable|mythos)[.\-_]*5/i,
    inputPerM: 10,
    outputPerM: 50,
    cacheReadPerM: 1,
    cacheWritePerM: 12.5,
    currency: "USD",
  },
  {
    key: "claude-opus-5",
    label: "Claude Opus 5",
    match: /opus[.\-_]*5/i,
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
    match: /opus[.\-_]*4[.\-_]*[5678]/i,
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
    match: /opus[.\-_]*4/i,
    inputPerM: 15,
    outputPerM: 75,
    cacheReadPerM: 1.5,
    cacheWritePerM: 18.75,
    currency: "USD",
  },
  {
    key: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    match: /sonnet[.\-_]*5/i,
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
    match: /sonnet[.\-_]*4/i,
    inputPerM: 3,
    outputPerM: 15,
    cacheReadPerM: 0.3,
    cacheWritePerM: 3.75,
    currency: "USD",
  },
  {
    key: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    match: /haiku[.\-_]*4[.\-_]*5/i,
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
  // ==========================================================================
  // xAI Grok — docs.x.ai/docs/models（取 <200k 提示档）
  //
  // 官方规则：提示达到 200k 阈值时整个请求全部 token 按高价档计费（翻倍），
  // 不是只对超出部分。此处取低档，长上下文会算少。
  // ==========================================================================
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
