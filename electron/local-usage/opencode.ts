import { findOpenCodeDb } from "./paths";
import { toDateKey } from "./date";
import { msToIso } from "../lib/time";
import { logWarn } from "../lib/logger";
import {
  getScanCache,
  markScanCacheDirty,
  type OpenCodeBucket,
  type OpenCodeSessionEntry,
} from "./cache";
import type { LocalUsageRow } from "./types";

interface SessionRow {
  id: string;
  model: string | null;
  cost: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_reasoning: number | null;
  tokens_cache_read: number | null;
  tokens_cache_write: number | null;
  time_created: number | null;
}

/** message 表里一条 assistant 消息的用量（json_extract 出来的列） */
interface MessageRow {
  /** data.$.time.created（消息自身的创建时间，ms） */
  t: number | null;
  /** message.time_created 列（兜底） */
  tc: number | null;
  model_id: string | null;
  cost: number | null;
  ti: number | null;
  tout: number | null;
  tr: number | null;
  cr: number | null;
  cw: number | null;
}

export interface OpenCodeResult {
  available: boolean;
  unavailableReason?: string;
  rows: LocalUsageRow[];
}

/** 解析 OpenCode model 字段（JSON 串 {"id":"...","providerID":"...","variant":"..."}）。 */
function parseModelId(raw: string | null): string {
  if (!raw) return "unknown";
  try {
    const obj = JSON.parse(raw) as { id?: string };
    return obj.id ?? "unknown";
  } catch {
    return "unknown";
  }
}

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** 会话仍算「活跃」的窗口：最后一条消息在此时间内，未对齐的拆分每轮重算 */
const ACTIVE_WINDOW_MS = 30 * 60_000;
/** 每重算这么多个会话让出一次主线程（node:sqlite 是同步 API） */
const SESSIONS_PER_YIELD = 50;

const MESSAGE_SQL =
  "SELECT json_extract(data,'$.time.created') AS t, time_created AS tc, " +
  "json_extract(data,'$.modelID') AS model_id, json_extract(data,'$.cost') AS cost, " +
  "json_extract(data,'$.tokens.input') AS ti, json_extract(data,'$.tokens.output') AS tout, " +
  "json_extract(data,'$.tokens.reasoning') AS tr, json_extract(data,'$.tokens.cache.read') AS cr, " +
  "json_extract(data,'$.tokens.cache.write') AS cw " +
  "FROM message WHERE session_id = ? AND json_extract(data,'$.role') = 'assistant'";

function fingerprint(s: SessionRow): string {
  return JSON.stringify([
    s.cost,
    s.tokens_input,
    s.tokens_output,
    s.tokens_reasoning,
    s.tokens_cache_read,
    s.tokens_cache_write,
    s.time_created,
    s.model,
  ]);
}

interface Usage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

function addBucket(
  buckets: Map<string, OpenCodeBucket>,
  model: string,
  ms: number | null,
  u: Usage,
  hasCost: boolean,
): void {
  const date = toDateKey(ms);
  if (!date) return;
  const iso = msToIso(ms);
  const key = `${model}|${date}`;
  const b = buckets.get(key) ?? {
    model,
    date,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  b.input += u.input;
  // 若 output 已含 reasoning（OpenAI 口径），拆开以免 UI 总量双计
  let output = u.output;
  if (u.reasoning > 0 && u.reasoning <= output) output -= u.reasoning;
  b.output += output;
  b.reasoning += u.reasoning;
  b.cacheRead += u.cacheRead;
  b.cacheWrite += u.cacheWrite;
  if (hasCost) b.cost = (b.cost ?? 0) + u.cost;
  if (iso) {
    if (!b.firstTs || iso < b.firstTs) b.firstTs = iso;
    if (!b.lastTs || iso > b.lastTs) b.lastTs = iso;
  }
  buckets.set(key, b);
}

function sessionUsage(s: SessionRow): Usage {
  return {
    input: num(s.tokens_input),
    output: num(s.tokens_output),
    reasoning: num(s.tokens_reasoning),
    cacheRead: num(s.tokens_cache_read),
    cacheWrite: num(s.tokens_cache_write),
    cost: num(s.cost),
  };
}

/** 旧口径：整个会话归到创建日、session.model（消息表不可用 / 对不上时的回退） */
function sessionLevel(s: SessionRow, since?: string): OpenCodeBucket[] {
  const iso = msToIso(s.time_created);
  if (since && iso && iso < since) return [];
  const buckets = new Map<string, OpenCodeBucket>();
  addBucket(
    buckets,
    parseModelId(s.model),
    s.time_created,
    sessionUsage(s),
    typeof s.cost === "number" && Number.isFinite(s.cost),
  );
  return [...buckets.values()];
}

/**
 * 把一个会话的用量按 assistant 消息自己的时间与模型拆到 (模型, 日期) 桶。
 *
 * session 表的合计列本身就是 assistant 消息 data.tokens / data.cost 的累加
 * （OpenCode 迁移 20260510033149_session_usage 就是这么回填的），所以按消息拆
 * 不会改变总量。为稳妥起见仍以 session 合计为准：
 * - 消息合计 ≤ session 合计：按消息拆，差额（若有）照旧口径归到创建日；
 * - 消息合计超过 session 合计（数据不一致）：整个会话退回旧口径，保证总量不比以前多。
 */
function splitSession(
  s: SessionRow,
  messages: MessageRow[],
  since?: string,
): { buckets: OpenCodeBucket[]; settled: boolean; lastMs?: number } {
  if (messages.length === 0) {
    return { buckets: sessionLevel(s, since), settled: true };
  }
  const total = sessionUsage(s);
  const sum: Usage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let lastMs: number | undefined;
  for (const m of messages) {
    sum.input += num(m.ti);
    sum.output += num(m.tout);
    sum.reasoning += num(m.tr);
    sum.cacheRead += num(m.cr);
    sum.cacheWrite += num(m.cw);
    sum.cost += num(m.cost);
    const ms = num(m.t) || num(m.tc);
    if (ms && (lastMs === undefined || ms > lastMs)) lastMs = ms;
  }
  const costEps = 1e-6 * Math.max(1, total.cost);
  const tokenKeys = ["input", "output", "reasoning", "cacheRead", "cacheWrite"] as const;
  const consistent = tokenKeys.every((k) => sum[k] <= total[k]) && sum.cost <= total.cost + costEps;
  if (!consistent) {
    return { buckets: sessionLevel(s, since), settled: false, lastMs };
  }

  const hasCost = typeof s.cost === "number" && Number.isFinite(s.cost);
  const fallbackModel = parseModelId(s.model);
  const buckets = new Map<string, OpenCodeBucket>();
  for (const m of messages) {
    const ms = num(m.t) || num(m.tc);
    const iso = msToIso(ms);
    if (since && iso && iso < since) continue;
    addBucket(
      buckets,
      m.model_id || fallbackModel,
      ms || null,
      {
        input: num(m.ti),
        output: num(m.tout),
        reasoning: num(m.tr),
        cacheRead: num(m.cr),
        cacheWrite: num(m.cw),
        cost: num(m.cost),
      },
      hasCost,
    );
  }
  const rest: Usage = {
    input: total.input - sum.input,
    output: total.output - sum.output,
    reasoning: total.reasoning - sum.reasoning,
    cacheRead: total.cacheRead - sum.cacheRead,
    cacheWrite: total.cacheWrite - sum.cacheWrite,
    cost: Math.abs(total.cost - sum.cost) <= costEps ? 0 : total.cost - sum.cost,
  };
  const hasRest = tokenKeys.some((k) => rest[k] > 0) || rest.cost > 0;
  if (hasRest) {
    const iso = msToIso(s.time_created);
    if (!(since && iso && iso < since)) {
      addBucket(buckets, fallbackModel, s.time_created, rest, hasCost);
    }
  }
  return { buckets: [...buckets.values()], settled: !hasRest, lastMs };
}

/**
 * 扫描 OpenCode 会话：读 opencode.db，按 model+date 聚合 token，
 * **自带 cost 优先累加**（不经过 computeCost）。
 *
 * date 取每条 assistant 消息自己的时间（message.data.time.created），模型取消息的
 * modelID。此前只读 session 表、整段会话归到创建日：跨天/跨月的长会话会把后面几天的
 * 用量全算到第一天上。session 合计列仍是总量的准绳，见 splitSession。
 *
 * 性能：逐消息 json_extract 很贵（10 万条消息约 0.5 秒，且 node:sqlite 是同步 API）。
 * 所以按会话缓存拆分结果（usage-scan-cache.json 的 opencode 段），session 合计没变的
 * 会话直接复用；只有新会话/有新用量的会话才按 session_id 走索引查消息，
 * 每重算一批会话让出一次主线程。
 *
 * 用 node:sqlite（Node 22.5+ 实验性，需 --experimental-sqlite）。
 * 动态 require + try/catch：Electron 主进程若未启用 flag 或 Node 版本不支持，
 * 降级为「不可用」并返回原因，不阻塞其它来源。
 */
export async function scanOpenCode(
  since?: string,
  dbPathOverride?: string,
): Promise<OpenCodeResult> {
  const dbPath = dbPathOverride ?? findOpenCodeDb();
  if (!dbPath) {
    return {
      available: false,
      unavailableReason: "未找到 opencode.db（OpenCode 未安装或数据目录不存在）",
      rows: [],
    };
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

  let db: InstanceType<typeof DatabaseSync>;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { available: false, unavailableReason: `打开 opencode.db 失败（${msg}）`, rows: [] };
  }

  try {
    let sessions: SessionRow[];
    try {
      // all() 的返回类型是 Record<string, SQLOutputValue>[]，这里按查询列的形状断言。
      // 必须经 unknown 中转：两者没有足够的重叠，直接 as 会被 TS 判为笔误。
      sessions = db
        .prepare(
          "SELECT id, model, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created FROM session",
        )
        .all() as unknown as SessionRow[];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { available: false, unavailableReason: `查询 session 表失败（${msg}）`, rows: [] };
    }

    let messageStmt: ReturnType<typeof db.prepare> | null = null;
    try {
      messageStmt = db.prepare(MESSAGE_SQL);
    } catch (e) {
      // 没有 message 表（或结构不符）：整体退回按会话创建日归档的旧口径
      logWarn(
        "local-usage",
        `OpenCode message 表不可用，按会话创建日归档：${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const readMessages = (id: string): MessageRow[] => {
      if (!messageStmt) return [];
      try {
        return messageStmt.all(id) as unknown as MessageRow[];
      } catch {
        return [];
      }
    };

    const cache = getScanCache();
    if (cache.opencode.db !== dbPath) {
      cache.opencode = { db: dbPath, sessions: {} };
      markScanCacheDirty();
    }
    const entries = cache.opencode.sessions;
    const live = new Set<string>();
    const now = Date.now();
    let recomputed = 0;

    const agg = new Map<
      string,
      {
        model: string;
        date: string;
        sessions: Set<string>;
        input: number;
        output: number;
        cacheCreation: number;
        cacheRead: number;
        reasoning: number;
        cost?: number;
        firstAt?: string;
        lastAt?: string;
      }
    >();
    const addToAgg = (sessionId: string, b: OpenCodeBucket) => {
      const key = `${b.model}|${b.date}`;
      const cur = agg.get(key) ?? {
        model: b.model,
        date: b.date,
        sessions: new Set<string>(),
        input: 0,
        output: 0,
        cacheCreation: 0,
        cacheRead: 0,
        reasoning: 0,
      };
      cur.sessions.add(sessionId);
      cur.input += b.input;
      cur.output += b.output;
      cur.cacheCreation += b.cacheWrite;
      cur.cacheRead += b.cacheRead;
      cur.reasoning += b.reasoning;
      if (b.cost !== undefined) cur.cost = (cur.cost ?? 0) + b.cost;
      if (b.firstTs && (!cur.firstAt || b.firstTs < cur.firstAt)) cur.firstAt = b.firstTs;
      if (b.lastTs && (!cur.lastAt || b.lastTs > cur.lastAt)) cur.lastAt = b.lastTs;
      agg.set(key, cur);
    };

    for (const s of sessions) {
      if (typeof s.id !== "string") continue;
      live.add(s.id);
      const fp = fingerprint(s);
      let entry: OpenCodeSessionEntry | undefined = entries[s.id];
      const stale =
        !entry ||
        entry.fp !== fp ||
        (!entry.settled &&
          messageStmt !== null &&
          (entry.lastMs === undefined || now - entry.lastMs < ACTIVE_WINDOW_MS));
      if (stale) {
        if (recomputed > 0 && recomputed % SESSIONS_PER_YIELD === 0) {
          await new Promise<void>((r) => setImmediate(r));
        }
        recomputed += 1;
        const split = messageStmt
          ? splitSession(s, readMessages(s.id))
          : { buckets: sessionLevel(s), settled: true };
        entry = { fp, buckets: split.buckets, settled: split.settled };
        if ("lastMs" in split && split.lastMs !== undefined) entry.lastMs = split.lastMs;
        entries[s.id] = entry;
        markScanCacheDirty();
      }
      if (!since) {
        for (const b of entry!.buckets) addToAgg(s.id, b);
        continue;
      }
      // 窗口扫描：整桶在界内/界外直接取舍；跨界的桶回到逐消息过滤（不写缓存）
      const straddles = entry!.buckets.some(
        (b) => b.firstTs !== undefined && b.firstTs < since && (b.lastTs ?? "") >= since,
      );
      const buckets = straddles
        ? messageStmt
          ? splitSession(s, readMessages(s.id), since).buckets
          : sessionLevel(s, since)
        : entry!.buckets.filter((b) => !b.lastTs || b.lastTs >= since);
      for (const b of buckets) addToAgg(s.id, b);
    }
    for (const id of Object.keys(entries)) {
      if (!live.has(id)) {
        delete entries[id];
        markScanCacheDirty();
      }
    }

    const out: LocalUsageRow[] = Array.from(agg.values()).map((v) => ({
      source: "opencode" as const,
      model: v.model,
      date: v.date,
      sessions: v.sessions.size,
      inputTokens: v.input,
      outputTokens: v.output,
      cacheCreationTokens: v.cacheCreation,
      cacheReadTokens: v.cacheRead,
      reasoningTokens: v.reasoning,
      cost: v.cost,
      currency: "USD",
      firstAt: v.firstAt,
      lastAt: v.lastAt,
    }));

    return { available: true, rows: out };
  } finally {
    db.close();
  }
}
