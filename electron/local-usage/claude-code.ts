import fs from "node:fs";
import readline from "node:readline";
import { CLAUDE_CODE_DIR } from "./paths";
import { listJsonlFilesWithStat } from "./files";
import { toDateKey } from "./date";
import {
  getScanCache,
  isClaudeEntryValid,
  markScanCacheDirty,
  pruneScanCache,
  type ClaudeFileEntry,
  type ClaudeModelDayAgg,
} from "./cache";
import type { LocalUsageRow } from "./types";

interface AssistantUsage {
  input_tokens?: number;
  output_tokens?: number;
  /** 缓存创建总数（已含 ephemeral TTL 细分，不另加 ephemeral_5m/1h） */
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeLine {
  type?: string;
  timestamp?: string;
  message?: { id?: string; model?: string; usage?: AssistantUsage };
}

interface ModelDayAgg {
  sessions: Set<string>;
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  firstAt?: string;
  lastAt?: string;
}

function freshAgg(): ModelDayAgg {
  return {
    sessions: new Set<string>(),
    input: 0,
    output: 0,
    cacheCreation: 0,
    cacheRead: 0,
  };
}

type ModelsAgg = ClaudeFileEntry["models"];

/** 缓存命中且整文件在界内：直接合并缓存的 per-model-per-day 全量聚合 */
function mergeEntry(agg: Map<string, ModelDayAgg>, filePath: string, models: ModelsAgg): void {
  for (const [model, days] of Object.entries(models)) {
    for (const [date, m] of Object.entries(days)) {
      const key = `${model}|${date}`;
      const cur = agg.get(key) ?? freshAgg();
      cur.sessions.add(filePath);
      cur.input += m.input;
      cur.output += m.output;
      cur.cacheCreation += m.cacheCreation;
      cur.cacheRead += m.cacheRead;
      if (m.firstTs && (!cur.firstAt || m.firstTs < cur.firstAt)) cur.firstAt = m.firstTs;
      if (m.lastTs && (!cur.lastAt || m.lastTs > cur.lastAt)) cur.lastAt = m.lastTs;
      agg.set(key, cur);
    }
  }
}

function addToModels(
  models: ModelsAgg,
  model: string,
  date: string,
  usage: AssistantUsage,
  ts: string | undefined,
): void {
  const em = (models[model] ??= {});
  const ed = (em[date] ??= {
    input: 0,
    output: 0,
    cacheCreation: 0,
    cacheRead: 0,
  } as ClaudeModelDayAgg);
  ed.input += usage.input_tokens ?? 0;
  ed.output += usage.output_tokens ?? 0;
  ed.cacheCreation += usage.cache_creation_input_tokens ?? 0;
  ed.cacheRead += usage.cache_read_input_tokens ?? 0;
  if (ts) {
    if (!ed.firstTs || ts < ed.firstTs) ed.firstTs = ts;
    if (!ed.lastTs || ts > ed.lastTs) ed.lastTs = ts;
  }
}

const ANON_PREFIX = "__anon_";

/** 本文件的 message.id 中，已被「排在前面的文件」认领的那些来自哪些文件。 */
function ownersOf(
  ids: readonly string[],
  owner: ReadonlyMap<string, string>,
  self: string,
): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    const o = owner.get(id);
    if (o !== undefined && o !== self) out.add(o);
  }
  return out;
}

function sameDeps(
  stored: Record<string, number>,
  current: ReadonlySet<string>,
  mtimeOf: ReadonlyMap<string, number>,
): boolean {
  const keys = Object.keys(stored);
  if (keys.length !== current.size) return false;
  return keys.every((k) => current.has(k) && mtimeOf.get(k) === stored[k]);
}

/**
 * 扫描 Claude Code 会话记录，按 model+date 聚合 usage（精确按天）。
 * ~/.claude/projects 下递归的 .jsonl，type=assistant 行的 message.model + message.usage + timestamp。
 * 每条 assistant 消息为增量，按 timestamp 本地日期落到 (model, date) 桶累加。
 *
 * 去重：
 * - 文件内：同一 message.id 会写多次（流式中间态 + 终态），只留最后一条；
 * - 跨文件：续接会话（--resume / --continue）会把旧会话历史原样复制进新文件，
 *   message.id 不变。按文件路径排序依次处理，某个 id 只记在第一个出现它的文件上，
 *   后面文件里的副本不再计数（与 Codex 按 responseId 跨文件去重同一思路）。
 *
 * 性能：会话日志按时间追加写，mtime 未变的文件走缓存（cache.ts）；
 * 带 since 时 mtime 明显早于 since 的旧文件整体跳过，跨界文件才逐行过滤。
 * 有跨文件重复的文件额外缓存「扣掉重复之后」的聚合，重复来源没变就继续命中。
 */
export async function scanClaudeCode(
  since?: string,
  dir: string = CLAUDE_CODE_DIR,
): Promise<LocalUsageRow[]> {
  const files = await listJsonlFilesWithStat(dir);
  const cache = getScanCache();
  pruneScanCache("claude", new Set(files.map((f) => f.path)));
  const mtimeOf = new Map(files.map((f) => [f.path, f.mtimeMs]));
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  const agg = new Map<string, ModelDayAgg>();
  /** message.id -> 第一个出现它的文件 */
  const owner = new Map<string, string>();
  const register = (ids: readonly string[], filePath: string) => {
    for (const id of ids) if (!owner.has(id)) owner.set(id, filePath);
  };

  for (const file of files) {
    const entry = cache.claude[file.path];
    const valid =
      entry !== undefined && entry.mtimeMs === file.mtimeMs && isClaudeEntryValid(entry);

    // A 类：mtime 早于 since（留 60s 临界余量）-> 所有行都在界外，整个跳过。
    // 有缓存时照样登记它的 message.id，后面文件里的副本才能被识别出来。
    if (!Number.isNaN(sinceMs) && file.mtimeMs + 60_000 < sinceMs) {
      if (valid) register(entry.ids ?? [], file.path);
      continue;
    }

    if (valid) {
      const ids = entry.ids ?? [];
      const deps = ownersOf(ids, owner, file.path);
      let models: ModelsAgg | undefined;
      if (deps.size === 0) models = entry.models;
      else if (entry.dedup && sameDeps(entry.dedup.deps, deps, mtimeOf)) {
        models = entry.dedup.models;
      }
      if (models) {
        register(ids, file.path);
        if (Object.keys(models).length === 0) continue; // 无 usage 行（或全是副本）
        // B 类：全量扫描，或文件最早 usage 行已在界内 -> 整文件复用缓存
        if (since === undefined || (entry.firstTs !== undefined && entry.firstTs >= since)) {
          mergeEntry(agg, file.path, models);
          continue;
        }
        // C 类：跨界文件，落到下方逐行读
      }
      // 重复来源变了：落到下方重读重算
    }

    // 逐行读：按 model+date 聚合（since 行级过滤），同时构建全量 entry 写缓存
    const keysInFile = new Set<string>();
    let rl: readline.Interface;
    try {
      rl = readline.createInterface({
        input: fs.createReadStream(file.path, { encoding: "utf8" }),
        crlfDelay: Infinity,
      });
    } catch {
      continue;
    }
    // 同一 message.id 会写多次（流式中间态 + 终态）。只留最后一条，否则用量翻倍。
    const lastByMsg = new Map<string, { model: string; usage: AssistantUsage; ts?: string }>();
    let anon = 0;
    try {
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj: ClaudeLine;
        try {
          obj = JSON.parse(trimmed) as ClaudeLine;
        } catch {
          continue;
        }
        if (obj.type !== "assistant") continue;
        const model = obj.message?.model;
        const usage = obj.message?.usage;
        if (!model || !usage) continue;
        const id = obj.message?.id ?? `${ANON_PREFIX}${anon++}`;
        lastByMsg.set(id, { model, usage, ts: obj.timestamp });
      }
    } catch {
      // 读到一半文件被删 / 无权限：跳过该文件，不写缓存
      continue;
    }
    const ids = [...lastByMsg.keys()].filter((id) => !id.startsWith(ANON_PREFIX));
    const newEntry: ClaudeFileEntry = { mtimeMs: file.mtimeMs, models: {}, ids };
    const dedupModels: ModelsAgg = {};
    const deps: Record<string, number> = {};
    for (const [id, { model, usage, ts }] of lastByMsg) {
      const date = toDateKey(ts);
      if (!date) continue;

      // 全量聚合（缓存用，不做时间过滤）
      addToModels(newEntry.models, model, date, usage, ts);
      if (ts && (!newEntry.firstTs || ts < newEntry.firstTs)) newEntry.firstTs = ts;

      // 跨文件副本：前面某个文件已经记过这条消息
      const prev = id.startsWith(ANON_PREFIX) ? undefined : owner.get(id);
      if (prev !== undefined && prev !== file.path) {
        deps[prev] = mtimeOf.get(prev) ?? 0;
        continue;
      }
      addToModels(dedupModels, model, date, usage, ts);

      // 结果聚合（since 行级过滤）
      if (since && ts && ts < since) continue;
      const key = `${model}|${date}`;
      const cur = agg.get(key) ?? freshAgg();
      cur.input += usage.input_tokens ?? 0;
      cur.output += usage.output_tokens ?? 0;
      cur.cacheCreation += usage.cache_creation_input_tokens ?? 0;
      cur.cacheRead += usage.cache_read_input_tokens ?? 0;
      if (ts) {
        if (!cur.firstAt || ts < cur.firstAt) cur.firstAt = ts;
        if (!cur.lastAt || ts > cur.lastAt) cur.lastAt = ts;
      }
      keysInFile.add(key);
      agg.set(key, cur);
    }
    for (const k of keysInFile) {
      agg.get(k)?.sessions.add(file.path);
    }
    if (Object.keys(deps).length > 0) newEntry.dedup = { deps, models: dedupModels };
    register(ids, file.path);
    cache.claude[file.path] = newEntry;
    markScanCacheDirty();
  }

  return Array.from(agg.entries()).map(([key, v]) => {
    const [model, date] = key.split("|");
    return {
      source: "claude-code" as const,
      model,
      date,
      sessions: v.sessions.size,
      inputTokens: v.input,
      outputTokens: v.output,
      cacheCreationTokens: v.cacheCreation,
      cacheReadTokens: v.cacheRead,
      reasoningTokens: 0,
      firstAt: v.firstAt,
      lastAt: v.lastAt,
    };
  });
}
