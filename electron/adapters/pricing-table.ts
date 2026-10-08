import type { PricingRow } from "./pricing";
import { OPENAI_PRICING } from "./pricing-table/openai";
import { ZHIPU_PRICING } from "./pricing-table/zhipu";
import { DEEPSEEK_PRICING } from "./pricing-table/deepseek";
import { KIMI_PRICING } from "./pricing-table/kimi";
import { MIMO_PRICING } from "./pricing-table/mimo";
import { GEMINI_PRICING } from "./pricing-table/gemini";
import { ANTHROPIC_PRICING } from "./pricing-table/anthropic";
import { XAI_PRICING } from "./pricing-table/xai";

/**
 * 内置模型价格表（USD / 百万 tokens）。单独文件维护，方便增删模型。
 *
 * 价格来源于各家官方定价页，核对日期 2026-10-08（各厂商文件头注明了来源页），
 * 可能滞后或变动，以官网为准。
 * 用户可在设置页覆盖任意条目（存 setting `pricingOverrides`，按 key 索引）。
 *
 * ## 三条录入规则
 *
 * 1. **一律折算成 USD。** 趋势页按 `cost` 直接求和（见 ui/src/pages/Trends.tsx），
 *    表里混入人民币行会把 ¥ 和 $ 加在一起，汇总金额直接错。国内厂商官方页给
 *    人民币价的（Kimi、MiMo、智谱），取其海外站美元价；只有人民币价的按当期汇率
 *    折算并在该行注明。
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
 * - `gpt-6.1-sol` / `gpt-6-luna` 必须排在 gpt-6-astra 之前（astra 带 `\bgpt-6\b` 兜底）。
 * - 带小版本号的 Claude 5.5（opus/sonnet-5-5）必须排在宽松的 `opus-5` / `sonnet-5` 之前。
 * - `glm-5.3-flash(x)` 必须排在 `glm-5.3` 之前（5.3-Flash 并非免费款）。
 *
 * 版本号以数字结尾的正则一律加 `(?!\d)`：否则 `gpt[.\-_]*5[.\-_]*2` 会把带日期的
 * 快照名 `gpt-5-2025-08-07` 当成 5.2，`glm-5-20250101` 当成 GLM-5.2。
 * 测试里对每个能自匹配的 key 拼日期后缀逐一验证。
 */

/** 各厂商按下面的顺序拼接；数组顺序就是匹配优先级（见文件头「匹配规则」） */
export const DEFAULT_PRICING: PricingRow[] = [
  ...OPENAI_PRICING,
  ...ZHIPU_PRICING,
  ...DEEPSEEK_PRICING,
  ...KIMI_PRICING,
  ...MIMO_PRICING,
  ...GEMINI_PRICING,
  ...ANTHROPIC_PRICING,
  ...XAI_PRICING,
];
