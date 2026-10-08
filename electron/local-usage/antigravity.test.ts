import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ userData: "", conversations: "" }));
vi.mock("electron", () => ({ app: { getPath: () => mocks.userData } }));
vi.mock("./paths", () => ({
  get ANTIGRAVITY_CONVERSATIONS_DIR() {
    return mocks.conversations;
  },
}));

const { scanAntigravity, readVarint, parseProtoFields } = await import("./antigravity");
const { resetScanCache, getScanCache } = await import("./cache");

/** protobuf 编码（与 antigravity.ts 的解码互逆，用来造近真实的 metadata blob） */
function varint(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}
const tag = (num: number, wt: number) => varint((num << 3) | wt);
const fVarint = (num: number, v: number) => [...tag(num, 0), ...varint(v)];
const fBytes = (num: number, data: number[]) => [...tag(num, 2), ...varint(data.length), ...data];

const STEP_TYPE_MODEL_RESPONSE = 15;

/** 本地时间 -> {epoch 秒, 纳秒余数}，与 toDateKey 的本地归档一致 */
function localTime(y: number, mo: number, d: number, h: number, mi = 0) {
  const ms = new Date(y, mo - 1, d, h, mi).getTime();
  return { sec: Math.floor(ms / 1000), nano: (ms % 1000) * 1e6, iso: new Date(ms).toISOString() };
}

/**
 * step metadata：field 1 = 时间戳消息 {1: 秒, 2: 纳秒}，
 * field 9 = usage {1: 模型枚举, 2: input, 9: 可见输出, 10: thinking}。
 */
function metadata(opts: {
  sec: number;
  nano?: number;
  modelEnum?: number;
  input?: number;
  output?: number;
  reasoning?: number;
}): Uint8Array {
  const ts = [...fVarint(1, opts.sec), ...(opts.nano ? fVarint(2, opts.nano) : [])];
  const usage = [
    ...(opts.modelEnum !== undefined ? fVarint(1, opts.modelEnum) : []),
    ...fVarint(2, opts.input ?? 0),
    ...fVarint(9, opts.output ?? 0),
    ...fVarint(10, opts.reasoning ?? 0),
  ];
  return Uint8Array.from([...fBytes(1, ts), ...fBytes(9, usage)]);
}

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-antigravity-"));
  mocks.userData = path.join(root, "userData");
  mocks.conversations = path.join(root, "conversations");
  fs.mkdirSync(mocks.userData);
  fs.mkdirSync(mocks.conversations);
  resetScanCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function conversationDb(name: string, rows: { stepType: number; metadata: Uint8Array | null }[]) {
  const file = path.join(mocks.conversations, name);
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE steps (id INTEGER PRIMARY KEY, step_type INTEGER, metadata BLOB)");
  const ins = db.prepare("INSERT INTO steps (step_type, metadata) VALUES (?, ?)");
  for (const r of rows) ins.run(r.stepType, r.metadata);
  db.close();
  return file;
}

const byKey = (rows: { model: string; date: string }[]) =>
  Object.fromEntries(rows.map((r) => [`${r.model}|${r.date}`, r]));

describe("protobuf 解码", () => {
  it("读 varint，超过安全整数或变长异常返回 undefined", () => {
    expect(readVarint(Uint8Array.from([0x96, 0x01]), 0)).toEqual([150, 2]);
    expect(readVarint(Uint8Array.from([0x80, 0x80]), 0)).toBeUndefined();
    const ff = (n: number) => Array<number>(n).fill(0xff);
    // 恰好 2^53-1 还能读，再大一位就丢弃
    expect(readVarint(Uint8Array.from([...ff(7), 0x0f]), 0)).toEqual([Number.MAX_SAFE_INTEGER, 8]);
    expect(readVarint(Uint8Array.from([...ff(7), 0x1f]), 0)).toBeUndefined();
    // 超过 8 字节的变长视为损坏
    expect(readVarint(Uint8Array.from([...ff(8), 0x01]), 0)).toBeUndefined();
  });

  it("字段齐全时还原；截断、非法 wire type、field 0 视为损坏", () => {
    const buf = Uint8Array.from(metadata({ sec: 1700000000, modelEnum: 1026, input: 100 }));
    const fields = parseProtoFields(buf);
    expect(fields?.map((f) => f.num)).toEqual([1, 9]);
    expect(parseProtoFields(buf.subarray(0, 4))).toBeUndefined();
    expect(parseProtoFields(Uint8Array.from([(3 << 3) | 3]))).toBeUndefined();
    expect(parseProtoFields(Uint8Array.from([0x00]))).toBeUndefined();
  });
});

describe("scanAntigravity", () => {
  it("没有会话目录 / 目录为空报不可用", async () => {
    fs.rmSync(mocks.conversations, { recursive: true });
    let r = await scanAntigravity();
    expect(r.available).toBe(false);
    expect(r.unavailableReason).toContain("未找到");
    fs.mkdirSync(mocks.conversations);
    fs.writeFileSync(path.join(mocks.conversations, "notes.txt"), "x");
    r = await scanAntigravity();
    expect(r.available).toBe(false);
    expect(r.unavailableReason).toContain("为空");
  });

  it("按模型枚举与本地日期聚合 step_type=15 的 usage，其它步骤忽略", async () => {
    const t1 = localTime(2026, 10, 7, 9, 30);
    const t2 = localTime(2026, 10, 7, 14, 0);
    const t3 = localTime(2026, 10, 8, 0, 5);
    conversationDb("conv-a.db", [
      { stepType: 1, metadata: metadata({ sec: t1.sec, modelEnum: 1026, input: 9999 }) },
      {
        stepType: STEP_TYPE_MODEL_RESPONSE,
        metadata: metadata({
          sec: t1.sec,
          nano: t1.nano,
          modelEnum: 1026,
          input: 1200,
          output: 80,
          reasoning: 40,
        }),
      },
      {
        stepType: STEP_TYPE_MODEL_RESPONSE,
        metadata: metadata({ sec: t2.sec, modelEnum: 1084, input: 300, output: 20 }),
      },
      {
        stepType: STEP_TYPE_MODEL_RESPONSE,
        metadata: metadata({ sec: t3.sec, modelEnum: 1026, input: 10, output: 1 }),
      },
    ]);
    conversationDb("conv-b.db", [
      {
        stepType: STEP_TYPE_MODEL_RESPONSE,
        metadata: metadata({ sec: t2.sec + 60, modelEnum: 1026, input: 100, output: 5 }),
      },
    ]);
    const r = await scanAntigravity();
    expect(r.available).toBe(true);
    const rows = byKey(r.rows);
    expect(Object.keys(rows).sort()).toEqual([
      "claude-opus-4-6-thinking|2026-10-07",
      "claude-opus-4-6-thinking|2026-10-08",
      "gemini-3.5-flash|2026-10-07",
    ]);
    expect(rows["claude-opus-4-6-thinking|2026-10-07"]).toMatchObject({
      source: "antigravity",
      sessions: 2,
      inputTokens: 1200 + 100,
      outputTokens: 80 + 5,
      reasoningTokens: 40,
      cacheReadTokens: 0,
      firstAt: t1.iso,
      lastAt: new Date((t2.sec + 60) * 1000).toISOString(),
    });
    expect(rows["gemini-3.5-flash|2026-10-07"]).toMatchObject({ sessions: 1, inputTokens: 300 });
  });

  it("未知模型枚举、缺 input、损坏 blob、超界时间戳都跳过", async () => {
    const t = localTime(2026, 10, 7, 10);
    const noInput = Uint8Array.from([
      ...fBytes(1, fVarint(1, t.sec)),
      ...fBytes(9, fVarint(1, 1026)),
    ]);
    conversationDb("conv.db", [
      {
        stepType: STEP_TYPE_MODEL_RESPONSE,
        metadata: metadata({ sec: t.sec, modelEnum: 7, input: 50, output: 5 }),
      },
      { stepType: STEP_TYPE_MODEL_RESPONSE, metadata: noInput },
      { stepType: STEP_TYPE_MODEL_RESPONSE, metadata: Uint8Array.from([0xff, 0xff]) },
      { stepType: STEP_TYPE_MODEL_RESPONSE, metadata: null },
      {
        stepType: STEP_TYPE_MODEL_RESPONSE,
        metadata: metadata({ sec: 9e12, modelEnum: 1026, input: 9 }),
      },
    ]);
    const r = await scanAntigravity();
    expect(r.rows).toEqual([
      expect.objectContaining({ model: "antigravity-model-M7", inputTokens: 50, outputTokens: 5 }),
    ]);
  });

  it("since：跨界会话逐行过滤，mtime 早于 since 的会话整个跳过", async () => {
    const old = conversationDb("old.db", [
      {
        stepType: STEP_TYPE_MODEL_RESPONSE,
        metadata: metadata({ sec: localTime(2026, 9, 1, 10).sec, modelEnum: 1026, input: 1 }),
      },
    ]);
    const oldTime = new Date(2026, 8, 1, 10);
    fs.utimesSync(old, oldTime, oldTime);
    const early = localTime(2026, 10, 6, 10);
    const late = localTime(2026, 10, 7, 10);
    conversationDb("span.db", [
      {
        stepType: STEP_TYPE_MODEL_RESPONSE,
        metadata: metadata({ sec: early.sec, modelEnum: 1026, input: 50 }),
      },
      {
        stepType: STEP_TYPE_MODEL_RESPONSE,
        metadata: metadata({ sec: late.sec, modelEnum: 1026, input: 70 }),
      },
    ]);
    const r = await scanAntigravity(localTime(2026, 10, 7, 0).iso);
    expect(r.rows).toEqual([expect.objectContaining({ date: "2026-10-07", inputTokens: 70 })]);
  });

  it("缓存：mtime 未变不重开数据库；.db-wal 更新后重读", async () => {
    const file = conversationDb("conv.db", [
      {
        stepType: STEP_TYPE_MODEL_RESPONSE,
        metadata: metadata({
          sec: localTime(2026, 10, 7, 10).sec,
          modelEnum: 1026,
          input: 10,
          output: 1,
        }),
      },
    ]);
    const T = Math.floor(Date.now() / 1000);
    fs.utimesSync(file, T, T);
    const first = await scanAntigravity();
    expect(getScanCache().antigravity[file]?.models["claude-opus-4-6-thinking"]).toBeTruthy();

    const db = new DatabaseSync(file);
    db.prepare("INSERT INTO steps (step_type, metadata) VALUES (?, ?)").run(
      STEP_TYPE_MODEL_RESPONSE,
      metadata({ sec: localTime(2026, 10, 7, 11).sec, modelEnum: 1084, input: 99 }),
    );
    db.close();
    fs.utimesSync(file, T, T);
    const open = vi.spyOn(DatabaseSync.prototype, "prepare");
    const cached = await scanAntigravity();
    expect(cached.rows).toEqual(first.rows);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();

    // WAL 未 checkpoint：主文件 mtime 不变，-wal 变新也应视为有更新
    fs.writeFileSync(file + "-wal", "x");
    fs.utimesSync(file + "-wal", T + 5, T + 5);
    const fresh = await scanAntigravity();
    expect(fresh.rows.map((r) => r.model).sort()).toEqual([
      "claude-opus-4-6-thinking",
      "gemini-3.5-flash",
    ]);
  });

  it("全部会话都打不开时报不可用，而不是零用量", async () => {
    const file = path.join(mocks.conversations, "bad.db");
    fs.writeFileSync(file, "not a sqlite database");
    const r = await scanAntigravity();
    expect(r.available).toBe(false);
    expect(r.unavailableReason).toContain("全部 1 个会话库");
    expect(r.rows).toEqual([]);
  });

  it("表结构不对的会话跳过，其余照常", async () => {
    const bad = path.join(mocks.conversations, "bad.db");
    const db = new DatabaseSync(bad);
    db.exec("CREATE TABLE other (id INTEGER)");
    db.close();
    const t = localTime(2026, 10, 7, 10);
    conversationDb("good.db", [
      {
        stepType: STEP_TYPE_MODEL_RESPONSE,
        metadata: metadata({ sec: t.sec, modelEnum: 1026, input: 10 }),
      },
    ]);
    const r = await scanAntigravity();
    expect(r.available).toBe(true);
    expect(r.rows).toEqual([expect.objectContaining({ inputTokens: 10 })]);
  });
});
