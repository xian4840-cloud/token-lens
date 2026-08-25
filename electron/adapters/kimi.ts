import type { Adapter, BalanceResult } from "../types";
import { fetchWithTimeout } from "../lib/http";

const BASE = "https://api.moonshot.cn/v1";

interface BalanceResponse {
  code?: number;
  data?: Record<string, unknown>;
  available_balance?: number;
  balance?: number;
}

/** 从对象中按优先级取首个数值字段 */
function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

/**
 * Kimi（月之暗面 Moonshot）适配器。
 * Moonshot 兼容 OpenAI 格式，额外提供 /users/me/balance 查询余额。
 * 字段名（available_balance 等）需实测，此处多字段兜底。
 */
export const kimiAdapter: Adapter = {
  definition: {
    provider: "kimi",
    label: "Kimi (Moonshot)",
    kind: "api",
    official: true,
    description: "月之暗面 Kimi。查询账户可用余额",
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
    const headers = { Authorization: `Bearer ${apiKey}` };

    // 余额端点（路径需实测，字段多兜底）
    const res = await fetchWithTimeout(`${BASE}/users/me/balance`, { headers });
    if (res.ok) {
      const json = (await res.json()) as BalanceResponse;
      const data = json.data ?? {};
      const remaining =
        pickNumber(data, ["available_balance", "availableBalance", "balance"]) ??
        pickNumber(json as Record<string, unknown>, ["available_balance", "availableBalance", "balance"]);
      if (remaining != null) {
        return {
          remaining,
          currency: "CNY",
          fetchedAt: new Date().toISOString(),
          raw: json,
        };
      }
    }

    // fallback：余额端点不可用或字段取不到时，退化为校验 key。
    // 此时无数字可展示，须给出 statusLabel 说明原因，否则卡片只剩一句无解释的兜底文案。
    const modelRes = await fetchWithTimeout(`${BASE}/models`, { headers });
    if (!modelRes.ok) {
      const text = await modelRes.text();
      throw new Error(`Kimi ${modelRes.status}: ${text.slice(0, 200)}`);
    }
    return {
      currency: "CNY",
      statusLabel: "Key 有效（余额未取到）",
      fetchedAt: new Date().toISOString(),
    };
  },
};
