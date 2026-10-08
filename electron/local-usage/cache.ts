import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { logWarn } from "../lib/logger";

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
  /**
   * 文件内出现过的 message.id（按首次出现顺序）。跨文件去重用：
   * Claude Code 续接会话（--resume / --continue）会把旧会话的历史消息原样复制进
   * 新的会话文件，message.id 不变。缺省（旧缓存）视为未命中，重读一次自愈。
   */
  ids?: string[];
  /**
   * 本文件里有消息已在「排在前面的文件」中出现过时，扣掉这些重复消息之后的聚合。
   * deps 记录这些前序文件当时的 mtime：重复来源与 mtime 都没变才能复用，
   * 否则（前序文件变了、新增了更靠前的副本文件……）重读本文件重算。
   */
  dedup?: {
    deps: Record<string, number>;
    models: Record<string, Record<string, ClaudeModelDayAgg>>;
  };
}

/** Codex：单次 API 调用增量（已从累计值/重放里拆出来） */
export interface CodexIncrement {
  ts: string;
  responseId?: string;
  model?: string;
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
}

export interface CodexFileEntry {
  mtimeMs: number;
  /** 增量缓存格式标记。缺省或非 2 视为旧的 cumulative samples，强制重扫。 */
  v?: 2;
  threadSource?: string;
  /** 扫描时按 turn_context / threadSource 派生的模型。 */
  model?: string;
  firstTs?: string;
  lastTs?: string;
  increments: CodexIncrement[];
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

/** OpenCode：某会话按 (模型, 本地日期) 拆开的用量（output 已扣 reasoning） */
export interface OpenCodeBucket {
  model: string;
  date: string;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost?: number;
  firstTs?: string;
  lastTs?: string;
}

export interface OpenCodeSessionEntry {
  /** session 行的用量合计 + 创建时间 + 模型。变了才重新按消息拆分 */
  fp: string;
  buckets: OpenCodeBucket[];
  /**
   * 消息合计与 session 合计对得上（没有余量、没有回退）。没对上的条目在会话
   * 仍活跃（最后一条消息 30 分钟内）时每轮重算，避免消息行晚于合计更新造成的瞬时偏差被永久缓存。
   */
  settled: boolean;
  /** 会话内最后一条 assistant 消息时间（ms） */
  lastMs?: number;
}

/** 解析口径变更时 +1，旧缓存整份作废，避免修过的虚高结果继续命中。 */
const CACHE_FORMAT_VERSION = 2;

interface ScanCacheData {
  version?: number;
  claude: Record<string, ClaudeFileEntry>;
  codex: Record<string, CodexFileEntry>;
  antigravity: Record<string, AntigravityFileEntry>;
  grok: Record<string, GrokFileEntry>;
  /** OpenCode：按 session id 缓存的逐消息拆分结果；db 换了路径整段作废 */
  opencode: { db?: string; sessions: Record<string, OpenCodeSessionEntry> };
}

/**
 * 每个来源的缓存条目安全上限。
 *
 * 正常情况下缓存靠 pruneScanCache 收缩：每次列目录后，已经不存在的文件条目直接删掉，
 * 条目数始终等于磁盘上的会话文件数。此前的做法是固定 4000 条、按 mtime 淘汰最旧，
 * 结果会话文件超过 4000 个的用户每一轮都会把最旧的那批文件重新逐行读一遍
 * （读完写回、下一轮又被淘汰），缓存对这批文件永远不命中。
 * 这里只保留一个很高的兜底，防止异常情况下（例如目录被反复改名）无限膨胀。
 */
export const MAX_ENTRIES_PER_SOURCE = 50_000;

type CacheSourceKey = "claude" | "codex" | "antigravity" | "grok";

let cache: ScanCacheData | null = null;
let cachePath = "";
/** 内存缓存相对磁盘是否有改动；没改动就不重写整份缓存文件。 */
let cacheDirty = false;

function emptyCache(): ScanCacheData {
  return {
    version: CACHE_FORMAT_VERSION,
    claude: {},
    codex: {},
    antigravity: {},
    grok: {},
    opencode: { sessions: {} },
  };
}

/**
 * 丢弃内存中的缓存，下次 getScanCache 会重新读盘。
 *
 * 「清除用量缓存」那次操作必须先调这个再删文件。缓存是常驻内存的单例，
 * 只删文件的话本次会话内扫描照旧命中旧缓存——把各会话文件按旧口径算出的
 * 聚合原样写回，等于什么都没重算。而这个按钮存在的唯一理由就是
 * 「统计口径修好了，把历史按新口径重算一遍」，它却要重启应用才生效。
 */
export function resetScanCache(): void {
  cache = null;
  cachePath = "";
  cacheDirty = false;
}

/** 采集器写入/替换了缓存条目之后调用，标记需要落盘。 */
export function markScanCacheDirty(): void {
  cacheDirty = true;
}

/**
 * 删掉磁盘上已不存在的文件条目（livePaths 是本轮完整列目录的结果）。
 * 只能在「这一轮确实完整列过该来源目录」时调用，被设置关闭而跳过扫描的来源不要调。
 */
export function pruneScanCache(source: CacheSourceKey, livePaths: ReadonlySet<string>): void {
  const c = getScanCache();
  const bucket = c[source] as Record<string, unknown>;
  for (const p of Object.keys(bucket)) {
    if (!livePaths.has(p)) {
      delete bucket[p];
      cacheDirty = true;
    }
  }
}

/** 懒加载缓存（首次调用时读盘），之后返回内存中的同一份引用。 */
export function getScanCache(): ScanCacheData {
  if (cache) return cache;
  cachePath = path.join(app.getPath("userData"), "usage-scan-cache.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8")) as Partial<ScanCacheData>;
    cache =
      parsed &&
      parsed.version === CACHE_FORMAT_VERSION &&
      typeof parsed.claude === "object" &&
      typeof parsed.codex === "object"
        ? {
            version: CACHE_FORMAT_VERSION,
            claude: parsed.claude,
            codex: parsed.codex,
            antigravity: typeof parsed.antigravity === "object" ? parsed.antigravity : {},
            grok: typeof parsed.grok === "object" ? parsed.grok : {},
            opencode:
              parsed.opencode &&
              typeof parsed.opencode === "object" &&
              typeof parsed.opencode.sessions === "object"
                ? parsed.opencode
                : { sessions: {} },
          }
        : emptyCache();
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e ? String((e as { code?: unknown }).code) : "";
    // 文件不存在是首次运行的正常路径，不当成故障
    if (code !== "ENOENT") {
      logWarn(
        "local-usage",
        `用量扫描缓存不可用，将全量重扫：${e instanceof Error ? e.message : String(e)}`,
      );
    }
    cache = emptyCache();
  }
  return cache;
}

/**
 * 扫描结束后落盘。写失败不影响主流程（下次重扫而已）。
 *
 * 只在本轮确有条目变化时才写：缓存文件动辄数 MB，此前每 5 分钟一次的定时扫描
 * 即便一个会话文件都没变，也要把整份缓存重新序列化写一遍。
 * 返回是否真的写了盘（测试用）。
 */
export function persistScanCache(): boolean {
  if (!cache || !cachePath) return false;
  cache.version = CACHE_FORMAT_VERSION;
  for (const key of ["claude", "codex", "antigravity", "grok"] as const) {
    const entries = Object.entries(cache[key]);
    if (entries.length > MAX_ENTRIES_PER_SOURCE) {
      entries.sort((a, b) => b[1].mtimeMs - a[1].mtimeMs);
      cache[key] = Object.fromEntries(entries.slice(0, MAX_ENTRIES_PER_SOURCE));
      cacheDirty = true;
    }
  }
  if (!cacheDirty) return false;
  cacheDirty = false;
  try {
    const tmp = cachePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cache), "utf8");
    fs.renameSync(tmp, cachePath);
    return true;
  } catch (e) {
    // 写失败保持 dirty，下一轮再试
    cacheDirty = true;
    logWarn(
      "local-usage",
      `用量扫描缓存写入失败（下次会重扫）：${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}

/**
 * 类型守卫：Claude 缓存条目是否为新版 per-model-per-day 结构。
 * 旧版 models[model] 是单层 agg（input 为 number），视为未命中重扫。
 */
export function isClaudeEntryValid(entry: ClaudeFileEntry): boolean {
  if (!entry.models || typeof entry.models !== "object") return false;
  // 跨文件去重之前写下的条目没有 ids，重读一次补上
  if (!Array.isArray(entry.ids)) return false;
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

/** 类型守卫：Codex 缓存须为增量结构（旧版 cumulative samples 视为未命中） */
export function isCodexEntryValid(entry: CodexFileEntry): boolean {
  return entry.v === 2 && Array.isArray(entry.increments);
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
