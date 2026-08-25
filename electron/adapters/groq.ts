import type { Adapter, BalanceResult } from "../types";
import { fetchWithTimeout } from "../lib/http";

const BASE = "https://api.groq.com/openai/v1";

/**
 * Groq 适配器。
 * Groq 提供免费速率限制的推理服务，无公开的余额/配额查询 API。
 * 此处调用 /models 校验 API Key 有效性，不返回余额数字。
 */
export const groqAdapter: Adapter = {
  definition: {
    provider: "groq",
    label: "Groq",
    kind: "api",
    official: true,
    description: "免费服务（按速率限制），无余额 API，仅校验 Key 有效性",
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
    return {
      currency: "USD",
      fetchedAt: new Date().toISOString(),
    };
  },
};
