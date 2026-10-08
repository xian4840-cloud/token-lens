import type { Adapter, BalanceResult, UsageResult } from "../types";
import { fetchWithTimeout } from "../lib/http";
import { toFiniteNumber } from "../lib/amount";

const BASE = "https://api.openai.com/v1/organization";

/**
 * costs 接口的一个时间桶。
 *
 * 结构以官方文档为准（GET /organization/costs）：
 *   { object: "page",
 *     data: [ { object: "bucket", start_time, end_time,
 *               results: [ { object: "organization.costs.result",
 *                            amount: { value: 0.06, currency: "usd" },
 *                            line_item, project_id, model } ] } ],
 *     has_more, next_page }
 *
 * 两个容易写错的点：data 是**时间桶数组**（桶内含 results），
 * 以及金额是嵌套的 amount.value 而不是结果对象上的裸 cost。
 * 此前按 { data: { data: [...] } } 解析，取到的恒为 undefined，
 * 经 ?? [] 落成空数组——于是不管实际花了多少，卡片一律显示 $0。
 */
interface CostsBucket {
  results?: Array<{
    /** 请求带 group_by[]=model 时才有 */
    model?: string;
    line_item?: string | null;
    amount?: { value?: number; currency?: string };
  }>;
}

interface CostsResponse {
  object?: string;
  data?: CostsBucket[];
  has_more?: boolean;
  next_page?: string | null;
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

/**
 * 跨时间桶按模型汇总花费。
 *
 * 必须按模型再聚合一次：同一个月内每个模型会出现在多个时间桶里，
 * 逐桶列出会在用量明细里出现大量同名的重复行。
 *
 * data 不是数组时抛可读错误而不是返回 0：返回 0 会让卡片显示
 * 「本月累计花费 $0.00」——一个用户无从分辨真假的静默错误答案。
 */
function sumCosts(json: CostsResponse): { model: string; cost: number }[] {
  const buckets = json?.data;
  if (!Array.isArray(buckets)) {
    throw new Error("OpenAI costs 响应缺少 data 数组（接口可能已变更）");
  }

  const byModel = new Map<string, number>();
  for (const bucket of buckets) {
    for (const r of bucket?.results ?? []) {
      const cost = toFiniteNumber(r?.amount?.value);
      if (cost == null) continue;
      const key =
        typeof r?.model === "string" && r.model.trim() ? r.model : (r?.line_item ?? "未分组");
      byModel.set(key, (byModel.get(key) ?? 0) + cost);
    }
  }
  return [...byModel.entries()].map(([model, cost]) => ({ model, cost }));
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
