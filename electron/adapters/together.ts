import { createKeyCheckAdapter } from "./key-check";

const BASE = "https://api.together.xyz/v1";

/**
 * Together AI 适配器。
 * Together 未提供公开的 credits 余额查询 API，此处调用 /models 校验 Key。
 * 账户余额请在 together.ai 控制台查看。
 */
export const togetherAdapter = createKeyCheckAdapter({
  provider: "together",
  label: "Together AI",
  description: "开源模型推理。无公开余额 API，仅校验 Key 有效性（credits 见控制台）",
  checkUrl: `${BASE}/models`,
  authHeaders: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  errorName: "Together",
});
