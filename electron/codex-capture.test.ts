import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ARCHIVE_JOURNAL,
  captureDirectory,
  compactCaptureJournals,
  readCapturedModels,
  resetCaptureReaders,
} from "./codex-capture";

/**
 * Codex 采集日志（responses-<后端pid>.jsonl）的增量读取与合并。
 *
 * 此前模型监控每 3 秒把全部日志从头读一遍，日志又只增不减：
 * 几十个后端进程、每条响应 created/completed 两行，长期使用后每次轮询都要读几十 MB。
 */

let root: string, dir: string;
const DEAD_PID = 2147483646;
const row = (responseId: string, model: string, eventType = "response.completed") =>
  JSON.stringify({
    source: "codex-native-trace-v1",
    responseId,
    model,
    observedAt: "2026-10-04T00:00:01Z",
    eventType,
  });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-capture-"));
  dir = captureDirectory(root);
  fs.mkdirSync(dir);
  resetCaptureReaders();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function age(file: string, ms: number): void {
  const t = new Date(Date.now() - ms);
  fs.utimesSync(file, t, t);
}

describe("readCapturedModels 增量读取", () => {
  it("只读新追加的字节，半行留到下一次拼上", async () => {
    const journal = path.join(dir, "responses-1.jsonl");
    fs.writeFileSync(journal, row("r1", "m1") + "\n" + row("r2", "m2").slice(0, 20));
    const spy = vi.spyOn(fs.promises, "open");
    const first = await readCapturedModels(root);
    expect([...first.keys()]).toEqual(["r1"]);

    fs.appendFileSync(journal, row("r2", "m2").slice(20) + "\n");
    const second = await readCapturedModels(root);
    expect([...second.get("r2")!]).toEqual(["m2"]);

    // 没有新字节时不再打开文件
    const opens = spy.mock.calls.length;
    await readCapturedModels(root);
    expect(spy.mock.calls.length).toBe(opens);
  });

  it("读取边界切在多字节字符中间（中文 / emoji）时不会把该行解码坏", async () => {
    const journal = path.join(dir, "responses-1.jsonl");
    const line = Buffer.from(row("r-中文", "通义千问-🚀") + "\n", "utf8");
    // 分别切在 emoji（4 字节）和汉字（3 字节）中间
    for (const [needle, inside] of [
      ["🚀", 2],
      ["问", 1],
    ] as const) {
      resetCaptureReaders();
      const cut = line.indexOf(Buffer.from(needle, "utf8")) + inside;
      fs.writeFileSync(
        journal,
        Buffer.concat([Buffer.from(row("r0", "m0") + "\n"), line.subarray(0, cut)]),
      );
      expect([...(await readCapturedModels(root)).keys()]).toEqual(["r0"]);
      fs.appendFileSync(journal, line.subarray(cut));
      const models = await readCapturedModels(root);
      expect([...models.keys()].sort()).toEqual(["r-中文", "r0"]);
      expect([...models.get("r-中文")!]).toEqual(["通义千问-🚀"]);
    }
  });

  it("增量读到的字节数等于新增部分，而不是整份文件", async () => {
    const journal = path.join(dir, "responses-1.jsonl");
    fs.writeFileSync(
      journal,
      Array.from({ length: 500 }, (_, i) => row(`r${i}`, "m")).join("\n") + "\n",
    );
    await readCapturedModels(root);
    const added = row("new", "m2") + "\n";
    fs.appendFileSync(journal, added);
    const reads: number[] = [];
    const realOpen = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, "open").mockImplementation(
      async (...args: Parameters<typeof fs.promises.open>) => {
        const h = await realOpen(...args);
        const realRead = h.read.bind(h);
        (h as unknown as { read: unknown }).read = async (
          buf: Buffer,
          off: number,
          len: number,
          pos: number,
        ) => {
          const r = await realRead(buf, off, len, pos);
          reads.push(r.bytesRead);
          return r;
        };
        return h;
      },
    );
    const models = await readCapturedModels(root);
    expect([...models.get("new")!]).toEqual(["m2"]);
    expect(reads.reduce((a, b) => a + b, 0)).toBe(Buffer.byteLength(added));
  });

  it("文件被删除或截短时整体重建，不残留已删除的证据", async () => {
    const a = path.join(dir, "responses-1.jsonl"),
      b = path.join(dir, "responses-2.jsonl");
    fs.writeFileSync(a, row("r1", "m1") + "\n");
    fs.writeFileSync(b, row("r2", "m2") + "\n" + row("r3", "m3") + "\n");
    expect((await readCapturedModels(root)).size).toBe(3);
    fs.unlinkSync(a);
    expect([...(await readCapturedModels(root)).keys()].sort()).toEqual(["r2", "r3"]);
    fs.writeFileSync(b, row("r9", "m9") + "\n");
    expect([...(await readCapturedModels(root)).keys()]).toEqual(["r9"]);
  });
});

describe("compactCaptureJournals 合并已退出后端的日志", () => {
  it("合并进 archive 并按 (responseId, model) 去重，源文件删除，读取结果不变", async () => {
    const a = path.join(dir, `responses-${DEAD_PID}.jsonl`);
    fs.writeFileSync(
      a,
      [
        row("r1", "m1", "response.created"),
        row("r1", "m1"),
        row("r2", "m2"),
        row("r2", "m2b"),
        '{"partial":',
      ].join("\n") + "\n",
    );
    age(a, 60 * 60_000);
    const before = new Map([
      ["r1", ["m1"]],
      ["r2", ["m2", "m2b"]],
    ]);

    expect(await compactCaptureJournals(root)).toBe(1);
    expect(fs.existsSync(a)).toBe(false);
    const archived = fs.readFileSync(path.join(dir, ARCHIVE_JOURNAL), "utf8").trim().split("\n");
    expect(archived).toHaveLength(3); // r1/m1, r2/m2, r2/m2b

    resetCaptureReaders();
    const after = new Map([...(await readCapturedModels(root))].map(([k, v]) => [k, [...v]]));
    expect(after).toEqual(before);
  });

  it("读取时会顺带合并（每小时至多一次），合并前后读到的结果一致", async () => {
    const a = path.join(dir, `responses-${DEAD_PID}.jsonl`);
    fs.writeFileSync(a, row("r1", "m1", "response.created") + "\n" + row("r1", "m1") + "\n");
    age(a, 60 * 60_000);
    const models = await readCapturedModels(root);
    expect([...models.get("r1")!]).toEqual(["m1"]);
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(path.join(dir, ARCHIVE_JOURNAL))).toBe(true);
  });

  it("后端进程仍在运行或最近还在写入的日志不合并", async () => {
    const live = path.join(dir, `responses-${process.pid}.jsonl`);
    const recent = path.join(dir, `responses-${DEAD_PID}.jsonl`);
    fs.writeFileSync(live, row("r1", "m1") + "\n");
    fs.writeFileSync(recent, row("r2", "m2") + "\n");
    age(live, 60 * 60_000);
    expect(await compactCaptureJournals(root)).toBe(0);
    expect(fs.existsSync(live) && fs.existsSync(recent)).toBe(true);
    expect(fs.existsSync(path.join(dir, ARCHIVE_JOURNAL))).toBe(false);
  });

  it("再次合并时保留 archive 里已有的记录", async () => {
    const a = path.join(dir, `responses-${DEAD_PID}.jsonl`);
    fs.writeFileSync(a, row("r1", "m1") + "\n");
    age(a, 60 * 60_000);
    await compactCaptureJournals(root);
    fs.writeFileSync(a, row("r1", "m1") + "\n" + row("r2", "m2") + "\n");
    age(a, 60 * 60_000);
    await compactCaptureJournals(root);
    const lines = fs.readFileSync(path.join(dir, ARCHIVE_JOURNAL), "utf8").trim().split("\n");
    expect(lines.map((l) => JSON.parse(l).responseId)).toEqual(["r1", "r2"]);
  });

  it("源文件删不掉（被占用）时留着，读取端集合去重不会重复计", async () => {
    const a = path.join(dir, `responses-${DEAD_PID}.jsonl`);
    fs.writeFileSync(a, row("r1", "m1") + "\n");
    age(a, 60 * 60_000);
    vi.spyOn(fs.promises, "unlink").mockRejectedValue(
      Object.assign(new Error("busy"), { code: "EBUSY" }),
    );
    expect(await compactCaptureJournals(root)).toBe(0);
    expect(fs.existsSync(a)).toBe(true);
    const models = await readCapturedModels(root);
    expect([...models.get("r1")!]).toEqual(["m1"]);
  });
});

describe("并发读取", () => {
  it("同时发起的读取复用同一次结果，增量游标不会被推进两次", async () => {
    const journal = path.join(dir, "responses-1.jsonl");
    fs.writeFileSync(journal, row("r1", "m1") + "\n");
    const [a, b] = await Promise.all([readCapturedModels(root), readCapturedModels(root)]);
    expect(a).toBe(b);
    fs.appendFileSync(journal, row("r2", "m2") + "\n");
    expect([...(await readCapturedModels(root)).keys()].sort()).toEqual(["r1", "r2"]);
  });
});
