import { scanClaudeCode } from "./claude-code";
import { scanCodex } from "./codex";
import { scanOpenCode } from "./opencode";
import { scanAntigravity } from "./antigravity";
import { scanGrokBuild } from "./grok-build";
import { persistScanCache } from "./cache";
import { computeCost, parseOverrides, type TokenUsage } from "../adapters/pricing";
import { getSetting, upsertLocalDailyUsage } from "../db";
import type { LocalSource, LocalUsageRow, ScanLocalUsageResult } from "./types";

/**
 * 按 source 构造 computeCost 用的 TokenUsage，处理各 agent 的 token 语义差异：
 * - Codex：input_tokens 已含 cached_input_tokens（OpenAI 习惯），拆分避免双计；
 *   reasoning_output_tokens 按 output 价计费。
 * - Claude Code：input_tokens 不含 cache_read（Anthropic 语义），直接用。
 * - Antigravity：thinking tokens（field 10）按 output 价计费，与可见输出合并。
 * - Grok Build：与 Codex 同为 OpenAI 语义（input 含 cache_read）；
 *   存储时已把 reasoning 从 output 拆出，此处合并回去按 output 价计费。
 */
function toCostTokens(row: LocalUsageRow): TokenUsage {
  if (row.source === "codex" || row.source === "grok-build") {
    return {
      input: Math.max(0, row.inputTokens - row.cacheReadTokens),
      output: row.outputTokens + row.reasoningTokens,
      cacheRead: row.cacheReadTokens,
      cacheCreation: row.cacheCreationTokens,
    };
  }
  if (row.source === "antigravity") {
    return {
      input: row.inputTokens,
      output: row.outputTokens + row.reasoningTokens,
      cacheRead: 0,
      cacheCreation: 0,
    };
  }
  return {
    input: row.inputTokens,
    output: row.outputTokens,
    cacheRead: row.cacheReadTokens,
    cacheCreation: row.cacheCreationTokens,
  };
}

/**
 * 扫描本地五家 agent，按 model+date 聚合，用价格表（含设置页覆盖）换算费用。
 * - OpenCode 自带 cost，优先用其值，不经过 computeCost。
 * - Claude Code / Codex / Antigravity / Grok Build 用 computeCost 补算；
 *   价格表匹配不到的模型 cost 为 undefined。
 * 不可用的来源计入 unavailable（如 OpenCode 的 node:sqlite 未启用），不阻塞其它来源。
 */
export async function scanLocalUsage(since?: string): Promise<ScanLocalUsageResult> {
  const overrides = parseOverrides(getSetting("pricingOverrides"));

  const [claudeRows, codexRows, opencode, antigravity, grok] = await Promise.all([
    scanClaudeCode(since),
    scanCodex(since),
    scanOpenCode(since),
    scanAntigravity(since),
    scanGrokBuild(since),
  ]);
  // 扫描期间更新的文件级缓存统一落盘（写失败仅意味着下次重扫）
  persistScanCache();

  const rows: LocalUsageRow[] = [];
  const unavailable: { source: LocalSource; reason: string }[] = [];

  for (const r of claudeRows) {
    const c = computeCost(r.model, toCostTokens(r), overrides);
    rows.push({ ...r, cost: c?.cost, currency: c?.currency });
  }
  for (const r of codexRows) {
    const c = computeCost(r.model, toCostTokens(r), overrides);
    rows.push({ ...r, cost: c?.cost, currency: c?.currency });
  }

  if (opencode.available) {
    rows.push(...opencode.rows);
  } else {
    unavailable.push({
      source: "opencode",
      reason: opencode.unavailableReason ?? "不可用",
    });
  }

  if (antigravity.available) {
    for (const r of antigravity.rows) {
      const c = computeCost(r.model, toCostTokens(r), overrides);
      rows.push({ ...r, cost: c?.cost, currency: c?.currency });
    }
  } else {
    unavailable.push({
      source: "antigravity",
      reason: antigravity.unavailableReason ?? "不可用",
    });
  }

  if (grok.available) {
    for (const r of grok.rows) {
      const c = computeCost(r.model, toCostTokens(r), overrides);
      rows.push({ ...r, cost: c?.cost, currency: c?.currency });
    }
  } else {
    unavailable.push({
      source: "grok-build",
      reason: grok.unavailableReason ?? "不可用",
    });
  }

  // 过滤无实际用量的行（如 Claude Code 的 <synthetic> 占位消息，token 全 0）
  const filtered = rows.filter(
    (r) =>
      r.inputTokens +
        r.outputTokens +
        r.cacheCreationTokens +
        r.cacheReadTokens +
        r.reasoningTokens >
      0,
  );

  // 按来源 + 模型 + 日期排序
  filtered.sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.model.localeCompare(b.model) ||
      a.date.localeCompare(b.date),
  );

  return { rows: filtered, unavailable };
}

/**
 * 扫描本地 agent 用量并落盘每日快照（upsert：今日桶覆盖，历史桶幂等）。
 * 供调度器定时刷新与 IPC 重新扫描调用，保证 Trends/Usage 页有持久化历史。
 * 返回扫描结果（与 scanLocalUsage 一致）。
 */
export async function scanAndPersistLocalUsage(
  since?: string,
): Promise<ScanLocalUsageResult> {
  const result = await scanLocalUsage(since);
  upsertLocalDailyUsage(result.rows);
  return result;
}
