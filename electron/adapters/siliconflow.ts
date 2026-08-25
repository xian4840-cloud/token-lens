import type { Adapter, BalanceResult } from "../types";
import { fetchWithTimeout } from "../lib/http";

interface SiliconFlowUserResponse {
  data: {
    id: string;
    name: string;
    /** 赠费余额，字符串形态，如 "0.88" */
    balance?: string;
    /** 充值余额，字符串形态，如 "88.00" */
    chargeBalance?: string;
    /** 可用总额 = 赠费 + 充值，字符串形态，如 "88.88" */
    totalBalance?: string;
  };
}

/**
 * 从 /v1/user/info 的返回里取「实际可用余额」。
 *
 * 三个字段都是**字符串**（官方文档示例 balance:"0.88" / chargeBalance:"88.00"
 * / totalBalance:"88.88"），必须 Number() 转换。
 *
 * 取 totalBalance 而非 balance：balance 只是赠费余额。此前读 balance，
 * 导致充值 ¥88 的账号在卡片上显示 0.88，是实打实的数值错误。
 * totalBalance 缺失时退回 balance + chargeBalance 自行求和，
 * 两者都取不到才返回 undefined（让卡片显示占位符而不是 NaN）。
 */
export function pickBalance(
  data: SiliconFlowUserResponse["data"] | undefined,
): number | undefined {
  if (!data) return undefined;
  const total = Number(data.totalBalance);
  if (Number.isFinite(total)) return total;
  // 注意 Number(undefined) 是 NaN 而 Number("") 是 0，故逐个校验后再相加
  const gift = Number(data.balance);
  const charge = Number(data.chargeBalance);
  const parts = [gift, charge].filter((n) => Number.isFinite(n));
  if (parts.length === 0) return undefined;
  return parts.reduce((sum, n) => sum + n, 0);
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
    const total = pickBalance(json.data);
    return {
      total,
      remaining: total,
      // 国内站（api.siliconflow.cn）以人民币计价，官网价目表通篇为 ¥。
      // 国际站是 siliconflow.com 并以 $ 计价，若将来支持国际站需按 baseUrl 区分。
      currency: "CNY",
      fetchedAt: new Date().toISOString(),
      raw: json,
    };
  },
};
