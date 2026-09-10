import type { Adapter, BalanceResult } from "../types";
import { fetchWithTimeout } from "../lib/http";
import { toFiniteNumber } from "../lib/amount";

interface DeepSeekBalanceResponse {
  balance_infos: Array<{
    currency: string;
    total_balance: string;
    granted_balance: string;
    topped_up_balance: string;
  }>;
}

/** DeepSeek 适配器，提供余额查询（/user/balance） */
export const deepseekAdapter: Adapter = {
  definition: {
    provider: "deepseek",
    label: "DeepSeek",
    kind: "api",
    official: true,
    description: "DeepSeek 官方，支持余额查询",
    configSchema: [
      {
        key: "apiKey",
        label: "API Key",
        type: "password",
        placeholder: "sk-...",
        required: true,
      },
    ],
  },

  async fetchBalance(_config, secrets): Promise<BalanceResult> {
    const apiKey = secrets.apiKey;
    if (!apiKey) throw new Error("缺少 API Key");
    const res = await fetchWithTimeout("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as DeepSeekBalanceResponse;
    const info = json.balance_infos?.[0];
    // 用 toFiniteNumber 而非 Number()：字段缺失时 Number(undefined) 是 NaN，
    // 会一路带进界面（卡片显示 "-"，副行却写「该服务无余额查询 API」，
    // 而 DeepSeek 是有余额接口的）。取不到就当没有。
    const total = toFiniteNumber(info?.total_balance);
    return {
      total,
      remaining: total,
      currency: info?.currency ?? "CNY",
      fetchedAt: new Date().toISOString(),
      raw: json,
    };
  },
};
