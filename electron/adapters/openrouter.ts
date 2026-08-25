import type { Adapter, BalanceResult } from "../types";
import { fetchWithTimeout } from "../lib/http";

interface CreditsResponse {
  data: {
    total_credits: number;
    total_usage: number;
  };
}

/** OpenRouter 适配器，提供明确的余额接口（total/used/remaining） */
export const openrouterAdapter: Adapter = {
  definition: {
    provider: "openrouter",
    label: "OpenRouter",
    kind: "api",
    official: true,
    description: "聚合多家模型，支持余额查询",
    configSchema: [
      {
        key: "apiKey",
        label: "API Key",
        type: "password",
        placeholder: "sk-or-...",
        required: true,
      },
    ],
  },

  async fetchBalance(_config, secrets): Promise<BalanceResult> {
    const apiKey = secrets.apiKey;
    if (!apiKey) throw new Error("缺少 API Key");
    const res = await fetchWithTimeout("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as CreditsResponse;
    const total = json.data.total_credits;
    const used = json.data.total_usage;
    return {
      total,
      used,
      remaining: total - used,
      currency: "USD",
      fetchedAt: new Date().toISOString(),
      raw: json,
    };
  },
};
