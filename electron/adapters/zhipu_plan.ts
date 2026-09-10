import type { Adapter, BalanceResult, BreakdownItem } from "../types";
import {
  API_KEY_FIELD,
  REGION_FIELD,
  fetchZhipuJson,
  pickNumber,
  resolveZhipuBase,
  type ZhipuEnvelope,
} from "./zhipu-common";

interface QuotaLimit {
  type?: string;
  unit?: number;
  number?: number;
  usage?: number;
  currentValue?: number;
  remaining?: number;
  percentage?: number;
  nextResetTime?: number;
  [key: string]: unknown;
}

interface ParsedWindow {
  kind: "tokens" | "mcp";
  label: string;
  used?: number;
  total?: number;
  remaining?: number;
  unit: string;
  resetAt?: string;
  durationMin: number;
}

const PLAN_LEVEL_LABEL: Record<string, string> = {
  lite: "Lite",
  pro: "Pro",
  max: "Max",
  standard: "团队标准版",
  enterprise: "团队高级版",
  team: "团队版",
};

/**
 * unit 取值来自社区对 /api/monitor/usage/quota/limit 的实测：
 * 3 = 小时，5 = 月，6 = 天。number 是该单位的数量（5 小时、7 天、1 月）。
 */
function durationMinutes(limit: QuotaLimit): number {
  const n = Number(limit.number);
  const count = Number.isFinite(n) && n > 0 ? n : 1;
  switch (Number(limit.unit)) {
    case 3:
      return count * 60;
    case 4:
      return count;
    case 5:
      return count * 43_200;
    case 6:
      return count * 1_440;
    default:
      return Number.POSITIVE_INFINITY;
  }
}

function windowLabel(limit: QuotaLimit, durationMin: number): string {
  if (durationMin <= 6 * 60) return "5小时";
  if (durationMin <= 8 * 24 * 60) return "每周";
  if (Number.isFinite(durationMin)) return "每月";
  if (limit.nextResetTime) {
    const ms = Number(limit.nextResetTime) - Date.now();
    if (Number.isFinite(ms)) {
      if (ms <= 6 * 3600_000) return "5小时";
      if (ms <= 8 * 24 * 3600_000) return "每周";
    }
  }
  return "配额";
}

function resetIso(limit: QuotaLimit): string | undefined {
  const t = Number(limit.nextResetTime);
  if (!Number.isFinite(t) || t <= 0) return undefined;
  const ms = t < 1e12 ? t * 1000 : t;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function readLimit(raw: Record<string, unknown>): QuotaLimit {
  return {
    type: typeof raw.type === "string" ? raw.type : undefined,
    unit: pickNumber(raw, ["unit"]),
    number: pickNumber(raw, ["number"]),
    usage: pickNumber(raw, ["usage"]),
    currentValue: pickNumber(raw, ["currentValue", "current_value"]),
    remaining: pickNumber(raw, ["remaining"]),
    percentage: pickNumber(raw, ["percentage", "percent"]),
    nextResetTime: pickNumber(raw, ["nextResetTime", "next_reset_time"]),
  };
}

/**
 * 把一条 limit 转成卡片能用的 used/total/remaining。
 *
 * 优先用 usage（总量）+ currentValue/remaining 的绝对计数；
 * 只有百分比时退回 100 分制，好画进度条。
 */
export function measureLimit(limit: QuotaLimit): {
  used?: number;
  total?: number;
  remaining?: number;
  unit: string;
} | undefined {
  const isMcp = limit.type === "TIME_LIMIT";
  const countUnit = isMcp ? "次" : "tokens";
  const total = limit.usage;
  const current = limit.currentValue;
  const remaining = limit.remaining;

  if (total != null && total > 0 && (current != null || remaining != null)) {
    const used = current ?? Math.max(0, total - (remaining ?? 0));
    const rem = remaining ?? Math.max(0, total - used);
    return { used, total, remaining: rem, unit: countUnit };
  }
  if (limit.percentage != null && Number.isFinite(limit.percentage)) {
    const pct = Math.min(100, Math.max(0, limit.percentage));
    return {
      used: pct,
      total: 100,
      remaining: Math.max(0, 100 - pct),
      unit: "%",
    };
  }
  return undefined;
}

function parseLimitsArray(data: unknown): QuotaLimit[] {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
  const raw = root?.limits;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map(readLimit);
}

export function planLevelLabel(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const obj = data as Record<string, unknown>;
  for (const k of ["planName", "plan_name", "productName", "packageName", "plan", "plan_type", "level"]) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) {
      const key = v.trim().toLowerCase();
      return PLAN_LEVEL_LABEL[key] ?? v.trim();
    }
  }
  return undefined;
}

/** 从 quota/limit 响应拆出 5 小时 / 每周 / MCP 窗口 */
export function parseQuotaLimits(envelope: ZhipuEnvelope): {
  level?: string;
  windows: ParsedWindow[];
} {
  const data = envelope.data;
  const level = planLevelLabel(data);
  const limits = parseLimitsArray(data);
  const windows: ParsedWindow[] = [];

  const tokenish = limits.filter(
    (l) => l.type === "TOKENS_LIMIT" || l.type === "CREDIT_LIMIT" || l.type == null,
  );
  const mcp = limits.filter((l) => l.type === "TIME_LIMIT");

  const tokenWindows: ParsedWindow[] = [];
  for (const limit of tokenish) {
    const measured = measureLimit(limit);
    if (!measured) continue;
    const durationMin = durationMinutes(limit);
    tokenWindows.push({
      kind: "tokens",
      label: windowLabel(limit, durationMin),
      ...measured,
      resetAt: resetIso(limit),
      durationMin,
    });
  }
  tokenWindows.sort((a, b) => a.durationMin - b.durationMin);
  // 同标签只留更短的那个（5小时优先于每周），避免重复「配额」
  const seen = new Set<string>();
  for (const w of tokenWindows) {
    if (seen.has(w.label)) continue;
    seen.add(w.label);
    windows.push(w);
  }

  for (const limit of mcp) {
    const measured = measureLimit(limit);
    if (!measured) continue;
    windows.push({
      kind: "mcp",
      label: "MCP / 工具",
      ...measured,
      resetAt: resetIso(limit),
      durationMin: durationMinutes(limit),
    });
  }

  return { level, windows };
}

function toBreakdown(windows: ParsedWindow[], level?: string): BreakdownItem[] {
  return windows.map((w, i) => ({
    label: i === 0 && level ? `${level} · ${w.label}` : w.label,
    used: w.used,
    total: w.total,
    remaining: w.remaining,
    unit: w.unit,
    resetAt: w.resetAt,
  }));
}

/**
 * 智谱 GLM Coding Plan 适配器。
 *
 * 套餐余量走控制台同款接口 GET /api/monitor/usage/quota/limit（API Key 即可，
 * 不必抓 cookie）。limits[]：
 * - TOKENS_LIMIT unit=3 → 5 小时滚动窗口
 * - TOKENS_LIMIT unit=6 → 每周窗口
 * - TIME_LIMIT → MCP / 联网搜索等次数
 *
 * 未订阅套餐时 limits 为空，提示去用「智谱 GLM」查按量余额，避免显示成 0。
 */
export const zhipuPlanAdapter: Adapter = {
  definition: {
    provider: "zhipu_plan",
    label: "智谱 GLM Coding Plan",
    kind: "plan",
    official: true,
    description:
      "GLM Coding Plan 套餐余量（5 小时 / 每周 / MCP）。填开放平台 API Key，国内国际分区选对",
    configSchema: [API_KEY_FIELD, REGION_FIELD],
  },

  async fetchBalance(config, secrets): Promise<BalanceResult> {
    const apiKey = secrets.apiKey;
    if (!apiKey) throw new Error("缺少 API Key");
    const base = resolveZhipuBase(config);
    const fetchedAt = new Date().toISOString();

    const [quota, sub] = await Promise.allSettled([
      fetchZhipuJson(`${base}/api/monitor/usage/quota/limit`, apiKey),
      fetchZhipuJson(`${base}/api/biz/subscription/list`, apiKey),
    ]);

    if (quota.status === "rejected") {
      throw quota.reason instanceof Error
        ? quota.reason
        : new Error(String(quota.reason));
    }

    const parsed = parseQuotaLimits(quota.value);
    const subName =
      sub.status === "fulfilled" ? pickSubscriptionName(sub.value) : undefined;
    const level = parsed.level ?? subName;

    if (parsed.windows.length === 0) {
      return {
        currency: "%",
        statusLabel: level
          ? `${level}（暂无配额数据）`
          : "Key 有效（未订阅 Coding Plan 或暂无配额）",
        fetchedAt,
        raw: quota.value,
      };
    }

    const primary = parsed.windows[0];
    const breakdown = toBreakdown(parsed.windows, level);

    return {
      remaining: primary.remaining,
      used: primary.used,
      total: primary.total,
      currency: primary.unit,
      expiresAt: primary.resetAt,
      fetchedAt,
      raw: quota.value,
      breakdown: breakdown.length > 1 ? breakdown : undefined,
    };
  },
};

function pickSubscriptionName(envelope: ZhipuEnvelope): string | undefined {
  const data = envelope.data;
  const list = Array.isArray(data) ? data : [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const status = String(row.status ?? "").toUpperCase();
    if (status && status !== "VALID" && status !== "ACTIVE") continue;
    const name = row.productName ?? row.planName ?? row.name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  const first = list[0];
  if (first && typeof first === "object") {
    const name = (first as Record<string, unknown>).productName;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return undefined;
}
