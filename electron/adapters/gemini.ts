import type { Adapter, BalanceResult } from "../types";
import { fetchWithTimeout } from "../lib/http";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Google Gemini（AI Studio）适配器。
 * AI Studio 的 API Key 无法查询余额或用量（免费额度需在 Google AI Studio 控制台查看）。
 * 此处调用 /models 校验 API Key 有效性，不返回余额数字。
 */
export const geminiAdapter: Adapter = {
  definition: {
    provider: "gemini",
    label: "Google Gemini",
    kind: "api",
    official: true,
    description: "AI Studio 免费额度，无余额 API，仅校验 Key 有效性",
    configSchema: [
      {
        key: "apiKey",
        label: "API Key",
        type: "password",
        placeholder: "AIza...",
        required: true,
      },
    ],
  },

  async fetchBalance(_config, secrets): Promise<BalanceResult> {
    const apiKey = secrets.apiKey;
    if (!apiKey) throw new Error("缺少 API Key");
    const res = await fetchWithTimeout(`${BASE}/models?key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`);
    }
    return {
      currency: "USD",
      fetchedAt: new Date().toISOString(),
    };
  },
};
