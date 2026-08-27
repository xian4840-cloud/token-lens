import fs from "node:fs";
import readline from "node:readline";
import { CODEX_SESSIONS_DIR, CODEX_CONFIG } from "./paths";
import { listJsonlFilesWithStat } from "./files";
import { toDateKey } from "./date";
import {
  getScanCache,
  isCodexEntryValid,
  type CodexFileEntry,
  type CodexSample,
} from "./cache";
import type { LocalUsageRow } from "./types";

interface TotalTokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

interface CodexLine {
  type?: string;
  timestamp?: string;
  payload?: {
    thread_source?: string;
    info?: { total_token_usage?: TotalTokenUsage };
  };
}

interface CodexConfig {
  model?: string;
  subagentModel?: string;
}

/** 从 config.toml 读主模型与 subagent 模型（正则，避免依赖 toml 库）。 */
function readCodexConfig(): CodexConfig {
  if (!fs.existsSync(CODEX_CONFIG)) return {};
  let text: string;
  try {
    text = fs.readFileSync(CODEX_CONFIG, "utf8");
  } catch {
    return {};
  }
  const cfg: CodexConfig = {};
  // 顶层 model = "..."（不匹配 default_subagent_model，因正则要求行首 model 紧跟 =）
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

/**
 * 把一段 diff 增量（相邻 total_token_usage 采样点之差）累加进 (model, date) 桶。
 * date 取结束采样点的本地日期；firstAt/lastAt 用结束采样点时间。
 */
function addDelta(
  agg: Map<string, ModelDayAgg>,
  model: string,
  filePath: string,
  endTs: string,
  delta: {
    input: number;
    cached: number;
    cacheWrite: number;
    output: number;
    reasoning: number;
  },
): void {
  const date = toDateKey(endTs);
  if (!date) return;
  const key = `${model}|${date}`;
  const cur = agg.get(key) ?? freshAgg();
  cur.sessions.add(filePath);
  cur.input += delta.input;
  cur.output += delta.output;
  cur.cacheCreation += delta.cacheWrite;
  cur.cacheRead += delta.cached;
  cur.reasoning += delta.reasoning;
  if (!cur.firstAt || endTs < cur.firstAt) cur.firstAt = endTs;
  if (!cur.lastAt || endTs > cur.lastAt) cur.lastAt = endTs;
  agg.set(key, cur);
}

/**
 * 对 session 内 total_token_usage 采样序列做差分，按结束采样点日期落桶。
 * samples 按 ts 升序；**只计算相邻采样点的差分，跳过首个点**（避免将累计值误作增量）。
 * 累计值非单调时 diff 取 max(0, ...) 兜底，避免负数。
 * since 行级过滤：结束采样点 ts < since 的增量跳过（但 prev 仍前进，保持累计基线）。
 *
 * 修复说明：原逻辑将首个采样点的值当作增量，但会话重启或恢复检查点时该值可能
 * 是累计值，导致重复计算。修正为只累加相邻点的差值，首个点作为基线不计入。
 *
 * 注：跨日 diff 归到结束采样点日期，是 session 内最大精度；按时间比例拆分到两天属
 * 过度工程，且 Codex 单次会话通常不跨日，此近似可接受。
 */
function diffSamples(
  agg: Map<string, ModelDayAgg>,
  model: string,
  filePath: string,
  samples: CodexSample[],
  since?: string,
): void {
  const sorted = [...samples].sort((a, b) => a.ts.localeCompare(b.ts));
  let prev: CodexSample | null = null;
  for (const s of sorted) {
    // 首个采样点作为基线，不计入统计（避免累计值被误作增量）
    if (prev === null) {
      prev = s;
      continue;
    }

    const delta = {
      input: Math.max(0, s.input - prev.input),
      cached: Math.max(0, s.cached - prev.cached),
      cacheWrite: Math.max(0, s.cacheWrite - prev.cacheWrite),
      output: Math.max(0, s.output - prev.output),
      reasoning: Math.max(0, s.reasoning - prev.reasoning),
    };

    // since 行级过滤：该增量段结束于 since 前则跳过（prev 仍前进保持累计基线）
    if (since && s.ts < since) {
      prev = s;
      continue;
    }
    if (
      delta.input + delta.cached + delta.cacheWrite + delta.output + delta.reasoning >
      0
    ) {
      addDelta(agg, model, filePath, s.ts, delta);
    }
    prev = s;
  }
}

/**
 * 扫描 Codex 会话记录：收集 session 内 total_token_usage 采样序列，差分按天落桶。
 * 按 session_meta.thread_source 分派主模型（user）与 subagent 模型（subagent）。
 *
 * token 语义：input_tokens 已含 cached_input_tokens（OpenAI 习惯）。
 * **存储时拆分**：inputTokens 存为不含缓存的纯输入，cacheReadTokens 单独存，
 * 避免 UI 显示总量时双重计算（inputTokens + cacheReadTokens 会重复）。
 * cost 换算在 index.ts 中处理，已正确拆分。
 *
 * 性能：mtime 未变的文件走缓存（存采样序列，命中后内存 diff 不重读）；
 * 带 since 时旧文件按 mtime 整体跳过，跨界文件用缓存序列 + since 过滤 diff。
 */
export async function scanCodex(since?: string): Promise<LocalUsageRow[]> {
  const files = listJsonlFilesWithStat(CODEX_SESSIONS_DIR);
  const cache = getScanCache();
  const cfg = readCodexConfig();
  const mainModel = cfg.model ?? "codex";
  const subModel = cfg.subagentModel ?? mainModel;
  const sinceMs = since ? Date.parse(since) : Number.NaN;

  const agg = new Map<string, ModelDayAgg>();

  for (const file of files) {
    // A 类：mtime 早于 since（留 60s 临界余量）-> 整文件排除
    if (!Number.isNaN(sinceMs) && file.mtimeMs + 60_000 < sinceMs) continue;

    const entry = cache.codex[file.path];
    if (entry && entry.mtimeMs === file.mtimeMs && isCodexEntryValid(entry)) {
      if (entry.samples.length === 0) continue; // 无 token 记录的文件
      // 用缓存存的模型（避免 config 变更后重派导致 upsert 双计）；旧缓存无 model 才重派
      const model =
        entry.model ??
        (entry.threadSource === "subagent" ? subModel : mainModel);
      // B 类：全量扫描，或文件最早采样点已在界内 -> 复用缓存序列内存 diff（不过滤）
      if (
        since === undefined ||
        (entry.firstTs !== undefined && entry.firstTs >= since)
      ) {
        diffSamples(agg, model, file.path, entry.samples, undefined);
        continue;
      }
      // C 类：跨界文件，用缓存序列 + since 过滤 diff（无需重读文件）
      if (entry.firstTs !== undefined && entry.firstTs < since) {
        diffSamples(agg, model, file.path, entry.samples, since);
        continue;
      }
      // firstTs 缺失（罕见）：落到下方逐行读重扫
    }

    // 逐行读构建采样序列（无缓存或缓存无效），同时写缓存
    const samples: CodexSample[] = [];
    let threadSource: string | undefined;
    let firstTs: string | undefined;
    let lastTs: string | undefined;
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
      let obj: CodexLine;
      try {
        obj = JSON.parse(trimmed) as CodexLine;
      } catch {
        continue;
      }
      if (obj.timestamp) {
        if (!firstTs || obj.timestamp < firstTs) firstTs = obj.timestamp;
        if (!lastTs || obj.timestamp > lastTs) lastTs = obj.timestamp;
      }
      if (obj.type === "session_meta" && obj.payload?.thread_source) {
        threadSource = obj.payload.thread_source;
      }
      const u = obj.payload?.info?.total_token_usage;
      if (u && obj.timestamp) {
        samples.push({
          ts: obj.timestamp,
          input: u.input_tokens ?? 0,
          cached: u.cached_input_tokens ?? 0,
          cacheWrite: u.cache_write_input_tokens ?? 0,
          output: u.output_tokens ?? 0,
          reasoning: u.reasoning_output_tokens ?? 0,
        });
      }
    }

    const model = threadSource === "subagent" ? subModel : mainModel;
    cache.codex[file.path] = {
      mtimeMs: file.mtimeMs,
      threadSource,
      model,
      firstTs,
      lastTs,
      samples,
    };

    if (samples.length === 0) continue;
    diffSamples(agg, model, file.path, samples, since);
  }

  return Array.from(agg.entries()).map(([key, v]) => {
    const [model, date] = key.split("|");
    return {
      source: "codex" as const,
      model,
      date,
      sessions: v.sessions.size,
      // Codex 的 input 含 cached（OpenAI 语义），拆分避免 UI 显示总量时双计
      inputTokens: Math.max(0, v.input - v.cacheRead),
      outputTokens: v.output,
      cacheCreationTokens: v.cacheCreation,
      cacheReadTokens: v.cacheRead,
      reasoningTokens: v.reasoning,
      firstAt: v.firstAt,
      lastAt: v.lastAt,
    };
  });
}
