import { ALL_LOCAL_SOURCES, type LocalSource } from "../local-usage/types";
import type { PetSourceSpend, PetSpendSummary } from "./types";

/**
 * 与 ui/src/lib/local-sources.ts 的展示名保持一致，改动需同步。
 * 写成 Record<LocalSource, string> 而非裸数组：新增来源时这里不补会编译报错。
 */
const SOURCE_LABEL: Record<LocalSource, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  "grok-build": "Grok Build",
};

/** 花费汇总用的最小行。不绑 LocalDailyUsageRecord，方便单测。 */
export interface SpendRow {
  source: LocalSource;
  date: string;
  cost: number | null;
  currency: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
}

/** 与用量页同一口径：含缓存读取一次（input 已拆过，不重复） */
export function rowTokens(row: SpendRow): number {
  return (
    row.inputTokens +
    row.outputTokens +
    row.cacheCreationTokens +
    row.cacheReadTokens +
    row.reasoningTokens
  );
}

/**
 * 按日期汇总本地 agent 花费。
 * cost 只加能换算出的行；未知价格的用量计 tokens 并标 unpriced，不把未知当成 0。
 */
export function summarizeLocalSpend(
  rows: SpendRow[],
  date: string,
): PetSpendSummary {
  const groups = new Map<
    LocalSource,
    { tokens: number; cost: number; priced: boolean; unpriced: boolean }
  >();

  let currency = "USD";
  for (const row of rows) {
    if (row.date !== date) continue;
    const tokens = rowTokens(row);
    const prev = groups.get(row.source) ?? {
      tokens: 0,
      cost: 0,
      priced: false,
      unpriced: false,
    };
    prev.tokens += tokens;
    if (row.cost != null && Number.isFinite(row.cost)) {
      prev.cost += row.cost;
      prev.priced = true;
      if (row.currency) currency = row.currency;
    } else if (tokens > 0) {
      prev.unpriced = true;
    }
    groups.set(row.source, prev);
  }

  const bySource: PetSourceSpend[] = [];
  let totalCost = 0;
  let anyPriced = false;
  let hasUnpriced = false;
  let tokens = 0;

  for (const source of ALL_LOCAL_SOURCES) {
    const g = groups.get(source);
    if (!g) continue;
    tokens += g.tokens;
    if (g.priced) {
      totalCost += g.cost;
      anyPriced = true;
    }
    if (g.unpriced) hasUnpriced = true;
    bySource.push({
      source,
      label: SOURCE_LABEL[source],
      cost: g.priced ? g.cost : null,
      tokens: g.tokens,
      unpriced: g.unpriced,
    });
  }

  return {
    date,
    cost: anyPriced ? totalCost : null,
    currency,
    tokens,
    bySource,
    hasUnpriced,
  };
}
