import fs from "node:fs";
import path from "node:path";
import { ANTIGRAVITY_CONVERSATIONS_DIR } from "./paths";
import { toDateKey } from "./date";
import {
  getScanCache,
  isAntigravityEntryValid,
  type AntigravityFileEntry,
  type AntigravityModelDayAgg,
} from "./cache";
import type { LocalUsageRow } from "./types";

export interface AntigravityResult {
  available: boolean;
  unavailableReason?: string;
  rows: LocalUsageRow[];
}

/**
 * Antigravity 内部模型枚举 -> 模型名。
 * 实测自 ~/.gemini/antigravity 会话库（model_enum kv 如 MODEL_PLACEHOLDER_M298、
 * executor 配置的模型字符串、transcript 的 USER_SETTINGS_CHANGE 三方交叉印证）。
 * 未知枚举回退 `antigravity-model-M<enum>`，价格表匹配不到时费用列显示「-」。
 */
const MODEL_ENUM: Record<number, string> = {
  1026: "claude-opus-4-6-thinking",
  1084: "gemini-3.5-flash",
  1298: "gemini-3.7-flash-high",
  1299: "gemini-3.7-flash-medium",
};

/** 模型响应步骤的 step_type（PLANNER/MODEL 输出行，metadata 带 usage） */
const STEP_TYPE_MODEL_RESPONSE = 15;

// ---- 轻量 protobuf wire-format 解析（steps.metadata 列是 protobuf 二进制 blob）----

interface ProtoField {
  num: number;
  /** wire type 0；超过 2^53 视为非法丢弃（时间戳/token 数均远小于该值） */
  varint?: number;
  /** wire type 2（length-delimited，嵌套消息或字节串） */
  data?: Uint8Array;
}

function readVarint(buf: Uint8Array, pos: number): [number, number] | undefined {
  let val = 0;
  let shift = 0;
  while (pos < buf.length) {
    const b = buf[pos++];
    val += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) {
      return val <= Number.MAX_SAFE_INTEGER ? [val, pos] : undefined;
    }
    shift += 7;
    if (shift > 49) return undefined; // 变长异常，视为损坏
  }
  return undefined;
}

/** 解析一条 protobuf 消息为字段数组；结构异常返回 undefined（调用方跳过该 blob） */
function parseProtoFields(buf: Uint8Array): ProtoField[] | undefined {
  const fields: ProtoField[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const tag = readVarint(buf, pos);
    if (!tag) return undefined;
    const [t, p1] = tag;
    pos = p1;
    const num = t >> 3;
    const wt = t & 7;
    if (num === 0) return undefined;
    if (wt === 0) {
      const v = readVarint(buf, pos);
      if (!v) return undefined;
      pos = v[1];
      fields.push({ num, varint: v[0] });
    } else if (wt === 1) {
      if (pos + 8 > buf.length) return undefined;
      pos += 8;
    } else if (wt === 5) {
      if (pos + 4 > buf.length) return undefined;
      pos += 4;
    } else if (wt === 2) {
      const len = readVarint(buf, pos);
      if (!len) return undefined;
      pos = len[1];
      const l = len[0];
      if (pos + l > buf.length) return undefined;
      fields.push({ num, data: buf.subarray(pos, pos + l) });
      pos += l;
    } else {
      return undefined;
    }
  }
  return fields;
}

/** 单次模型生成的 usage（从 step metadata 的 field 9 解出） */
interface StepUsage {
  modelEnum: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  tsMs: number;
}

/**
 * 解析一条 step 的 metadata blob：
 * - field 1 = 时间戳消息 {1: epoch 秒, 2: 纳秒余数}
 * - field 9 = usage 消息 {1: 模型枚举, 2: input, 9: 可见输出, 10: thinking}
 *   （field 3 = 9 + 10 为总输出，仅作校验不使用；field 5 为上下文累计量，与计费无关）
 * 非 model 响应步骤或解析失败返回 undefined。
 */
function parseStepMetadata(blob: Uint8Array, stepType: number): StepUsage | undefined {
  if (stepType !== STEP_TYPE_MODEL_RESPONSE) return undefined;
  const top = parseProtoFields(blob);
  if (!top) return undefined;
  const f9 = top.find((f) => f.num === 9 && f.data);
  const f1 = top.find((f) => f.num === 1 && f.data);
  if (!f9 || !f1) return undefined;

  const usage = parseProtoFields(f9.data!);
  const tsMsg = parseProtoFields(f1.data!);
  if (!usage || !tsMsg) return undefined;

  const enumF = usage.find((f) => f.num === 1 && f.varint !== undefined);
  const inputF = usage.find((f) => f.num === 2 && f.varint !== undefined);
  // input 缺失说明不是 LLM usage 结构（部分步骤 field 9 存的是其它消息），跳过
  if (!inputF || inputF.varint === undefined) return undefined;

  const sec = tsMsg.find((f) => f.num === 1 && f.varint !== undefined)?.varint;
  const nano = tsMsg.find((f) => f.num === 2 && f.varint !== undefined)?.varint ?? 0;
  if (sec === undefined) return undefined;
  const tsMs = sec * 1000 + Math.floor(nano / 1e6);
  // 8.64e15 为 Date 合法上界（±100M 天），超界会令后续 toISOString 抛 RangeError
  if (!Number.isFinite(tsMs) || tsMs <= 0 || tsMs > 8.64e15) return undefined;

  return {
    modelEnum: enumF?.varint ?? -1,
    inputTokens: inputF.varint,
    outputTokens:
      usage.find((f) => f.num === 9 && f.varint !== undefined)?.varint ?? 0,
    reasoningTokens:
      usage.find((f) => f.num === 10 && f.varint !== undefined)?.varint ?? 0,
    tsMs,
  };
}

function enumToModel(e: number): string {
  return MODEL_ENUM[e] ?? `antigravity-model-M${e}`;
}

/** 会话 db 的有效 mtime：WAL 未 checkpoint 时主文件不变，需并入 -wal 的 mtime */
function effectiveMtime(dbPath: string): number {
  try {
    let m = fs.statSync(dbPath).mtimeMs;
    try {
      m = Math.max(m, fs.statSync(dbPath + "-wal").mtimeMs);
    } catch {
      // 无 -wal 文件，正常
    }
    return m;
  } catch {
    return 0;
  }
}

interface ModelDayAgg {
  sessions: Set<string>;
  input: number;
  output: number;
  reasoning: number;
  firstAt?: string;
  lastAt?: string;
}

function freshAgg(): ModelDayAgg {
  return { sessions: new Set<string>(), input: 0, output: 0, reasoning: 0 };
}

/** 缓存命中且整文件在界内：合并 per-model-per-day 全量聚合 */
function mergeEntry(
  agg: Map<string, ModelDayAgg>,
  filePath: string,
  entry: AntigravityFileEntry,
): void {
  for (const [model, days] of Object.entries(entry.models)) {
    for (const [date, m] of Object.entries(days)) {
      const key = `${model}|${date}`;
      const cur = agg.get(key) ?? freshAgg();
      cur.sessions.add(filePath);
      cur.input += m.input;
      cur.output += m.output;
      cur.reasoning += m.reasoning;
      if (m.firstTs && (!cur.firstAt || m.firstTs < cur.firstAt)) cur.firstAt = m.firstTs;
      if (m.lastTs && (!cur.lastAt || m.lastTs > cur.lastAt)) cur.lastAt = m.lastTs;
      agg.set(key, cur);
    }
  }
}

interface StepRow {
  step_type: number;
  metadata: Uint8Array | null;
}

/**
 * 扫描 Gemini Antigravity 会话库：~/.gemini/antigravity/conversations/*.db，
 * 每个会话一个 SQLite，steps 表 step_type=15（模型响应）行的 metadata（protobuf）
 * 携带 token usage，按 model+date 聚合。
 * 数据格式为逆向解析（无官方 schema），字段语义见 parseStepMetadata 注释。
 *
 * 性能：与 Claude Code 相同的三级 mtime 缓存（cache.ts antigravity 段），
 * mtime 取 .db 与 .db-wal 的较大值（WAL 未 checkpoint 时主文件 mtime 不更新）。
 */
export async function scanAntigravity(since?: string): Promise<AntigravityResult> {
  if (!fs.existsSync(ANTIGRAVITY_CONVERSATIONS_DIR)) {
    return {
      available: false,
      unavailableReason: "未找到 Antigravity 会话目录（~/.gemini/antigravity，可能未安装或未使用）",
      rows: [],
    };
  }

  let dbFiles: string[];
  try {
    dbFiles = fs
      .readdirSync(ANTIGRAVITY_CONVERSATIONS_DIR)
      .filter((f) => f.endsWith(".db"))
      .map((f) => path.join(ANTIGRAVITY_CONVERSATIONS_DIR, f));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { available: false, unavailableReason: `读取会话目录失败（${msg}）`, rows: [] };
  }
  if (dbFiles.length === 0) {
    return { available: false, unavailableReason: "Antigravity 会话目录为空", rows: [] };
  }

  let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
  try {
    const mod = require("node:sqlite") as typeof import("node:sqlite");
    DatabaseSync = mod.DatabaseSync;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      available: false,
      unavailableReason: `node:sqlite 不可用（${msg}）。需 Node 22.5+ 并启用 --experimental-sqlite`,
      rows: [],
    };
  }

  const cache = getScanCache();
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  const agg = new Map<string, ModelDayAgg>();
  let attempted = 0; // 实际尝试打开的会话数（不含 A 类界外跳过）
  let dbOpenFailures = 0;

  for (const dbPath of dbFiles) {
    const mtimeMs = effectiveMtime(dbPath);
    if (mtimeMs === 0) continue;

    // A 类：mtime 明显早于 since -> 该会话所有用量都在界外，整体跳过
    if (!Number.isNaN(sinceMs) && mtimeMs + 60_000 < sinceMs) continue;
    attempted += 1;

    const entry = cache.antigravity[dbPath];
    if (entry && entry.mtimeMs === mtimeMs && isAntigravityEntryValid(entry)) {
      if (Object.keys(entry.models).length === 0) continue; // 无 usage 的空会话
      // B 类：全量扫描，或会话最早 usage 已在界内 -> 整文件复用缓存
      if (
        since === undefined ||
        (entry.firstTs !== undefined && entry.firstTs >= since)
      ) {
        mergeEntry(agg, dbPath, entry);
        continue;
      }
      // C 类：跨界会话，落到下方逐行读
    }

    const newEntry: AntigravityFileEntry = { mtimeMs, models: {} };
    let db: InstanceType<typeof DatabaseSync>;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
    } catch {
      // 会话可能正被 Antigravity 写入锁定等，跳过不阻塞其它会话
      dbOpenFailures += 1;
      continue;
    }
    let rows: StepRow[];
    try {
      rows = db
        .prepare("SELECT step_type, metadata FROM steps WHERE step_type = ?")
        .all(STEP_TYPE_MODEL_RESPONSE) as StepRow[];
    } catch (e) {
      // 表结构异常（损坏/新版 schema 变更），跳过该会话
      dbOpenFailures += 1;
      db.close();
      continue;
    }
    db.close();

    const keysInFile = new Set<string>();
    for (const r of rows) {
      const blob = r.metadata;
      if (!blob || blob.length === 0) continue;
      const u = parseStepMetadata(blob, r.step_type);
      if (!u) continue;

      const iso = new Date(u.tsMs).toISOString();
      const date = toDateKey(u.tsMs);
      if (!date) continue;
      const model = enumToModel(u.modelEnum);

      // 全量聚合（缓存用，不做时间过滤）
      const em = (newEntry.models[model] ??= {});
      const ed = (em[date] ??= { input: 0, output: 0, reasoning: 0 });
      ed.input += u.inputTokens;
      ed.output += u.outputTokens;
      ed.reasoning += u.reasoningTokens;
      if (!ed.firstTs || iso < ed.firstTs) ed.firstTs = iso;
      if (!ed.lastTs || iso > ed.lastTs) ed.lastTs = iso;
      if (!newEntry.firstTs || iso < newEntry.firstTs) newEntry.firstTs = iso;

      // 结果聚合（since 行级过滤）
      if (since && iso < since) continue;
      const key = `${model}|${date}`;
      const cur = agg.get(key) ?? freshAgg();
      cur.input += u.inputTokens;
      cur.output += u.outputTokens;
      cur.reasoning += u.reasoningTokens;
      if (!cur.firstAt || iso < cur.firstAt) cur.firstAt = iso;
      if (!cur.lastAt || iso > cur.lastAt) cur.lastAt = iso;
      keysInFile.add(key);
      agg.set(key, cur);
    }
    for (const k of keysInFile) {
      agg.get(k)?.sessions.add(dbPath);
    }
    cache.antigravity[dbPath] = newEntry;
  }

  const out: LocalUsageRow[] = Array.from(agg.entries()).map(([key, v]) => {
    const [model, date] = key.split("|");
    return {
      source: "antigravity" as const,
      model,
      date,
      sessions: v.sessions.size,
      inputTokens: v.input,
      outputTokens: v.output,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: v.reasoning,
      firstAt: v.firstAt,
      lastAt: v.lastAt,
    };
  });

  // 全部会话都打不开（如 schema 变更导致表查询失败）：明确报不可用，
  // 避免呈现「正常但零用量」的静默错误答案
  if (attempted > 0 && dbOpenFailures === attempted) {
    return {
      available: false,
      unavailableReason: `全部 ${attempted} 个会话库均打开/查询失败（可能被占用或数据格式已变更）`,
      rows: [],
    };
  }

  return { available: true, rows: out };
}
