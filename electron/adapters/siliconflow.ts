import type { Adapter, BalanceResult } from "../types";
import { fetchWithTimeout } from "../lib/http";

interface SiliconFlowUserResponse {
  data: {
    id: string;
    name: string;
    balance: string;
  };
}

/** 硅基流动（SiliconFlow）适配器，提供余额查询（/v1/user/info） */
export const siliconflowAdapter: Adapter = {
  definition: {
    provider: "siliconflow",
    label: "硅基流动",
    kind: "api",
    official: true,
    description: "SiliconFlow，支持余额查询",
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
    const res = await fetchWithTimeout("https://api.siliconflow.cn/v1/user/info", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`硅基流动 ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as SiliconFlowUserResponse;
    const total = Number(json.data?.balance);
    return {
      total,
      remaining: total,
      currency: "USD",
      fetchedAt: new Date().toISOString(),
      raw: json,
    };
  },
};
