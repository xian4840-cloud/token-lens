import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Claude Code 用量的跨文件去重。
 *
 * `claude --resume` / `--continue` 会新建一个会话文件，并把旧会话的历史原样复制进去：
 * 每条 assistant 行的 message.id / requestId / timestamp 都不变，只有 sessionId 换成新的。
 * 此前去重只在单个文件内做，续接一次，旧会话的全部用量就多算一遍。
 */

const mocks = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({ app: { getPath: () => mocks.userData } }));

const { scanClaudeCode } = await import("./claude-code");
const { resetScanCache, getScanCache, persistScanCache } = await import("./cache");

let root: string, projects: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-claude-"));
  mocks.userData = path.join(root, "userData");
  fs.mkdirSync(mocks.userData);
  projects = path.join(root, "projects");
  fs.mkdirSync(path.join(projects, "-home-me-proj"), { recursive: true });
  resetScanCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

interface Msg {
  id: string;
  ts: string;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  model?: string;
}

/** 与真实日志同形：user 行 + 同一 message.id 的流式中间态 / 终态两行 assistant */
function lines(sessionId: string, msgs: Msg[]): string[] {
  const out: string[] = [];
  for (const m of msgs) {
    out.push(
      JSON.stringify({
        type: "user",
        sessionId,
        timestamp: m.ts,
        uuid: `u-${m.id}`,
        message: { role: "user", content: "hi" },
      }),
    );
    const usage = {
      input_tokens: m.input,
      output_tokens: m.output,
      cache_read_input_tokens: m.cacheRead ?? 0,
      cache_creation_input_tokens: m.cacheWrite ?? 0,
    };
    const base = {
      type: "assistant",
      sessionId,
      timestamp: m.ts,
      requestId: `req-${m.id}`,
      uuid: `a-${m.id}`,
    };
    out.push(
      JSON.stringify({
        ...base,
        message: {
          id: m.id,
          model: m.model ?? "claude-sonnet-4-5",
          role: "assistant",
          usage: { ...usage, output_tokens: 1 },
        },
      }),
    );
    out.push(
      JSON.stringify({
        ...base,
        message: { id: m.id, model: m.model ?? "claude-sonnet-4-5", role: "assistant", usage },
      }),
    );
  }
  return out;
}

function writeSession(name: string, content: string[]): string {
  const file = path.join(projects, "-home-me-proj", `${name}.jsonl`);
  fs.writeFileSync(file, content.join("\n") + "\n");
  return file;
}

const total = (rows: Awaited<ReturnType<typeof scanClaudeCode>>) =>
  rows.reduce(
    (s, r) => s + r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheCreationTokens,
    0,
  );

const day1 = [
  { id: "msg_01A", ts: "2026-09-01T02:00:00.000Z", input: 10, output: 100, cacheRead: 1000 },
  { id: "msg_01B", ts: "2026-09-01T02:05:00.000Z", input: 20, output: 200, cacheWrite: 50 },
];
const day3 = [{ id: "msg_03A", ts: "2026-09-03T02:00:00.000Z", input: 30, output: 300 }];

describe("scanClaudeCode 跨文件去重", () => {
  it("续接会话复制进来的历史只算一次（回归）", async () => {
    writeSession("aaaa-original", lines("aaaa-original", day1));
    // 续接：先是原样复制的旧历史（sessionId 已换），再是新对话
    writeSession("bbbb-resumed", lines("bbbb-resumed", [...day1, ...day3]));

    const rows = await scanClaudeCode(undefined, projects);
    expect(total(rows)).toBe(1110 + 270 + 330);
    const sept1 = rows.find((r) => r.date === "2026-09-01")!;
    expect(sept1).toMatchObject({
      inputTokens: 30,
      outputTokens: 300,
      cacheReadTokens: 1000,
      cacheCreationTokens: 50,
      sessions: 1,
    });
    expect(rows.find((r) => r.date === "2026-09-03")).toMatchObject({
      inputTokens: 30,
      sessions: 1,
    });
  });

  it("续接文件排在原文件前面时，总量同样只算一次", async () => {
    writeSession("zzzz-original", lines("zzzz-original", day1));
    writeSession("0000-resumed", lines("0000-resumed", [...day1, ...day3]));
    expect(total(await scanClaudeCode(undefined, projects))).toBe(1110 + 270 + 330);
  });

  it("单文件内的流式中间态仍只留终态", async () => {
    writeSession("solo", lines("solo", day1));
    expect(total(await scanClaudeCode(undefined, projects))).toBe(1110 + 270);
  });

  it("缓存命中时结果不变，且不再读会话文件", async () => {
    writeSession("aaaa-original", lines("aaaa-original", day1));
    writeSession("bbbb-resumed", lines("bbbb-resumed", [...day1, ...day3]));
    const first = await scanClaudeCode(undefined, projects);
    persistScanCache();
    resetScanCache(); // 模拟重启：从磁盘读缓存

    const spy = vi.spyOn(fs, "createReadStream");
    const second = await scanClaudeCode(undefined, projects);
    expect(spy).not.toHaveBeenCalled();
    expect(second).toEqual(first);
  });

  it("原文件追加新消息后，续接文件的去重结果随之重算", async () => {
    const a = writeSession("aaaa-original", lines("aaaa-original", day1));
    writeSession("bbbb-resumed", lines("bbbb-resumed", [...day1, ...day3]));
    await scanClaudeCode(undefined, projects);

    fs.appendFileSync(
      a,
      lines("aaaa-original", [
        { id: "msg_01C", ts: "2026-09-01T03:00:00.000Z", input: 1, output: 1 },
      ]).join("\n") + "\n",
    );
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(a, t, t);
    const rows = await scanClaudeCode(undefined, projects);
    expect(total(rows)).toBe(1110 + 270 + 330 + 2);
  });

  it("原文件被删掉后，续接文件里的历史重新计入", async () => {
    const a = writeSession("aaaa-original", lines("aaaa-original", day1));
    writeSession("bbbb-resumed", lines("bbbb-resumed", [...day1, ...day3]));
    await scanClaudeCode(undefined, projects);
    fs.unlinkSync(a);
    const rows = await scanClaudeCode(undefined, projects);
    expect(total(rows)).toBe(1110 + 270 + 330);
    expect(Object.keys(getScanCache().claude)).toHaveLength(1);
  });

  it("窗口扫描（since）同样去重，且只算窗口内", async () => {
    writeSession("aaaa-original", lines("aaaa-original", day1));
    writeSession("bbbb-resumed", lines("bbbb-resumed", [...day1, ...day3]));
    await scanClaudeCode(undefined, projects); // 预热缓存
    const rows = await scanClaudeCode("2026-09-02T00:00:00.000Z", projects);
    expect(total(rows)).toBe(330);
    const all = await scanClaudeCode("2026-08-01T00:00:00.000Z", projects);
    expect(total(all)).toBe(1110 + 270 + 330);
  });

  it("没有 message.id 的行不参与跨文件去重（保持原口径）", async () => {
    const anon = (sid: string) => [
      JSON.stringify({
        type: "assistant",
        sessionId: sid,
        timestamp: "2026-09-01T00:00:00Z",
        message: { model: "claude-sonnet-4-5", usage: { input_tokens: 5, output_tokens: 5 } },
      }),
    ];
    writeSession("a", anon("a"));
    writeSession("b", anon("b"));
    expect(total(await scanClaudeCode(undefined, projects))).toBe(20);
  });
});
