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

    // 余额端点（路径需实测，字段多兜底）。
    //
    // 整段包 try：这个端点实测连接成功率不稳定（同一时段四次里三次
    // ConnectTimeout、一次正常 200），而 /models 端点始终可达。
    // 不捕获的话网络异常会直接冒出去，连下面的 fallback 都进不了，
    // 用户看到的就是一句「TypeError: fetch failed」——余额和 Key 状态全没了。
    // 把失败原因留到 statusLabel 里，比整张卡报错有用。
    let balanceError: string | undefined;
    try {
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
        balanceError = "余额字段未取到";
      } else {
        balanceError = `余额接口 ${res.status}`;
      }
    } catch {
      // 具体原因由 scheduler / ipc 那层记进日志，这里只需知道「没取到」
      balanceError = "余额接口连接失败";
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
      // 带上具体原因：「余额未取到」太笼统，用户分不清是自己没充值
      // 还是接口没通，也就无从判断该不该重试
      statusLabel: `Key 有效（${balanceError ?? "余额未取到"}）`,
      fetchedAt: new Date().toISOString(),
    };
  },
};
