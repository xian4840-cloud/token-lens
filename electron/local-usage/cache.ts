import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

/**
 * 本地 agent 用量扫描的文件级缓存。
 *
 * 会话日志是追加写的，行时间戳单调递增（最后一行时间 ≈ 文件 mtime），
 * 因此 mtime 未变的文件聚合结果可直接复用，无需重读逐行解析。
 * 缓存存于 userData/usage-scan-cache.json，损坏时降级为空缓存（重扫一遍自愈）。
 *
 * 按天分桶后缓存结构：
 * - Claude：per-file -> per-model -> per-day 全量聚合（不做时间过滤）
 * - Codex：per-file -> session 内 total_token_usage 采样点序列（命中后内存 diff 按天落桶）
 * - Antigravity / Grok：per-file -> per-model -> per-day 全量聚合
 * 旧版（无 date 维度 / 单值 usage）缓存条目会被采集器视为未命中而重扫，自愈为新结构。
 */

/** Claude Code：某模型某日的全量聚合（缓存用，不做时间过滤） */
export interface ClaudeModelDayAgg {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  firstTs?: string;
  lastTs?: string;
}

export interface ClaudeFileEntry {
  mtimeMs: number;
  /** 全文件最早一条 assistant usage 行时间，用于时间范围分类 */
  firstTs?: string;
  /** per-model -> per-day 全量聚合；空对象表示文件无 usage 行 */
  models: Record<string, Record<string, ClaudeModelDayAgg>>;
}

/** Codex：session 内 total_token_usage 采样点（按 ts 升序存储，命中后 diff） */
export interface CodexSample {
  ts: string;
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
}

export interface CodexFileEntry {
  mtimeMs: number;
  threadSource?: string;
  /** 扫描时按 threadSource + 当时的 config.toml 派生的模型。缓存命中时直接用，
   *  避免 config 模型变更后重派导致 upsert 双计（同会话用量被记到新模型 key）。 */
  model?: string;
  firstTs?: string;
  lastTs?: string;
  /** 文件内所有 total_token_usage 采样点；空数组表示文件无 token 记录 */
  samples: CodexSample[];
}

/** Antigravity：某模型某日的全量聚合（缓存用，不做时间过滤） */
export interface AntigravityModelDayAgg {
  input: number;
  output: number;
  reasoning: number;
  firstTs?: string;
  lastTs?: string;
}

export interface AntigravityFileEntry {
  /** .db 与 .db-wal mtime 的较大值（WAL 未 checkpoint 时主文件 mtime 不更新） */
  mtimeMs: number;
  firstTs?: string;
  /** per-model -> per-day 全量聚合；空对象表示会话无 usage 行 */
  models: Record<string, Record<string, AntigravityModelDayAgg>>;
}

/** Grok Build：某模型某日的全量聚合（缓存用，不做时间过滤） */
export interface GrokModelDayAgg {
  input: number;
  /** 可见输出（已扣除 reasoning） */
  output: number;
  cacheCreation: number;
  cacheRead: number;
  reasoning: number;
  firstTs?: string;
  lastTs?: string;
}

export interface GrokFileEntry {
  mtimeMs: number;
  /** 文件内最早一条 turn_completed 的时间（ISO），用于时间范围分类 */
  firstTs?: string;
  /** per-model -> per-day 全量聚合；空对象表示文件无 usage 行 */
  models: Record<string, Record<string, GrokModelDayAgg>>;
}

interface ScanCacheData {
  claude: Record<string, ClaudeFileEntry>;
  codex: Record<string, CodexFileEntry>;
  antigravity: Record<string, AntigravityFileEntry>;
  grok: Record<string, GrokFileEntry>;
}

/** 每个来源的缓存条目上限，超出按 mtime 淘汰最旧，防止缓存文件无限膨胀 */
const MAX_ENTRIES_PER_SOURCE = 4000;

let cache: ScanCacheData | null = null;
let cachePath = "";

function emptyCache(): ScanCacheData {
  return { claude: {}, codex: {}, antigravity: {}, grok: {} };
}

/** 懒加载缓存（首次调用时读盘），之后返回内存中的同一份引用。 */
export function getScanCache(): ScanCacheData {
  if (cache) return cache;
  cachePath = path.join(app.getPath("userData"), "usage-scan-cache.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8")) as Partial<ScanCacheData>;
    cache =
      parsed && typeof parsed.claude === "object" && typeof parsed.codex === "object"
        ? {
            // 新增来源段缺失时补空对象，避免升级时整份缓存作废（旧段全量重扫）
            claude: parsed.claude,
            codex: parsed.codex,
            antigravity:
              typeof parsed.antigravity === "object" ? parsed.antigravity : {},
            grok: typeof parsed.grok === "object" ? parsed.grok : {},
          }
        : emptyCache();
  } catch {
    cache = emptyCache();
  }
  return cache;
}

/** 扫描结束后落盘。写失败不影响主流程（下次重扫而已）。 */
export function persistScanCache(): void {
  if (!cache || !cachePath) return;
  for (const key of ["claude", "codex", "antigravity", "grok"] as const) {
    const entries = Object.entries(cache[key]);
    if (entries.length > MAX_ENTRIES_PER_SOURCE) {
      entries.sort((a, b) => b[1].mtimeMs - a[1].mtimeMs);
      cache[key] = Object.fromEntries(entries.slice(0, MAX_ENTRIES_PER_SOURCE));
    }
  }
  try {
    const tmp = cachePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cache), "utf8");
    fs.renameSync(tmp, cachePath);
  } catch {
    // 忽略：缓存只是加速层
  }
}

/**
 * 类型守卫：Claude 缓存条目是否为新版 per-model-per-day 结构。
 * 旧版 models[model] 是单层 agg（input 为 number），视为未命中重扫。
 */
export function isClaudeEntryValid(entry: ClaudeFileEntry): boolean {
  if (!entry.models || typeof entry.models !== "object") return false;
  for (const v of Object.values(entry.models)) {
    if (v == null || typeof v !== "object") return false;
    // 新版 v 是 Record<dateKey, agg>，其属性值是带 input 的对象
    // 旧版 v 是 agg 本身，其属性值是 number
    const vals = Object.values(v as Record<string, unknown>);
    if (vals.length === 0) continue;
    const first = vals[0];
    if (!first || typeof first !== "object" || !("input" in (first as object))) {
      return false;
    }
  }
  return true;
}

/** 类型守卫：Codex 缓存条目是否为新版 samples 结构（旧版单值 usage 视为未命中） */
export function isCodexEntryValid(entry: CodexFileEntry): boolean {
  return Array.isArray(entry.samples);
}

/** 类型守卫：Antigravity 缓存条目是否为新版 per-model-per-day 结构 */
export function isAntigravityEntryValid(entry: AntigravityFileEntry): boolean {
  if (!entry.models || typeof entry.models !== "object") return false;
  for (const v of Object.values(entry.models)) {
    if (v == null || typeof v !== "object") return false;
    for (const day of Object.values(v as Record<string, unknown>)) {
      if (!day || typeof day !== "object" || !("input" in (day as object))) {
        return false;
      }
    }
  }
  return true;
}

/** 类型守卫：Grok 缓存条目是否为新版 per-model-per-day 结构 */
export function isGrokEntryValid(entry: GrokFileEntry): boolean {
  if (!entry.models || typeof entry.models !== "object") return false;
  for (const v of Object.values(entry.models)) {
    if (v == null || typeof v !== "object") return false;
    for (const day of Object.values(v as Record<string, unknown>)) {
      if (!day || typeof day !== "object" || !("input" in (day as object))) {
        return false;
      }
    }
  }
  return true;
}
