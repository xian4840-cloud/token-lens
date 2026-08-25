import type { Adapter, BalanceResult, UsageResult } from "../types";
import { fetchWithTimeout } from "../lib/http";

const BASE = "https://api.openai.com/v1/organization";

interface CostsResponse {
  data?: {
    object: string;
    data: Array<{
      object: string;
      line_item: string;
      model: string;
      results: Array<{ name: string; cost: number }>;
    }>;
  };
}

/** 当前自然月的 unix 起止（秒） */
function monthRange(): { start: number; end: number } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    start: Math.floor(start.getTime() / 1000),
    end: Math.floor(now.getTime() / 1000),
  };
}

function buildHeaders(
  config: Record<string, unknown>,
  secrets: Record<string, string>,
): Record<string, string> {
  const apiKey = secrets.apiKey;
  if (!apiKey) throw new Error("缺少 API Key");
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  const orgId = config.orgId as string | undefined;
  if (orgId) headers["OpenAI-Organization"] = orgId;
  return headers;
}

async function fetchCosts(
  config: Record<string, unknown>,
  secrets: Record<string, string>,
  start: number,
  end: number,
): Promise<CostsResponse> {
  const url = `${BASE}/costs?start_time=${start}&end_time=${end}&group_by[]=model&limit=100`;
  const res = await fetchWithTimeout(url, { headers: buildHeaders(config, secrets) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as CostsResponse;
}

function sumCosts(json: CostsResponse): { model: string; cost: number }[] {
  const items = json?.data?.data ?? [];
  return items.map((it) => ({
    model: it.model,
    cost: it.results.reduce((sum, r) => sum + (r?.cost ?? 0), 0),
  }));
}

/**
 * OpenAI 适配器。
 * 注意：OpenAI 不提供公开的 prepaid 余额查询 API，此处用 organization/costs
 * 展示本月用量成本（used）。需具备组织管理员权限的 key。
 */
export const openaiAdapter: Adapter = {
  definition: {
    provider: "openai",
    label: "OpenAI",
    kind: "api",
    official: true,
    description: "GPT 系列。展示本月用量成本（OpenAI 无公开余额 API）",
    supportsUsage: true,
    configSchema: [
      {
        key: "apiKey",
        label: "API Key",
        type: "password",
        placeholder: "sk-...",
        required: true,
        help: "需组织管理员权限的 key 才能查询成本",
      },
      {
        key: "orgId",
        label: "组织 ID（可选）",
        type: "string",
        placeholder: "org-...",
        help: "账号下有多个组织时填写",
      },
    ],
  },

  async fetchBalance(config, secrets): Promise<BalanceResult> {
    const { start, end } = monthRange();
    const json = await fetchCosts(config, secrets, start, end);
    const used = sumCosts(json).reduce((s, it) => s + it.cost, 0);
    return {
      used,
      currency: "USD",
      fetchedAt: new Date().toISOString(),
      raw: json,
    };
  },

  async fetchUsage(config, secrets, period): Promise<UsageResult> {
    const start = Math.floor(new Date(period.start).getTime() / 1000);
    const end = Math.floor(new Date(period.end).getTime() / 1000);
    const json = await fetchCosts(config, secrets, start, end);
    const items = sumCosts(json).map((it) => ({
      model: it.model,
      cost: it.cost,
    }));
    return {
      items,
      periodStart: period.start,
      periodEnd: period.end,
      currency: "USD",
      fetchedAt: new Date().toISOString(),
    };
  },
};
