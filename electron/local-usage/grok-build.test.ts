import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ userData: "", sessions: "" }));
vi.mock("electron", () => ({ app: { getPath: () => mocks.userData } }));
vi.mock("./paths", () => ({
  get GROK_SESSIONS_DIR() {
    return mocks.sessions;
  },
}));

const { scanGrokBuild, usageParts } = await import("./grok-build");
const { resetScanCache, getScanCache } = await import("./cache");

describe("usageParts", () => {
  it("从 output 里拆出 reasoning，不双计", () => {
    const p = usageParts({
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 10,
      cachedReadTokens: 20,
      cacheCreationTokens: 3,
    });
    expect(p.output).toBe(40);
    expect(p.reasoning).toBe(10);
    expect(p.input).toBe(100);
    expect(p.cacheRead).toBe(20);
    expect(p.cacheCreation).toBe(3);
  });

  it("reasoning 大于 output 时 output 夹到 0，不当成负数", () => {
    const p = usageParts({ outputTokens: 5, reasoningTokens: 9 });
    expect(p.output).toBe(0);
    expect(p.reasoning).toBe(9);
  });
});

/**
 * 整条扫描链路：目录 -> updates.jsonl -> turn_completed -> (模型, 本地日期) 聚合 -> 缓存。
 * 样本的字段形状照 ~/.grok/sessions 里的真实记录：JSON-RPC 的 session/update 通知，
 * 顶层 timestamp 是整数秒，每轮结束一条 turn_completed，usage.modelUsage 按模型分项。
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-grok-"));
  mocks.userData = path.join(root, "userData");
  mocks.sessions = path.join(root, "sessions");
  fs.mkdirSync(mocks.userData);
  resetScanCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

/** 本地时间 -> epoch 秒（日期归档按本地时区，样本也用本地时间构造） */
const sec = (y: number, mo: number, d: number, h: number, mi = 0) =>
  Math.floor(new Date(y, mo - 1, d, h, mi).getTime() / 1000);

interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number;
  modelUsage?: Record<string, Usage>;
}

const notify = (timestamp: number, update: Record<string, unknown>) =>
  JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    timestamp,
    params: { sessionId: "019a-sess", update },
  });

const turn = (timestamp: number, usage: Usage) =>
  notify(timestamp, { sessionUpdate: "turn_completed", stopReason: "end_turn", usage });

/** 一轮里先有若干流式消息块，再是 turn_completed，与真实文件相同 */
const chunk = (timestamp: number, text: string) =>
  notify(timestamp, {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  });

function writeSession(project: string, session: string, lines: string[], name = "updates.jsonl") {
  const dir = path.join(mocks.sessions, project, session);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

const byKey = (rows: { model: string; date: string }[]) =>
  Object.fromEntries(rows.map((r) => [`${r.model}|${r.date}`, r]));

describe("scanGrokBuild", () => {
  it("没有会话目录 / 目录里没有 updates.jsonl 时报不可用", async () => {
    let r = await scanGrokBuild();
    expect(r.available).toBe(false);
    expect(r.unavailableReason).toContain("未找到");
    writeSession("-home-me-proj", "s1", ['{"q":"hi"}'], "prompt_history.jsonl");
    r = await scanGrokBuild();
    expect(r.available).toBe(false);
    expect(r.unavailableReason).toContain("为空");
  });

  it("按 modelUsage 分模型、按本地日期累加；input 扣 cache、output 扣 reasoning", async () => {
    const t1 = sec(2026, 10, 7, 9, 30);
    const t2 = sec(2026, 10, 7, 14, 0);
    const t3 = sec(2026, 10, 8, 0, 5);
    writeSession("-home-me-proj", "s1", [
      chunk(t1 - 5, "好的"),
      turn(t1, {
        inputTokens: 13000,
        outputTokens: 900,
        cachedReadTokens: 10000,
        reasoningTokens: 400,
        modelUsage: {
          "grok-code-fast-1": {
            inputTokens: 12000,
            outputTokens: 800,
            cachedReadTokens: 10000,
            reasoningTokens: 400,
          },
          "grok-4-fast": { inputTokens: 1000, outputTokens: 100 },
        },
      }),
      chunk(t2 - 1, "继续"),
      turn(t2, {
        modelUsage: {
          "grok-code-fast-1": {
            inputTokens: 2000,
            outputTokens: 200,
            cachedReadTokens: 1500,
            cacheCreationTokens: 50,
          },
        },
      }),
      // 跨过本地午夜：落到下一天
      turn(t3, { modelUsage: { "grok-code-fast-1": { inputTokens: 10, outputTokens: 5 } } }),
    ]);
    // 同一模型、同一天的另一个会话：会话数应为 2
    writeSession("-home-me-other", "s2", [
      turn(t2 + 60, { modelUsage: { "grok-code-fast-1": { inputTokens: 100, outputTokens: 10 } } }),
    ]);

    const r = await scanGrokBuild();
    expect(r.available).toBe(true);
    const rows = byKey(r.rows);
    expect(Object.keys(rows).sort()).toEqual([
      "grok-4-fast|2026-10-07",
      "grok-code-fast-1|2026-10-07",
      "grok-code-fast-1|2026-10-08",
    ]);
    expect(rows["grok-code-fast-1|2026-10-07"]).toMatchObject({
      source: "grok-build",
      sessions: 2,
      inputTokens: 12000 + 2000 + 100 - (10000 + 1500),
      cacheReadTokens: 11500,
      cacheCreationTokens: 50,
      outputTokens: 800 - 400 + 200 + 10,
      reasoningTokens: 400,
      firstAt: new Date(t1 * 1000).toISOString(),
      lastAt: new Date((t2 + 60) * 1000).toISOString(),
    });
    expect(rows["grok-4-fast|2026-10-07"]).toMatchObject({ inputTokens: 1000, outputTokens: 100 });
    expect(rows["grok-code-fast-1|2026-10-08"]).toMatchObject({ sessions: 1, inputTokens: 10 });
  });

  it("容错：坏行、半行（正在写入）、缺时间戳、无 usage 的轮次跳过；无 modelUsage 归到通用 grok", async () => {
    const t = sec(2026, 10, 7, 10);
    const file = writeSession("-p", "s", [
      "{not json turn_completed",
      notify(t, { sessionUpdate: "turn_completed" }),
      JSON.stringify({
        params: { update: { sessionUpdate: "turn_completed", usage: { inputTokens: 9 } } },
      }),
      turn(t, {}),
      turn(t, { modelUsage: { x: null as unknown as Usage } }),
      turn(t, { inputTokens: 300, outputTokens: 30 }),
    ]);
    fs.appendFileSync(file, turn(t + 1, { inputTokens: 999 }).slice(0, 40));
    const r = await scanGrokBuild();
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ model: "grok", inputTokens: 300, outputTokens: 30 });
  });

  it("since：跨界文件逐轮过滤，mtime 早于 since 的旧文件整个跳过", async () => {
    const old = writeSession("-p", "old", [
      turn(sec(2026, 9, 1, 10), { modelUsage: { m: { inputTokens: 1, outputTokens: 1 } } }),
    ]);
    const oldTime = new Date(2026, 8, 1, 10);
    fs.utimesSync(old, oldTime, oldTime);
    writeSession("-p", "span", [
      turn(sec(2026, 10, 6, 10), { modelUsage: { m: { inputTokens: 50, outputTokens: 5 } } }),
      turn(sec(2026, 10, 7, 10), { modelUsage: { m: { inputTokens: 70, outputTokens: 7 } } }),
    ]);
    const since = new Date(2026, 9, 7, 0).toISOString();
    const r = await scanGrokBuild(since);
    expect(r.rows).toEqual([expect.objectContaining({ date: "2026-10-07", inputTokens: 70 })]);
  });

  it("跨界查询：整文件缓存里有界外的轮次，结果只保留 since 之后的", async () => {
    writeSession("-p", "s", [
      turn(sec(2026, 10, 6, 10), { modelUsage: { m: { inputTokens: 50, outputTokens: 5 } } }),
      turn(sec(2026, 10, 7, 10), { modelUsage: { m: { inputTokens: 70, outputTokens: 7 } } }),
    ]);
    await scanGrokBuild();
    const r = await scanGrokBuild(new Date(2026, 9, 7, 0).toISOString());
    expect(r.rows).toEqual([expect.objectContaining({ date: "2026-10-07", inputTokens: 70 })]);
  });

  it("缓存：mtime 未变整文件复用；mtime 前进后重读", async () => {
    const file = writeSession("-p", "s", [
      turn(sec(2026, 10, 6, 10), { modelUsage: { m: { inputTokens: 50, outputTokens: 5 } } }),
      turn(sec(2026, 10, 7, 10), { modelUsage: { m: { inputTokens: 70, outputTokens: 7 } } }),
    ]);
    // 用整秒 mtime：浮点毫秒经 utimes 往返会丢精度，没法精确「还原」
    const T = Math.floor(Date.now() / 1000);
    fs.utimesSync(file, T, T);
    const first = await scanGrokBuild();
    expect(first.rows).toHaveLength(2);
    const entry = getScanCache().grok[file];
    expect(entry?.firstTs).toBe(new Date(sec(2026, 10, 6, 10) * 1000).toISOString());
    expect(entry?.models["m"]["2026-10-06"].input).toBe(50);

    // 内容改了但 mtime 还原：缓存键没变，全量扫描应直接复用缓存而不重读
    fs.writeFileSync(file, turn(sec(2026, 10, 7, 11), { inputTokens: 1 }) + "\n");
    fs.utimesSync(file, T, T);
    const read = vi.spyOn(fs, "createReadStream");
    const cached = await scanGrokBuild();
    expect(cached.rows).toEqual(first.rows);
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();

    // mtime 前进：重读新内容
    fs.utimesSync(file, T + 5, T + 5);
    const fresh = await scanGrokBuild();
    expect(fresh.rows).toEqual([expect.objectContaining({ model: "grok", inputTokens: 1 })]);
  });

  it("删除的会话文件从缓存里剪掉", async () => {
    const a = writeSession("-p", "a", [turn(sec(2026, 10, 7, 10), { inputTokens: 1 })]);
    writeSession("-p", "b", [turn(sec(2026, 10, 7, 10), { inputTokens: 2 })]);
    await scanGrokBuild();
    expect(Object.keys(getScanCache().grok)).toHaveLength(2);
    fs.rmSync(a);
    const r = await scanGrokBuild();
    expect(Object.keys(getScanCache().grok)).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ inputTokens: 2, sessions: 1 });
  });
});
