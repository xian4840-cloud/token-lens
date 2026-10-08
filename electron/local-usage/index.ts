import { scanClaudeCode } from "./claude-code";
import { scanCodex } from "./codex";
import { scanOpenCode } from "./opencode";
import { scanAntigravity } from "./antigravity";
import { scanGrokBuild } from "./grok-build";
import { persistScanCache } from "./cache";
import { computeCost, parseOverrides, type TokenUsage } from "../adapters/pricing";
import {
  getSetting,
  markLocalScanned,
  replaceLocalDailyUsageBySource,
  upsertLocalDailyUsage,
} from "../db";
import { parseIdList } from "../lib/id-list";
import type {
  LocalSource,
  LocalUsageRow,
  ScanLocalUsageResult,
} from "./types";
import { ALL_LOCAL_SOURCES } from "./types";
import { notifyRenderer } from "../lib/renderer-notify";

let scanFlight: {
  since: string | undefined;
  promise: Promise<ScanLocalUsageResult>;
} | null = null;

/**
 * 按 source 构造 computeCost 用的 TokenUsage。
 *
 * 五家采集器共用同一套存储口径，所以这里只有一条公式：
 * - inputTokens 一律**不含** cacheRead：Codex / Grok 存盘前已拆，
 *   Claude 的 input_tokens 本来就不含（Anthropic 语义），Antigravity 无缓存机制；
 * - outputTokens 一律**不含** reasoning，reasoning 单独存、计费时按 output 价加回
 *   （Claude Code 没有推理输出，该字段恒为 0）；
 * - 缓存读与缓存写各自独立成项，Antigravity 恒为 0。
 *
 * 这里原先是按 source 分三支的，OpenCode 落在最后那支时漏掉了 reasoningTokens：
 * 它在 0.1.6 刚把 reasoning 从 output 里拆出去（为了修界面双计），拆完就再没人
 * 给它计费，而同一批改动里 UI 的 visibleTokens 是会加回 reasoning 的。结果是
 * 界面上的总量含推理、费用却不含。口径统一之后不再有「某一支忘了加」的余地。
 */
export function toCostTokens(row: LocalUsageRow): TokenUsage {
  return {
    input: row.inputTokens,
    output: row.outputTokens + row.reasoningTokens,
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
  const disabled = new Set(parseIdList(getSetting("disabledLocalSources")));

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

  for (const source of ALL_LOCAL_SOURCES) {
    if (disabled.has(source)) {
      unavailable.push({ source, reason: "已在设置中关闭" });
    }
  }

  // 过滤无实际用量的行（如 Claude Code 的 <synthetic> 占位消息，token 全 0）
  const filtered = rows.filter(
    (r) =>
      !disabled.has(r.source) &&
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
 * 扫描本地 agent 用量并落盘每日快照。
 * 供调度器定时刷新与 IPC 重新扫描调用，保证 Trends/Usage 页有持久化历史。
 * 返回扫描结果（与 scanLocalUsage 一致）。
 *
 * 落盘方式取决于扫描范围：
 * - 全量扫描（不带 since）：整源替换。这是为了清掉「新口径下不再出现的日期」，
 *   否则修好统计逻辑之后，历史里虚高的旧桶会一直留在库里。
 * - 带 since 的窗口扫描：只 upsert，绝不删窗口外的桶。此时 result.rows 是窗口内
 *   的子集而非全量，整源替换会把窗口外的历史一并删掉。这条路是真实可达的：
 *   Usage 页的「重新扫描」按钮传的就是当前时间范围的起点，而该页默认范围是
 *   「当月」，也就是点一下会删掉本月之前的全部本地用量。虽然下一次全量扫描
 *   （调度器默认 5 分钟一次）通常会从会话文件里重建回来，但会话文件一旦被清理
 *   就是永久丢失，而且中间这段时间图表与费用都是错的。
 */
export async function scanAndPersistLocalUsage(
  since?: string,
): Promise<ScanLocalUsageResult> {
  // 全量扫描可以满足任何窗口请求；窗口扫描不能拿来顶全量（会漏掉窗口外的替换）。
  while (scanFlight) {
    if (scanFlight.since === undefined || scanFlight.since === since) {
      return scanFlight.promise;
    }
    await scanFlight.promise.catch(() => undefined);
  }
  const promise = persistScannedUsage(since).finally(() => {
    if (scanFlight?.promise === promise) scanFlight = null;
  });
  scanFlight = { since, promise };
  return promise;
}

async function persistScannedUsage(
  since?: string,
): Promise<ScanLocalUsageResult> {
  const result = await scanLocalUsage(since);
  const grouped = new Map<LocalSource, LocalUsageRow[]>();
  for (const r of result.rows) {
    const list = grouped.get(r.source);
    if (list) list.push(r);
    else grouped.set(r.source, [r]);
  }
  const unavailable = new Set(result.unavailable.map((u) => u.source));
  const fullScan = since === undefined;
  const scannedAt = new Date().toISOString();
  for (const source of ALL_LOCAL_SOURCES) {
    if (unavailable.has(source)) continue;
    const rows = grouped.get(source) ?? [];
    // 内容没变时 db 层不会改写也不会落盘；扫描时间单独记在内存里供界面显示
    if (fullScan) replaceLocalDailyUsageBySource(source, rows);
    else upsertLocalDailyUsage(rows);
    markLocalScanned(source, scannedAt);
  }
  notifyRenderer("local-usage:updated");
  return result;
}
