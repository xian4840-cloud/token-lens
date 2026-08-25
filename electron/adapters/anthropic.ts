import type { Adapter, BalanceResult, UsageItem, UsageResult } from "../types";
import { fetchWithTimeout } from "../lib/http";
import { computeAnthropicCost } from "./pricing";

const BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

interface OrgListResponse {
  data?: Array<{ id: string; name?: string }>;
}

interface UsageReportRow {
  date: string;
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface UsageReportResponse {
  data?: UsageReportRow[];
}

function buildHeaders(secrets: Record<string, string>): Record<string, string> {
  const apiKey = secrets.apiKey;
  if (!apiKey) throw new Error("缺少 Admin API Key");
  return {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

/** YYYY-MM-DD（Anthropic usage_reports 路径参数格式） */
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 获取组织 ID：配置未填则自动取账号下首个组织 */
async function getOrgId(
  config: Record<string, unknown>,
  secrets: Record<string, string>,
): Promise<string> {
  const orgId = config.organizationId as string | undefined;
  if (orgId) return orgId;
  const res = await fetchWithTimeout(`${BASE}/organizations`, {
    headers: buildHeaders(secrets),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic 获取组织列表 ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as OrgListResponse;
  const first = json.data?.[0];
  if (!first?.id) {
    throw new Error("未找到组织，请在配置中填写组织 ID");
  }
  return first.id;
}

async function fetchReport(
  config: Record<string, unknown>,
  secrets: Record<string, string>,
  start: string,
  end: string,
): Promise<UsageReportResponse> {
  const orgId = await getOrgId(config, secrets);
  const url = `${BASE}/organizations/${orgId}/usage_reports/messages/${start}/${end}`;
  const res = await fetchWithTimeout(url, { headers: buildHeaders(secrets) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as UsageReportResponse;
}

function sumTokens(rows: UsageReportRow[] | undefined): number {
  return (rows ?? []).reduce(
    (sum, r) => sum + (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
    0,
  );
}

function groupByModel(rows: UsageReportRow[] | undefined): UsageItem[] {
  const map = new Map<
    string,
    { input: number; output: number; cacheCreation: number; cacheRead: number }
  >();
  for (const r of rows ?? []) {
    const cur = map.get(r.model) ?? {
      input: 0,
      output: 0,
      cacheCreation: 0,
      cacheRead: 0,
    };
    cur.input += r.input_tokens ?? 0;
    cur.output += r.output_tokens ?? 0;
    cur.cacheCreation += r.cache_creation_input_tokens ?? 0;
    cur.cacheRead += r.cache_read_input_tokens ?? 0;
    map.set(r.model, cur);
  }
  return Array.from(map.entries()).map(([model, v]) => {
    const promptTokens = v.input + v.cacheCreation + v.cacheRead;
    return {
      model,
      promptTokens,
      completionTokens: v.output,
      totalTokens: promptTokens + v.output,
      cost: computeAnthropicCost(model, v),
    };
  });
}

/**
 * Anthropic 适配器。
 * Claude 系列为后付费，无 prepaid 余额。此处通过 Admin API 的 usage_reports
 * 汇总当月 token 用量展示（需 Admin API Key，普通 sk-ant- 无法访问）。
 */
export const anthropicAdapter: Adapter = {
  definition: {
    provider: "anthropic",
    label: "Anthropic",
    kind: "api",
    official: true,
    description: "Claude 系列。后付费无余额；展示本月 token 用量（需 Admin API Key）",
    supportsUsage: true,
    configSchema: [
      {
        key: "apiKey",
        label: "Admin API Key",
        type: "password",
        placeholder: "sk-ant-admin...",
        required: true,
        help: "需 Admin API Key（普通 sk-ant- 无法查询用量）",
      },
      {
        key: "organizationId",
        label: "组织 ID（可选）",
        type: "string",
        placeholder: "组织 UUID",
        help: "不填则自动使用账号下首个组织",
      },
    ],
  },

  async fetchBalance(config, secrets): Promise<BalanceResult> {
    const now = new Date();
    const start = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1));
    const end = fmtDate(now);
    const json = await fetchReport(config, secrets, start, end);
    return {
      used: sumTokens(json.data),
      currency: "tokens",
      fetchedAt: new Date().toISOString(),
      raw: json,
    };
  },

  async fetchUsage(config, secrets, period): Promise<UsageResult> {
    const start = fmtDate(new Date(period.start));
    const end = fmtDate(new Date(period.end));
    const json = await fetchReport(config, secrets, start, end);
    return {
      items: groupByModel(json.data),
      periodStart: period.start,
      periodEnd: period.end,
      currency: "USD",
      fetchedAt: new Date().toISOString(),
    };
  },
};
