import { createKeyCheckAdapter } from "./key-check";

const BASE = "https://api.groq.com/openai/v1";

/**
 * Groq 适配器。
 * 无公开的余额 / 配额查询 API，用量与限额需在 GroqCloud 控制台查看。
 * 此处调用 /models 校验 API Key 有效性，不返回余额数字。
 * 注意：Groq 同时存在免费档与付费档（on-demand），故不在文案里断言「免费服务」。
 */
export const groqAdapter = createKeyCheckAdapter({
  provider: "groq",
  label: "Groq",
  description: "无余额 / 配额查询 API，仅校验 Key 有效性（用量见 GroqCloud 控制台）",
  placeholder: "gsk_...",
  checkUrl: `${BASE}/models`,
  authHeaders: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  errorName: "Groq",
});
