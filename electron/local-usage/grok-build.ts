import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { GROK_SESSIONS_DIR } from "./paths";
import { listJsonlFilesWithStat } from "./files";
import { toDateKey } from "./date";
import {
  getScanCache,
  isGrokEntryValid,
  type GrokFileEntry,
  type GrokModelDayAgg,
} from "./cache";
import type { LocalUsageRow } from "./types";

/** turn_completed.usage 的 token 分项（顶层与 modelUsage[model] 同构） */
interface GrokUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number;
  modelUsage?: Record<string, GrokUsage>;
}

interface GrokLine {
  /** epoch 秒（实测为整数秒，无毫秒） */
  timestamp?: number;
  params?: { update?: { sessionUpdate?: string; usage?: GrokUsage } };
}

export interface GrokScanResult {
  available: boolean;
  rows: LocalUsageRow[];
  unavailableReason?: string;
}

interface ModelDayAgg {
  sessions: Set<string>;
  input: number;
  /** 可见输出（已扣除 reasoning，UI 侧 output+reasoning 才是原始值） */
  output: number;
  cacheCreation: number;
  cacheRead: number;
  reasoning: number;
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
    reasoning: 0,
  };
}

/**
 * 拆出单条 usage 的存储值。
 *
 * token 语义（实测 ~/.grok/sessions 的 turn_completed 记录，OpenAI 习惯）：
 * - inputTokens 已含 cachedReadTokens；outputTokens 已含 reasoningTokens。
 *   两个包含关系均有不变量佐证：totalTokens === inputTokens + outputTokens
 *   恒成立，且 reasoningTokens <= outputTokens 恒成立。
 * - 存储侧把 reasoning 从 output 中拆出（outputTokens 存差值），使 UI 的
 *   「output = outputTokens + reasoningTokens」惯例与原始口径一致，不双计。
 */
function usageParts(u: GrokUsage): {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  reasoning: number;
} {
  const reasoning = u.reasoningTokens ?? 0;
  return {
    input: u.inputTokens ?? 0,
    output: Math.max(0, (u.outputTokens ?? 0) - reasoning),
    cacheCreation: u.cacheCreationTokens ?? 0,
    cacheRead: u.cachedReadTokens ?? 0,
    reasoning,
  };
}

/** epoch 秒 -> ISO 字符串；非法值返回 undefined（调用方跳过该行）。 */
function toIso(sec: number | undefined): string | undefined {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return undefined;
  return new Date(sec * 1000).toISOString();
}

/** 把一条 turn_completed 的 usage 按 modelUsage 分项累加进聚合。
 * since 行级过滤：该轮结束时间早于 since 的整轮跳过。 */
function addTurn(
  agg: Map<string, ModelDayAgg>,
  filePath: string,
  ts: string,
  usage: GrokUsage,
  since?: string,
  cacheEntry?: GrokFileEntry,
): void {
  const inRange = !since || ts >= since;
  let models: [string, GrokUsage][];
  if (usage.modelUsage && Object.keys(usage.modelUsage).length > 0) {
    models = Object.entries(usage.modelUsage).filter(
      ([, mu]) => mu != null && typeof mu === "object",
    );
  } else if (usage.inputTokens != null || usage.outputTokens != null) {
    // 兜底：无 modelUsage 时归到通用 grok（价格表匹配不到则费用显示「-」）
    models = [["grok", usage]];
  } else {
    return;
  }

  const date = toDateKey(ts);
  if (!date) return;
  const parts = models.map(([m, mu]) => [m, usageParts(mu)] as const);

  // 全量聚合（缓存用，不做时间过滤）
  if (cacheEntry) {
    for (const [model, p] of parts) {
      const em = (cacheEntry.models[model] ??= {});
      const ed = (em[date] ??= {
        input: 0,
        output: 0,
        cacheCreation: 0,
        cacheRead: 0,
        reasoning: 0,
      } as GrokModelDayAgg);
      ed.input += p.input;
      ed.output += p.output;
      ed.cacheCreation += p.cacheCreation;
      ed.cacheRead += p.cacheRead;
      ed.reasoning += p.reasoning;
      if (!ed.firstTs || ts < ed.firstTs) ed.firstTs = ts;
      if (!ed.lastTs || ts > ed.lastTs) ed.lastTs = ts;
    }
    if (!cacheEntry.firstTs || ts < cacheEntry.firstTs) cacheEntry.firstTs = ts;
  }

  if (!inRange) return;
  for (const [model, p] of parts) {
    const key = `${model}|${date}`;
    const cur = agg.get(key) ?? freshAgg();
    cur.sessions.add(filePath);
    cur.input += p.input;
    cur.output += p.output;
    cur.cacheCreation += p.cacheCreation;
    cur.cacheRead += p.cacheRead;
    cur.reasoning += p.reasoning;
    if (!cur.firstAt || ts < cur.firstAt) cur.firstAt = ts;
    if (!cur.lastAt || ts > cur.lastAt) cur.lastAt = ts;
    agg.set(key, cur);
  }
}

/** 缓存命中且整文件在界内：直接合并缓存的 per-model-per-day 全量聚合 */
function mergeEntry(
  agg: Map<string, ModelDayAgg>,
  filePath: string,
  entry: GrokFileEntry,
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
      cur.reasoning += m.reasoning;
      if (m.firstTs && (!cur.firstAt || m.firstTs < cur.firstAt))
        cur.firstAt = m.firstTs;
      if (m.lastTs && (!cur.lastAt || m.lastTs > cur.lastAt)) cur.lastAt = m.lastTs;
      agg.set(key, cur);
    }
  }
}

/**
 * 扫描 Grok Build 会话记录：~/.grok/sessions/<编码工作目录>/<session-id>/updates.jsonl，
 * 每轮（user turn）一条 turn_completed 事件，其 usage 携带该轮全部模型调用的
 * token 汇总（按 modelUsage 分模型；实测为按轮独立汇总而非会话累计，可直接求和），
 * 按结束时间戳的本地日期落到 (model, date) 桶累加。
 *
 * 同目录下的 chat_history / events / hunk_records 等 jsonl 不含 token 数据，
 * 只挑文件名为 updates.jsonl 的解析。
 *
 * 性能：与 Claude Code 相同的三级 mtime 缓存（cache.ts grok 段）；
 * 带 since 时 mtime 明显早于 since 的旧文件整体跳过，跨界文件才逐行过滤。
 */
export async function scanGrokBuild(since?: string): Promise<GrokScanResult> {
  if (!fs.existsSync(GROK_SESSIONS_DIR)) {
    return {
      available: false,
      unavailableReason:
        "未找到 Grok Build 会话目录（~/.grok/sessions，可能未安装或未使用）",
      rows: [],
    };
  }

  // 会话目录里混着 prompt_history.jsonl 等非用量文件，只认每会话一份的 updates.jsonl
  const files = listJsonlFilesWithStat(GROK_SESSIONS_DIR).filter(
    (f) => path.basename(f.path) === "updates.jsonl",
  );
  if (files.length === 0) {
    return {
      available: false,
      unavailableReason: "Grok Build 会话目录为空（尚无会话记录）",
      rows: [],
    };
  }

  const cache = getScanCache();
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  const agg = new Map<string, ModelDayAgg>();

  for (const file of files) {
    // A 类：mtime 早于 since（留 60s 临界余量）-> 所有轮都在界外，整个跳过
    if (!Number.isNaN(sinceMs) && file.mtimeMs + 60_000 < sinceMs) continue;

    const entry = cache.grok[file.path];
    if (entry && entry.mtimeMs === file.mtimeMs && isGrokEntryValid(entry)) {
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
    const newEntry: GrokFileEntry = { mtimeMs: file.mtimeMs, models: {} };
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
      if (!trimmed || !trimmed.includes("turn_completed")) continue;
      let obj: GrokLine;
      try {
        obj = JSON.parse(trimmed) as GrokLine;
      } catch {
        continue;
      }
      const update = obj.params?.update;
      if (!update || update.sessionUpdate !== "turn_completed") continue;
      const ts = toIso(obj.timestamp);
      if (!ts || !update.usage) continue;
      addTurn(agg, file.path, ts, update.usage, since, newEntry);
    }
    cache.grok[file.path] = newEntry;
  }

  return {
    available: true,
    rows: Array.from(agg.entries()).map(([key, v]) => {
      const [model, date] = key.split("|");
      return {
        source: "grok-build" as const,
        model,
        date,
        sessions: v.sessions.size,
        // Grok Build 的 input 含 cached（OpenAI 语义），拆分避免 UI 显示总量时双计
        inputTokens: Math.max(0, v.input - v.cacheRead),
        outputTokens: v.output,
        cacheCreationTokens: v.cacheCreation,
        cacheReadTokens: v.cacheRead,
        reasoningTokens: v.reasoning,
        firstAt: v.firstAt,
        lastAt: v.lastAt,
      };
    }),
  };
}
