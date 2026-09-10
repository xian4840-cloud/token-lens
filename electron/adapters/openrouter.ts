import type { Adapter, BalanceResult } from "../types";
import { fetchWithTimeout } from "../lib/http";
import { toFiniteNumber } from "../lib/amount";

/**
 * 字段类型按「接口可能返回什么」写，而不是按「我们希望它返回什么」写：
 * 标成 string | number 是因为这类网关的数字类型并不稳定，标成可选是因为
 * 响应可能整个缺字段。运行时校验另有一道（见 fetchBalance）。
 */
interface CreditsResponse {
  data?: {
    total_credits?: string | number;
    total_usage?: string | number;
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
    // 逐字段取数，并给结构异常一个可读的失败。
    //
    // 此前直接解 json.data.total_credits：响应一旦不合预期（字段改名、返回错误
    // 信封而非余额、中间插了一层网关），用户看到的是
    // 「TypeError: Cannot read properties of undefined (reading 'total_credits')」，
    // 一句对排查毫无帮助的英文。同族的 deepseek / kimi 都有兜底。
    const data = json?.data;
    if (!data || typeof data !== "object") {
      throw new Error("OpenRouter 响应缺少 data 字段（接口可能已变更）");
    }

    const total = toFiniteNumber(data.total_credits);
    const used = toFiniteNumber(data.total_usage);
    return {
      total,
      used,
      // 两个数都在时才推算剩余：缺一个就什么都不给，而不是给出 NaN
      remaining: total != null && used != null ? total - used : undefined,
      currency: "USD",
      fetchedAt: new Date().toISOString(),
      raw: json,
    };
  },
};
