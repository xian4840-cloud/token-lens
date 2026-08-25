import fs from "node:fs";
import readline from "node:readline";
import { CLAUDE_CODE_DIR } from "./paths";
import { listJsonlFilesWithStat } from "./files";
import { toDateKey } from "./date";
import {
  getScanCache,
  isClaudeEntryValid,
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
  message?: { model?: string; usage?: AssistantUsage };
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

/** 缓存命中且整文件在界内：直接合并缓存的 per-model-per-day 全量聚合 */
function mergeEntry(
  agg: Map<string, ModelDayAgg>,
  filePath: string,
  entry: ClaudeFileEntry,
): void {
  for (const [model, days] of Object.entries(entry.models)) {
    for (const [date, m] of Object.entries(days)) {
      const key = `${model}|${date}`;
      const cur = agg.get(key) ?? freshAgg();
      cur.sessions.add(filePath);
      cur.input += m.input;
      cur.output += m.output;
      cur.cacheCreation += m.cacheCreation;
      cur.cacheRead += m.cacheRead;
      if (m.firstTs && (!cur.firstAt || m.firstTs < cur.firstAt))
        cur.firstAt = m.firstTs;
      if (m.lastTs && (!cur.lastAt || m.lastTs > cur.lastAt)) cur.lastAt = m.lastTs;
      agg.set(key, cur);
    }
  }
}

/**
 * 扫描 Claude Code 会话记录，按 model+date 聚合 usage（精确按天）。
 * ~/.claude/projects 下递归的 .jsonl，type=assistant 行的 message.model + message.usage + timestamp。
 * 每条 assistant 消息为增量，按 timestamp 本地日期落到 (model, date) 桶累加。
 *
 * 性能：会话日志按时间追加写，mtime 未变的文件走缓存（cache.ts）；
 * 带 since 时 mtime 明显早于 since 的旧文件整体跳过，跨界文件才逐行过滤。
 */
export async function scanClaudeCode(since?: string): Promise<LocalUsageRow[]> {
  const files = listJsonlFilesWithStat(CLAUDE_CODE_DIR);
  const cache = getScanCache();
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  const agg = new Map<string, ModelDayAgg>();

  for (const file of files) {
    // A 类：mtime 早于 since（留 60s 临界余量）-> 所有行都在界外，整个跳过
    if (!Number.isNaN(sinceMs) && file.mtimeMs + 60_000 < sinceMs) continue;

    const entry = cache.claude[file.path];
    if (entry && entry.mtimeMs === file.mtimeMs && isClaudeEntryValid(entry)) {
      if (Object.keys(entry.models).length === 0) continue; // 无 usage 行的空文件
      // B 类：全量扫描，或文件最早 usage 行已在界内 -> 整文件复用缓存
      if (
        since === undefined ||
        (entry.firstTs !== undefined && entry.firstTs >= since)
      ) {
        mergeEntry(agg, file.path, entry);
        continue;
      }
      // C 类：跨界文件，落到下方逐行读
    }

    // 逐行读：按 model+date 聚合（since 行级过滤），同时构建全量 entry 写缓存
    const keysInFile = new Set<string>();
    const newEntry: ClaudeFileEntry = { mtimeMs: file.mtimeMs, models: {} };
    let rl: readline.Interface;
    try {
      rl = readline.createInterface({
        input: fs.createReadStream(file.path, { encoding: "utf8" }),
        crlfDelay: Infinity,
      });
    } catch {
      continue;
    }
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
      const ts = obj.timestamp;
      const date = toDateKey(ts);
      if (!date) continue;

      // 全量聚合（缓存用，不做时间过滤）
      const em = (newEntry.models[model] ??= {});
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
        if (!newEntry.firstTs || ts < newEntry.firstTs) newEntry.firstTs = ts;
      }

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
    cache.claude[file.path] = newEntry;
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
