import fs from "node:fs";
import readline from "node:readline";
import { CODEX_SESSIONS_DIR, CODEX_CONFIG } from "./paths";
import { listJsonlFilesWithStat } from "./files";
import { toDateKey } from "./date";
import {
  getScanCache,
  isCodexEntryValid,
  type CodexFileEntry,
  type CodexIncrement,
} from "./cache";
import { logWarn } from "../lib/logger";
import type { LocalUsageRow } from "./types";

interface TotalTokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface CodexLine {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    thread_source?: string;
    model?: string;
    info?: {
      total_token_usage?: TotalTokenUsage;
      last_token_usage?: TotalTokenUsage;
    };
    usage?: TotalTokenUsage;
    response_id?: string;
  };
}

interface CodexConfig {
  model?: string;
  subagentModel?: string;
}

export interface CodexUsage {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
}

export type { CodexIncrement };

function readUsage(u: TotalTokenUsage | undefined): CodexUsage | null {
  if (!u) return null;
  return {
    input: u.input_tokens ?? 0,
    cached: u.cached_input_tokens ?? 0,
    cacheWrite: u.cache_write_input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    reasoning: u.reasoning_output_tokens ?? 0,
  };
}

function totalOf(u: TotalTokenUsage): number {
  if (typeof u.total_tokens === "number" && Number.isFinite(u.total_tokens)) {
    return u.total_tokens;
  }
  return (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
}

function subtractUsage(cur: CodexUsage, prev: CodexUsage): CodexUsage {
  return {
    input: Math.max(0, cur.input - prev.input),
    cached: Math.max(0, cur.cached - prev.cached),
    cacheWrite: Math.max(0, cur.cacheWrite - prev.cacheWrite),
    output: Math.max(0, cur.output - prev.output),
    reasoning: Math.max(0, cur.reasoning - prev.reasoning),
  };
}

function usageNonZero(u: CodexUsage): boolean {
  return u.input + u.cached + u.cacheWrite + u.output + u.reasoning > 0;
}

/**
 * OpenAI 口径：input 含 cache，output 含 reasoning。
 * 存盘时拆开，UI 的 input+output+cache+reasoning 才能加总而不双计。
 */
export function splitCodexUsage(u: CodexUsage): {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  reasoning: number;
} {
  return {
    input: Math.max(0, u.input - u.cached),
    output: Math.max(0, u.output - u.reasoning),
    cacheCreation: u.cacheWrite,
    cacheRead: u.cached,
    reasoning: u.reasoning,
  };
}

/** 从 config.toml 读主模型与 subagent 模型（正则，避免依赖 toml 库）。 */
function readCodexConfig(): CodexConfig {
  if (!fs.existsSync(CODEX_CONFIG)) return {};
  let text: string;
  try {
    text = fs.readFileSync(CODEX_CONFIG, "utf8");
  } catch (e) {
    logWarn(
      "local-usage",
      `读取 Codex 配置失败：${e instanceof Error ? e.message : String(e)}`,
    );
    return {};
  }
  const cfg: CodexConfig = {};
  const m1 = text.match(/^\s*model\s*=\s*"([^"]+)"/m);
  if (m1) cfg.model = m1[1];
  const m2 = text.match(/default_subagent_model\s*=\s*"([^"]+)"/);
  if (m2) cfg.subagentModel = m2[1];
  return cfg;
}

interface ModelDayAgg {
  sessions: Set<string>;
  input: number;
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

function addIncrement(
  agg: Map<string, ModelDayAgg>,
  model: string,
  filePath: string,
  ts: string,
  usage: CodexUsage,
): void {
  const date = toDateKey(ts);
  if (!date) return;
  const split = splitCodexUsage(usage);
  if (
    split.input +
      split.output +
      split.cacheCreation +
      split.cacheRead +
      split.reasoning ===
    0
  ) {
    return;
  }
  const key = `${model}|${date}`;
  const cur = agg.get(key) ?? freshAgg();
  cur.sessions.add(filePath);
  cur.input += split.input;
  cur.output += split.output;
  cur.cacheCreation += split.cacheCreation;
  cur.cacheRead += split.cacheRead;
  cur.reasoning += split.reasoning;
  if (!cur.firstAt || ts < cur.firstAt) cur.firstAt = ts;
  if (!cur.lastAt || ts > cur.lastAt) cur.lastAt = ts;
  agg.set(key, cur);
}

/**
 * 从会话事件抽出「每次 API 调用的增量」。
 *
 * - 优先 token_usage_record.usage（单次请求增量，用 response_id 去重）
 * - 否则只认 event_msg / token_count：累计值未前进则跳过（UI 刷新重放），
 *   回退则重置基线（fork / 子代理回放父会话），前进时用 last_token_usage，
 *   没有则对累计字段做差。
 * - 子代理文件的第一条 token_count 是继承的父会话快照，只作基线不计费。
 */
export function extractCodexIncrements(events: CodexLine[]): {
  threadSource?: string;
  modelHint?: string;
  increments: CodexIncrement[];
} {
  let threadSource: string | undefined;
  let modelHint: string | undefined;
  const records: CodexIncrement[] = [];
  const counts: CodexIncrement[] = [];
  const seenRecord = new Set<string>();

  let prevTotal: number | null = null;
  let prevUsage: CodexUsage | null = null;
  let subagentBaselineTaken = false;

  for (const obj of events) {
    const p = obj.payload;
    if (obj.type === "session_meta" && p?.thread_source) {
      threadSource = p.thread_source;
    }
    if (obj.type === "turn_context" && typeof p?.model === "string" && p.model) {
      modelHint = p.model;
    }

    if (obj.type === "token_usage_record") {
      const usage = readUsage(p?.usage);
      const ts = obj.timestamp;
      if (!usage || !ts) continue;
      const responseId = p?.response_id;
      if (responseId) {
        if (seenRecord.has(responseId)) continue;
        seenRecord.add(responseId);
      }
      if (!usageNonZero(usage)) continue;
      records.push({
        ts,
        responseId,
        model: modelHint,
        input: usage.input,
        cached: usage.cached,
        cacheWrite: usage.cacheWrite,
        output: usage.output,
        reasoning: usage.reasoning,
      });
      continue;
    }

    if (obj.type !== "event_msg" || p?.type !== "token_count") continue;
    const totRaw = p.info?.total_token_usage;
    if (!totRaw || !obj.timestamp) continue;
    const tt = totalOf(totRaw);
    const tot = readUsage(totRaw);
    const last = readUsage(p.info?.last_token_usage);

    if (threadSource === "subagent" && !subagentBaselineTaken) {
      subagentBaselineTaken = true;
      prevTotal = tt;
      prevUsage = tot;
      continue;
    }

    if (prevTotal == null) {
      // 主会话：从 0 起算，第一条 last_token_usage 就是第一轮增量
      const inc = last ?? tot;
      if (inc && usageNonZero(inc)) {
        counts.push({
          ts: obj.timestamp,
          model: modelHint,
          input: inc.input,
          cached: inc.cached,
          cacheWrite: inc.cacheWrite,
          output: inc.output,
          reasoning: inc.reasoning,
        });
      }
      prevTotal = tt;
      prevUsage = tot;
      continue;
    }

    if (tt === prevTotal) continue;
    if (tt < prevTotal) {
      prevTotal = tt;
      prevUsage = tot;
      continue;
    }

    let inc: CodexUsage | null = last;
    if (!inc && tot && prevUsage) inc = subtractUsage(tot, prevUsage);
    if (inc && usageNonZero(inc)) {
      counts.push({
        ts: obj.timestamp,
        model: modelHint,
        input: inc.input,
        cached: inc.cached,
        cacheWrite: inc.cacheWrite,
        output: inc.output,
        reasoning: inc.reasoning,
      });
    }
    prevTotal = tt;
    prevUsage = tot;
  }

  return {
    threadSource,
    modelHint,
    increments: records.length > 0 ? records : counts,
  };
}

/**
 * 扫描 Codex 会话。token 语义：input 含 cache、output 含 reasoning，落盘时拆开。
 */
export async function scanCodex(since?: string): Promise<LocalUsageRow[]> {
  const files = listJsonlFilesWithStat(CODEX_SESSIONS_DIR);
  const cache = getScanCache();
  const cfg = readCodexConfig();
  const mainModel = cfg.model ?? "codex";
  const subModel = cfg.subagentModel ?? mainModel;
  const sinceMs = since ? Date.parse(since) : Number.NaN;

  const agg = new Map<string, ModelDayAgg>();
  const seenResponse = new Set<string>();

  for (const file of files) {
    if (!Number.isNaN(sinceMs) && file.mtimeMs + 60_000 < sinceMs) continue;

    let increments: CodexIncrement[];
    let threadSource: string | undefined;
    let modelHint: string | undefined;

    const entry = cache.codex[file.path];
    if (entry && entry.mtimeMs === file.mtimeMs && isCodexEntryValid(entry)) {
      increments = entry.increments;
      threadSource = entry.threadSource;
      modelHint = entry.model;
    } else {
      const events: CodexLine[] = [];
      let rl: readline.Interface;
      try {
        rl = readline.createInterface({
          input: fs.createReadStream(file.path, { encoding: "utf8" }),
          crlfDelay: Infinity,
        });
      } catch (e) {
        logWarn(
          "local-usage",
          `无法打开 Codex 会话文件，已跳过：${file.path}（${e instanceof Error ? e.message : String(e)}）`,
        );
        continue;
      }
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          events.push(JSON.parse(trimmed) as CodexLine);
        } catch {
          // 坏行跳过
        }
      }
      const extracted = extractCodexIncrements(events);
      increments = extracted.increments;
      threadSource = extracted.threadSource;
      modelHint = extracted.modelHint;
      const firstTs = increments[0]?.ts;
      const lastTs = increments[increments.length - 1]?.ts;
      cache.codex[file.path] = {
        mtimeMs: file.mtimeMs,
        v: 2,
        threadSource,
        model: modelHint,
        firstTs,
        lastTs,
        increments,
      };
    }

    const fallbackModel =
      modelHint ??
      (threadSource === "subagent" ? subModel : mainModel);

    for (const inc of increments) {
      if (since && inc.ts < since) continue;
      if (inc.responseId) {
        if (seenResponse.has(inc.responseId)) continue;
        seenResponse.add(inc.responseId);
      }
      addIncrement(agg, inc.model ?? fallbackModel, file.path, inc.ts, {
        input: inc.input,
        cached: inc.cached,
        cacheWrite: inc.cacheWrite,
        output: inc.output,
        reasoning: inc.reasoning,
      });
    }
  }

  return Array.from(agg.entries()).map(([key, v]) => {
    const [model, date] = key.split("|");
    return {
      source: "codex" as const,
      model,
      date,
      sessions: v.sessions.size,
      inputTokens: v.input,
      outputTokens: v.output,
      cacheCreationTokens: v.cacheCreation,
      cacheReadTokens: v.cacheRead,
      reasoningTokens: v.reasoning,
      firstAt: v.firstAt,
      lastAt: v.lastAt,
    };
  });
}
