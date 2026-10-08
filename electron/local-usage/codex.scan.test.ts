import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ userData: "", sessions: "", config: "" }));
vi.mock("electron", () => ({ app: { getPath: () => mocks.userData } }));
vi.mock("./paths", () => ({
  get CODEX_SESSIONS_DIR() {
    return mocks.sessions;
  },
  get CODEX_CONFIG() {
    return mocks.config;
  },
}));

const { scanCodex } = await import("./codex");
const { resetScanCache, getScanCache } = await import("./cache");

/**
 * 样本形状照 ~/.codex/sessions 的真实日志：一行一个 JSON，
 * session_meta / turn_context / event_msg(token_count) / token_usage_record。
 * token_count 的 total_token_usage 是会话累计，last_token_usage 是这一轮的增量。
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-codex-"));
  mocks.userData = path.join(root, "userData");
  mocks.sessions = path.join(root, "sessions");
  mocks.config = path.join(root, "config.toml");
  fs.mkdirSync(path.join(mocks.sessions, "2026", "10", "07"), { recursive: true });
  fs.mkdirSync(mocks.userData);
  resetScanCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

/** 本地时间的 ISO，与 toDateKey 的本地归档一致 */
const iso = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).toISOString();

interface Usage {
  input?: number;
  cached?: number;
  cacheWrite?: number;
  output?: number;
  reasoning?: number;
  total?: number;
}

const u = (x: Usage) => ({
  input_tokens: x.input ?? 0,
  cached_input_tokens: x.cached ?? 0,
  cache_write_input_tokens: x.cacheWrite ?? 0,
  output_tokens: x.output ?? 0,
  reasoning_output_tokens: x.reasoning ?? 0,
  total_tokens: x.total,
});

const line = (o: Record<string, unknown>) => JSON.stringify(o);

const meta = (threadSource: string) =>
  line({
    type: "session_meta",
    timestamp: iso(2026, 10, 7, 9),
    payload: { type: "session_meta", thread_source: threadSource },
  });

const turnContext = (timestamp: string, model: string) =>
  line({ type: "turn_context", timestamp, payload: { type: "turn_context", model } });

/** 主会话一轮：累计 total + 本轮 last */
const tokenCount = (timestamp: string, total: Usage, last: Usage) =>
  line({
    type: "event_msg",
    timestamp,
    payload: {
      type: "token_count",
      info: { total_token_usage: u(total), last_token_usage: u(last) },
    },
  });

const record = (timestamp: string, responseId: string, x: Usage) =>
  line({
    type: "token_usage_record",
    timestamp,
    payload: { type: "token_usage_record", response_id: responseId, usage: u(x) },
  });

function writeSession(name: string, lines: string[]) {
  const file = path.join(mocks.sessions, "2026", "10", "07", name);
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

const byKey = (rows: { model: string; date: string }[]) =>
  Object.fromEntries(rows.map((r) => [`${r.model}|${r.date}`, r]));

describe("scanCodex", () => {
  it("会话目录不存在返回空", async () => {
    fs.rmSync(mocks.sessions, { recursive: true });
    expect(await scanCodex()).toEqual([]);
  });

  it("按 token_count 的增量累加，cache 从 input、reasoning 从 output 里拆出", async () => {
    const t1 = iso(2026, 10, 7, 9, 30);
    const t2 = iso(2026, 10, 7, 10, 0);
    const t3 = iso(2026, 10, 8, 0, 5);
    writeSession("a.jsonl", [
      meta("main"),
      turnContext(t1, "gpt-5-codex"),
      tokenCount(
        t1,
        { input: 1000, cached: 200, output: 500, reasoning: 200, total: 1500 },
        { input: 1000, cached: 200, output: 500, reasoning: 200 },
      ),
      tokenCount(
        t2,
        { input: 3000, cached: 1000, output: 900, reasoning: 300, total: 3900 },
        { input: 2000, cached: 800, output: 400, reasoning: 100 },
      ),
      // 跨过本地午夜
      turnContext(t3, "gpt-5-codex"),
      tokenCount(
        t3,
        { input: 3010, cached: 1000, output: 905, reasoning: 300, total: 3915 },
        { input: 10, output: 5 },
      ),
    ]);
    const rows = byKey(await scanCodex());
    expect(Object.keys(rows).sort()).toEqual(["gpt-5-codex|2026-10-07", "gpt-5-codex|2026-10-08"]);
    expect(rows["gpt-5-codex|2026-10-07"]).toMatchObject({
      source: "codex",
      sessions: 1,
      inputTokens: 1000 - 200 + (2000 - 800),
      cacheReadTokens: 200 + 800,
      outputTokens: 500 - 200 + (400 - 100),
      reasoningTokens: 200 + 100,
      firstAt: t1,
      lastAt: t2,
    });
    expect(rows["gpt-5-codex|2026-10-08"]).toMatchObject({ inputTokens: 10, outputTokens: 5 });
  });

  it("累计值不变（UI 刷新重放）跳过；回退（fork / 子代理回放）只重置基线、不计费", async () => {
    const t = iso(2026, 10, 7, 9);
    writeSession("a.jsonl", [
      meta("main"),
      turnContext(t, "m"),
      tokenCount(t, { input: 100, output: 10, total: 110 }, { input: 100, output: 10 }),
      tokenCount(t, { input: 100, output: 10, total: 110 }, { input: 999, output: 999 }),
      tokenCount(t, { input: 40, output: 4, total: 44 }, { input: 40, output: 4 }),
      tokenCount(t, { input: 60, output: 6, total: 66 }, { input: 20, output: 2 }),
    ]);
    const rows = await scanCodex();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inputTokens: 100 + 20, outputTokens: 10 + 2 });
  });

  it("没有 last_token_usage 时对累计字段做差", async () => {
    const t1 = iso(2026, 10, 7, 9);
    const t2 = iso(2026, 10, 7, 10);
    const count = (ts: string, total: Usage) =>
      line({
        type: "event_msg",
        timestamp: ts,
        payload: { type: "token_count", info: { total_token_usage: u(total) } },
      });
    writeSession("a.jsonl", [
      meta("main"),
      count(t1, { input: 100, cached: 40, output: 30, reasoning: 10, total: 130 }),
      count(t2, { input: 250, cached: 90, output: 80, reasoning: 25, total: 330 }),
    ]);
    expect((await scanCodex())[0]).toMatchObject({
      inputTokens: 100 - 40 + (150 - 50),
      cacheReadTokens: 40 + 50,
      outputTokens: 30 - 10 + (50 - 15),
      reasoningTokens: 10 + 15,
    });
  });

  it("子代理：第一条 token_count 是继承的父会话快照，只作基线；模型回落到配置", async () => {
    fs.writeFileSync(mocks.config, 'model = "gpt-5-main"\ndefault_subagent_model = "gpt-5-sub"\n');
    const t = iso(2026, 10, 7, 9);
    writeSession("sub.jsonl", [
      meta("subagent"),
      tokenCount(t, { input: 5000, output: 500, total: 5500 }, { input: 5000, output: 500 }),
      tokenCount(t, { input: 5100, output: 520, total: 5620 }, { input: 100, output: 20 }),
    ]);
    const rows = await scanCodex();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ model: "gpt-5-sub", inputTokens: 100, outputTokens: 20 });
  });

  it("优先用 token_usage_record，并按 response_id 跨文件去重", async () => {
    const t = iso(2026, 10, 7, 9);
    const shared = [
      meta("main"),
      turnContext(t, "gpt-5-codex"),
      record(t, "resp-1", { input: 300, cached: 100, output: 40, reasoning: 10 }),
      record(t, "resp-1", { input: 300, cached: 100, output: 40, reasoning: 10 }),
      record(t, "resp-2", { input: 50, output: 5 }),
      // 有 record 时 token_count 不再计入
      tokenCount(t, { input: 9999, output: 9999, total: 19998 }, { input: 9999, output: 9999 }),
    ];
    writeSession("a.jsonl", shared);
    // 第二个会话只有重复的 response_id，不应再计一次
    writeSession("b.jsonl", shared.slice(0, 3));
    const rows = await scanCodex();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sessions: 1,
      inputTokens: 300 - 100 + 50,
      cacheReadTokens: 100,
      outputTokens: 40 - 10 + 5,
      reasoningTokens: 10,
    });
  });

  it("坏行、缺时间戳、零用量跳过；没有 turn_context 时用配置里的主模型", async () => {
    fs.writeFileSync(mocks.config, 'model = "gpt-5-main"\n');
    const t = iso(2026, 10, 7, 9);
    const file = writeSession("a.jsonl", [
      "{bad json",
      line({ type: "token_usage_record", payload: { usage: u({ input: 9 }) } }),
      record(t, "r0", { input: 0, output: 0 }),
      record(t, "r1", { input: 10, output: 2 }),
    ]);
    fs.appendFileSync(file, '{"type":"token_usage_record","timestamp":');
    const rows = await scanCodex();
    expect(rows).toEqual([expect.objectContaining({ model: "gpt-5-main", inputTokens: 10 })]);
  });

  it("since 过滤增量；mtime 早于 since 的旧文件整个跳过", async () => {
    const old = writeSession("old.jsonl", [
      meta("main"),
      turnContext(iso(2026, 9, 1, 10), "m"),
      record(iso(2026, 9, 1, 10), "old", { input: 1, output: 1 }),
    ]);
    const oldTime = new Date(2026, 8, 1, 10);
    fs.utimesSync(old, oldTime, oldTime);
    writeSession("span.jsonl", [
      meta("main"),
      turnContext(iso(2026, 10, 6, 10), "m"),
      record(iso(2026, 10, 6, 10), "a", { input: 50, output: 5 }),
      record(iso(2026, 10, 7, 10), "b", { input: 70, output: 7 }),
    ]);
    const rows = await scanCodex(iso(2026, 10, 7, 0));
    expect(rows).toEqual([expect.objectContaining({ date: "2026-10-07", inputTokens: 70 })]);
  });

  it("缓存：mtime 未变不重读，前进后重读", async () => {
    const file = writeSession("a.jsonl", [
      meta("main"),
      turnContext(iso(2026, 10, 7, 9), "m"),
      record(iso(2026, 10, 7, 9), "r1", { input: 10, output: 1 }),
    ]);
    const T = Math.floor(Date.now() / 1000);
    fs.utimesSync(file, T, T);
    const first = await scanCodex();
    expect(getScanCache().codex[file]?.increments).toHaveLength(1);

    fs.writeFileSync(
      file,
      [meta("main"), record(iso(2026, 10, 7, 11), "r2", { input: 99, output: 9 })].join("\n"),
    );
    fs.utimesSync(file, T, T);
    const read = vi.spyOn(fs, "createReadStream");
    expect(await scanCodex()).toEqual(first);
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();

    fs.utimesSync(file, T + 5, T + 5);
    expect(await scanCodex()).toEqual([
      expect.objectContaining({ model: "codex", inputTokens: 99 }),
    ]);
  });
});
