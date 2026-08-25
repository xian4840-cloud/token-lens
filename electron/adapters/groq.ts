import type { Adapter, BalanceResult } from "../types";
import { fetchWithTimeout } from "../lib/http";

const BASE = "https://api.groq.com/openai/v1";

/**
 * Groq 适配器。
 * 无公开的余额 / 配额查询 API，用量与限额需在 GroqCloud 控制台查看。
 * 此处调用 /models 校验 API Key 有效性，不返回余额数字。
 * 注意：Groq 同时存在免费档与付费档（on-demand），故不在文案里断言「免费服务」。
 */
export const groqAdapter: Adapter = {
  definition: {
    provider: "groq",
    label: "Groq",
    kind: "api",
    official: true,
    description: "无余额 / 配额查询 API，仅校验 Key 有效性（用量见 GroqCloud 控制台）",
    configSchema: [
      {
        key: "apiKey",
        label: "API Key",
        type: "password",
        placeholder: "gsk_...",
        required: true,
      },
    ],
  },

  async fetchBalance(_config, secrets): Promise<BalanceResult> {
    const apiKey = secrets.apiKey;
    if (!apiKey) throw new Error("缺少 API Key");
    const res = await fetchWithTimeout(`${BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Groq ${res.status}: ${text.slice(0, 200)}`);
    }
    // 无任何数字可返回，只能告知 Key 通过校验
    return {
      currency: "USD",
      statusLabel: "Key 有效",
      fetchedAt: new Date().toISOString(),
    };
  },
};
