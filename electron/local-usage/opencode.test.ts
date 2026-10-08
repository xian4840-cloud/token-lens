import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toDateKey } from "./date";

/**
 * OpenCode 用量按消息时间归档。
 *
 * 表结构取自 OpenCode 源码（packages/core/src/database）：session 表的 cost / tokens_*
 * 合计列由迁移 20260510033149_session_usage 按 assistant 消息的 data.cost / data.tokens 回填，
 * message.data 里有 role、modelID、time.created、tokens{input,output,reasoning,cache{read,write}}、cost。
 * 此前整段会话归到 session.time_created：跨天的长会话把后几天的用量全算到第一天。
 */

const mocks = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({ app: { getPath: () => mocks.userData } }));

const { scanOpenCode } = await import("./opencode");
const { resetScanCache, persistScanCache } = await import("./cache");

let root: string, dbPath: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-opencode-"));
  mocks.userData = root;
  dbPath = path.join(root, "opencode.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE session (id text PRIMARY KEY, project_id text NOT NULL, title text, model text, cost real DEFAULT 0 NOT NULL,
      tokens_input integer DEFAULT 0 NOT NULL, tokens_output integer DEFAULT 0 NOT NULL, tokens_reasoning integer DEFAULT 0 NOT NULL,
      tokens_cache_read integer DEFAULT 0 NOT NULL, tokens_cache_write integer DEFAULT 0 NOT NULL,
      time_created integer NOT NULL, time_updated integer NOT NULL);
    CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
    CREATE INDEX message_session_time_created_id_idx ON message (session_id, time_created, id);`);
  db.close();
  resetScanCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

interface AMsg { at: Date; input: number; output: number; reasoning?: number; cacheRead?: number; cacheWrite?: number; cost: number; model?: string }

/** 写一个会话：session 合计 = 消息合计（与 OpenCode 自己的维护方式一致），可加 extra 模拟对不上 */
function addSession(id: string, created: Date, msgs: AMsg[], opts: { model?: string; extra?: Partial<Record<"input" | "output" | "cost", number>> } = {}): void {
  const db = new DatabaseSync(dbPath);
  const sum = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let n = 0;
  for (const m of msgs) {
    const t = m.at.getTime();
    db.prepare("INSERT INTO message VALUES (?,?,?,?,?)").run(`${id}-u${n}`, id, t - 1000, t - 1000,
      JSON.stringify({ role: "user", time: { created: t - 1000 }, agent: "build", model: { providerID: "anthropic", modelID: m.model ?? "claude-sonnet-4-5" } }));
    db.prepare("INSERT INTO message VALUES (?,?,?,?,?)").run(`${id}-a${n}`, id, t, t + 5000,
      JSON.stringify({ role: "assistant", parentID: `${id}-u${n}`, time: { created: t, completed: t + 5000 }, modelID: m.model ?? "claude-sonnet-4-5", providerID: "anthropic",
        cost: m.cost, tokens: { input: m.input, output: m.output, reasoning: m.reasoning ?? 0, cache: { read: m.cacheRead ?? 0, write: m.cacheWrite ?? 0 } } }));
    n++;
    sum.input += m.input; sum.output += m.output; sum.reasoning += m.reasoning ?? 0;
    sum.cacheRead += m.cacheRead ?? 0; sum.cacheWrite += m.cacheWrite ?? 0; sum.cost += m.cost;
  }
  db.prepare("INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(id, "p", "t", JSON.stringify({ id: opts.model ?? "claude-sonnet-4-5", providerID: "anthropic" }),
    sum.cost + (opts.extra?.cost ?? 0), sum.input + (opts.extra?.input ?? 0), sum.output + (opts.extra?.output ?? 0), sum.reasoning, sum.cacheRead, sum.cacheWrite,
    created.getTime(), created.getTime());
  db.close();
}

const d = (day: number, hour = 12) => new Date(2026, 8, day, hour, 0, 0);

describe("scanOpenCode 按消息时间归档", () => {
  it("跨天的会话按每条消息自己的日期拆开，总量与 session 合计一致（回归）", async () => {
    addSession("s1", d(1, 23), [
      { at: d(1, 23), input: 100, output: 10, cost: 0.1 },
      { at: d(2, 9), input: 200, output: 20, cost: 0.2 },
      { at: d(5, 9), input: 300, output: 30, cost: 0.3 },
    ]);
    const { available, rows } = await scanOpenCode(undefined, dbPath);
    expect(available).toBe(true);
    const byDate = Object.fromEntries(rows.map((r) => [r.date, r]));
    expect(Object.keys(byDate).sort()).toEqual([toDateKey(d(1).getTime())!, toDateKey(d(2).getTime())!, toDateKey(d(5).getTime())!]);
    expect(byDate[toDateKey(d(2).getTime())!]).toMatchObject({ inputTokens: 200, outputTokens: 20, sessions: 1 });
    expect(byDate[toDateKey(d(2).getTime())!].cost).toBeCloseTo(0.2);
    expect(rows.reduce((s, r) => s + r.inputTokens, 0)).toBe(600);
    expect(rows.reduce((s, r) => s + (r.cost ?? 0), 0)).toBeCloseTo(0.6);
  });

  it("会话中途切模型时按消息的 modelID 归模型", async () => {
    addSession("s1", d(1), [
      { at: d(1, 10), input: 100, output: 10, cost: 0.1, model: "claude-sonnet-4-5" },
      { at: d(1, 11), input: 50, output: 5, cost: 0.05, model: "gpt-5" },
    ], { model: "gpt-5" });
    const { rows } = await scanOpenCode(undefined, dbPath);
    expect(rows.map((r) => [r.model, r.inputTokens]).sort()).toEqual([["claude-sonnet-4-5", 100], ["gpt-5", 50]]);
  });

  it("reasoning 已含在 output 里时照旧拆开（逐条消息）", async () => {
    addSession("s1", d(1), [{ at: d(1), input: 1, output: 50, reasoning: 20, cost: 0 }]);
    const { rows } = await scanOpenCode(undefined, dbPath);
    expect(rows[0]).toMatchObject({ outputTokens: 30, reasoningTokens: 20 });
  });

  it("消息合计少于 session 合计时，差额照旧归到会话创建日", async () => {
    addSession("s1", d(1), [{ at: d(3), input: 100, output: 10, cost: 0.1 }], { extra: { input: 7, cost: 0.01 } });
    const { rows } = await scanOpenCode(undefined, dbPath);
    const byDate = Object.fromEntries(rows.map((r) => [r.date, r]));
    expect(byDate[toDateKey(d(3).getTime())!].inputTokens).toBe(100);
    expect(byDate[toDateKey(d(1).getTime())!].inputTokens).toBe(7);
    expect(byDate[toDateKey(d(1).getTime())!].cost).toBeCloseTo(0.01);
  });

  it("消息合计超过 session 合计（数据不一致）时整段退回旧口径，总量不比以前多", async () => {
    addSession("s1", d(1), [{ at: d(3), input: 100, output: 10, cost: 0.1 }], { extra: { input: -50 } });
    const { rows } = await scanOpenCode(undefined, dbPath);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: toDateKey(d(1).getTime()), inputTokens: 50 });
  });

  it("没有 message 表的旧库退回按会话创建日归档", async () => {
    addSession("s1", d(1), [{ at: d(3), input: 100, output: 10, cost: 0.1 }]);
    const db = new DatabaseSync(dbPath);
    db.exec("DROP TABLE message");
    db.close();
    const { rows } = await scanOpenCode(undefined, dbPath);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: toDateKey(d(1).getTime()), inputTokens: 100 });
  });

  it("窗口扫描按消息时间过滤：创建于窗口前、用量在窗口内的会话不再整段丢掉", async () => {
    addSession("s1", d(1), [
      { at: d(1), input: 100, output: 10, cost: 0.1 },
      { at: d(4), input: 200, output: 20, cost: 0.2 },
    ]);
    const since = d(3, 0).toISOString();
    const { rows } = await scanOpenCode(since, dbPath);
    expect(rows.map((r) => [r.date, r.inputTokens])).toEqual([[toDateKey(d(4).getTime()), 200]]);
  });

  it("session 合计没变的会话复用缓存，不再查 message 表；有新用量才重算", async () => {
    addSession("s1", d(1), [{ at: d(1), input: 100, output: 10, cost: 0.1 }]);
    addSession("s2", d(2), [{ at: d(2), input: 5, output: 1, cost: 0.01 }]);
    const first = await scanOpenCode(undefined, dbPath);
    persistScanCache();
    resetScanCache(); // 模拟重启

    // 偷偷改消息但不动 session 合计：命中缓存就不会看到这次改动
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE message SET data = json_set(data, '$.tokens.input', 999) WHERE id = 's1-a0'").run();
    db.close();
    const second = await scanOpenCode(undefined, dbPath);
    expect(second.rows).toEqual(first.rows);

    // session 合计变了（新消息落库）才重算该会话
    const db2 = new DatabaseSync(dbPath);
    db2.prepare("UPDATE message SET data = json_set(data, '$.tokens.input', 100) WHERE id = 's1-a0'").run();
    db2.prepare("INSERT INTO message VALUES ('s1-a9','s1',?,?,?)").run(d(6).getTime(), d(6).getTime(),
      JSON.stringify({ role: "assistant", time: { created: d(6).getTime() }, modelID: "claude-sonnet-4-5", cost: 0.4, tokens: { input: 40, output: 4, reasoning: 0, cache: { read: 0, write: 0 } } }));
    db2.prepare("UPDATE session SET tokens_input = tokens_input + 40, tokens_output = tokens_output + 4, cost = cost + 0.4 WHERE id = 's1'").run();
    db2.close();
    const third = await scanOpenCode(undefined, dbPath);
    expect(third.rows.find((r) => r.date === toDateKey(d(6).getTime()))).toMatchObject({ inputTokens: 40 });
    expect(third.rows.reduce((s, r) => s + r.inputTokens, 0)).toBe(145);
  });

  it("会话被删除后从结果与缓存里消失", async () => {
    addSession("s1", d(1), [{ at: d(1), input: 100, output: 10, cost: 0.1 }]);
    addSession("s2", d(2), [{ at: d(2), input: 5, output: 1, cost: 0.01 }]);
    await scanOpenCode(undefined, dbPath);
    const db = new DatabaseSync(dbPath);
    db.exec("DELETE FROM message WHERE session_id = 's2'; DELETE FROM session WHERE id = 's2';");
    db.close();
    const { rows } = await scanOpenCode(undefined, dbPath);
    expect(rows.reduce((s, r) => s + r.inputTokens, 0)).toBe(100);
  });
});
