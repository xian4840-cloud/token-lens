import type { Adapter, BalanceResult } from "../types";
import { fetchWithTimeout } from "../lib/http";

const BASE = "https://api.together.xyz/v1";

/**
 * Together AI 适配器。
 * Together 未提供公开的 credits 余额查询 API，此处调用 /models 校验 Key。
 * 账户余额请在 together.ai 控制台查看。
 */
export const togetherAdapter: Adapter = {
  definition: {
    provider: "together",
    label: "Together AI",
    kind: "api",
    official: true,
    description: "开源模型推理。无公开余额 API，仅校验 Key（credits 见控制台）",
    configSchema: [
      {
        key: "apiKey",
        label: "API Key",
        type: "password",
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
      throw new Error(`Together ${res.status}: ${text.slice(0, 200)}`);
    }
    return {
      currency: "USD",
      fetchedAt: new Date().toISOString(),
    };
  },
};
