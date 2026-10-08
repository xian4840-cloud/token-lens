import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeCapturePaths, readClaudeCaptures, readOpenCodeCaptures, openCodeCapturePaths } from "./agent-response-capture";

/**
 * Claude / OpenCode 采集日志（model-responses/*.jsonl）的增量读取。
 * 此前日志每变一次（每个请求都会追加）就从头整份重读。
 */

vi.mock("electron", () => ({ app: { getPath: () => "" } }));

let dataRoot: string, journal: string;
const rec = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, sessionId: "s1", startedAt: "2026-10-04T00:00:00Z", requestedModel: "m", responseModel: "m", inputTokens: 1, outputTokens: 2, ...extra });

beforeEach(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-journal-"));
  journal = claudeCapturePaths(dataRoot).journal;
  fs.mkdirSync(path.dirname(journal), { recursive: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

function countReadBytes(): number[] {
  const reads: number[] = [];
  const realOpen = fs.promises.open.bind(fs.promises);
  vi.spyOn(fs.promises, "open").mockImplementation(async (...args: Parameters<typeof fs.promises.open>) => {
    const h = await realOpen(...args);
    const realRead = h.read.bind(h);
    (h as unknown as { read: unknown }).read = async (buf: Buffer, off: number, len: number, pos: number) => {
      const r = await realRead(buf, off, len, pos);
      reads.push(r.bytesRead);
      return r;
    };
    return h;
  });
  return reads;
}

describe("采集日志增量读取", () => {
  it("追加后只读新增字节，结果与整份重读一致", async () => {
    fs.writeFileSync(journal, Array.from({ length: 200 }, (_, i) => rec(`a${i}`)).join("\n") + "\n");
    expect(await readClaudeCaptures(dataRoot)).toHaveLength(200);
    const added = rec("new", { responseModel: "other" }) + "\n";
    fs.appendFileSync(journal, added);
    const reads = countReadBytes();
    const records = await readClaudeCaptures(dataRoot);
    expect(reads.reduce((a, b) => a + b, 0)).toBe(Buffer.byteLength(added));
    expect(records).toHaveLength(201);
    expect(records.at(-1)).toMatchObject({ id: "new", status: "mismatch" });
  });

  it("同一 id 的后续行覆盖前一行（与整份重读语义一致），半行等补全", async () => {
    fs.writeFileSync(journal, rec("x", { responseModel: undefined }) + "\n" + rec("x").slice(0, 10));
    let records = await readClaudeCaptures(dataRoot);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("unknown");
    fs.appendFileSync(journal, rec("x").slice(10) + "\n");
    records = await readClaudeCaptures(dataRoot);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("match");
  });

  it("文件被重写变短时整份重读", async () => {
    fs.writeFileSync(journal, rec("a") + "\n" + rec("b") + "\n");
    expect(await readClaudeCaptures(dataRoot)).toHaveLength(2);
    fs.writeFileSync(journal, rec("c") + "\n");
    const records = await readClaudeCaptures(dataRoot);
    expect(records.map((r) => r.id)).toEqual(["c"]);
  });

  it("没有变化时不再打开文件；文件删除后返回空", async () => {
    fs.writeFileSync(journal, rec("a") + "\n");
    await readClaudeCaptures(dataRoot);
    const reads = countReadBytes();
    await readClaudeCaptures(dataRoot);
    expect(reads).toHaveLength(0);
    fs.unlinkSync(journal);
    expect(await readClaudeCaptures(dataRoot)).toEqual([]);
  });

  it("OpenCode 日志同样增量读取，且仍要求 sessionId", async () => {
    const oc = openCodeCapturePaths(dataRoot, path.join(dataRoot, "cfg")).journal;
    fs.writeFileSync(oc, rec("a") + "\n" + rec("b", { sessionId: undefined }) + "\n");
    expect((await readOpenCodeCaptures(dataRoot)).map((r) => r.id)).toEqual(["a"]);
    fs.appendFileSync(oc, rec("c") + "\n");
    expect((await readOpenCodeCaptures(dataRoot)).map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("并发读取", () => {
  it("同时发起的读取复用同一次结果，追加后仍只多出新增记录", async () => {
    fs.writeFileSync(journal, rec("a") + "\n");
    const [x, y] = await Promise.all([readClaudeCaptures(dataRoot), readClaudeCaptures(dataRoot)]);
    expect(x).toBe(y);
    fs.appendFileSync(journal, rec("b") + "\n");
    const reads = countReadBytes();
    expect((await readClaudeCaptures(dataRoot)).map((r) => r.id)).toEqual(["a", "b"]);
    expect(reads.reduce((s, n) => s + n, 0)).toBe(Buffer.byteLength(rec("b") + "\n"));
  });
});
