import { findOpenCodeDb } from "./paths";
import { toDateKey } from "./date";
import type { LocalUsageRow } from "./types";

interface SessionRow {
  model: string | null;
  cost: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_reasoning: number | null;
  tokens_cache_read: number | null;
  tokens_cache_write: number | null;
  time_created: number | null;
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

/** 毫秒时间戳 -> ISO 字符串 */
function msToIso(ms: number | null): string | undefined {
  if (ms == null) return undefined;
  return new Date(ms).toISOString();
}

/**
 * 扫描 OpenCode 会话：读 opencode.db 的 session 表，按 model+date 聚合 token，
 * **自带 cost 优先累加**（不经过 computeCost）。date 取 time_created 的本地日期
 * （归创建日近似--OpenCode session 表无逐条增量与结束时间，归创建日是唯一选择）。
 *
 * 用 node:sqlite（Node 22.5+ 实验性，需 --experimental-sqlite）。
 * 动态 require + try/catch：Electron 主进程若未启用 flag 或 Node 版本不支持，
 * 降级为「不可用」并返回原因，不阻塞其它来源。
 */
export async function scanOpenCode(since?: string): Promise<OpenCodeResult> {
  const dbPath = findOpenCodeDb();
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

  let rows: SessionRow[];
  try {
    rows = db
      .prepare(
        "SELECT model, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created FROM session",
      )
      .all() as SessionRow[];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    db.close();
    return { available: false, unavailableReason: `查询 session 表失败（${msg}）`, rows: [] };
  }
  db.close();

  const agg = new Map<
    string,
    {
      model: string;
      date: string;
      sessions: number;
      input: number;
      output: number;
      cacheCreation: number;
      cacheRead: number;
      reasoning: number;
      cost: number;
      firstAt?: string;
      lastAt?: string;
    }
  >();

  for (const r of rows) {
    const iso = msToIso(r.time_created);
    if (since && iso && iso < since) continue;
    const date = toDateKey(r.time_created);
    if (!date) continue;
    const model = parseModelId(r.model);
    const key = `${model}|${date}`;
    const cur = agg.get(key) ?? {
      model,
      date,
      sessions: 0,
      input: 0,
      output: 0,
      cacheCreation: 0,
      cacheRead: 0,
      reasoning: 0,
      cost: 0,
    };
    cur.sessions += 1;
    cur.input += r.tokens_input ?? 0;
    cur.output += r.tokens_output ?? 0;
    cur.cacheCreation += r.tokens_cache_write ?? 0;
    cur.cacheRead += r.tokens_cache_read ?? 0;
    cur.reasoning += r.tokens_reasoning ?? 0;
    cur.cost += r.cost ?? 0;
    if (iso) {
      if (!cur.firstAt || iso < cur.firstAt) cur.firstAt = iso;
      if (!cur.lastAt || iso > cur.lastAt) cur.lastAt = iso;
    }
    agg.set(key, cur);
  }

  const out: LocalUsageRow[] = Array.from(agg.values()).map((v) => ({
    source: "opencode" as const,
    model: v.model,
    date: v.date,
    sessions: v.sessions,
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
}
