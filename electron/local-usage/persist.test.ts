import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalSource, LocalUsageRow } from "./types";

/**
 * scanAndPersistLocalUsage 的落盘方式选择。
 *
 * 这里必须把采集器和 db 都换成假实现：要断言的是「窗口扫描不许删历史」这条
 * 策略，而不是任何一种 agent 的解析细节。真去读磁盘反而测不准——
 * 结果取决于跑测试这台机器上恰好有哪些会话文件。
 */

const mocks = vi.hoisted(() => ({
  replace: [] as { source: LocalSource; rows: LocalUsageRow[] }[],
  upsert: [] as LocalUsageRow[][],
  scanSince: [] as (string | undefined)[],
}));

vi.mock("../db", () => ({
  getSetting: () => undefined,
  replaceLocalDailyUsageBySource: (source: LocalSource, rows: LocalUsageRow[]) => {
    mocks.replace.push({ source, rows });
  },
  upsertLocalDailyUsage: (rows: LocalUsageRow[]) => {
    mocks.upsert.push(rows);
  },
}));

vi.mock("./cache", () => ({ persistScanCache: () => {} }));

/** 不带 since 时给出两条历史，带 since 时只给窗口内那一条 */
function windowedRows(source: LocalSource, since?: string): LocalUsageRow[] {
  const all: LocalUsageRow[] = [
    {
      source,
      model: "m1",
      date: "2026-01-01",
      sessions: 1,
      inputTokens: 100,
      outputTokens: 10,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
    },
    {
      source,
      model: "m1",
      date: "2026-09-01",
      sessions: 1,
      inputTokens: 200,
      outputTokens: 20,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
    },
  ];
  mocks.scanSince.push(since);
  return since === undefined ? all : all.filter((r) => r.date >= "2026-09-01");
}

vi.mock("./claude-code", () => ({
  scanClaudeCode: async (since?: string) => windowedRows("claude-code", since),
}));
vi.mock("./codex", () => ({
  scanCodex: async (since?: string) => windowedRows("codex", since),
}));
vi.mock("./opencode", () => ({
  scanOpenCode: async () => ({ available: true, rows: [] }),
}));
vi.mock("./antigravity", () => ({
  scanAntigravity: async () => ({ available: false, unavailableReason: "stub", rows: [] }),
}));
vi.mock("./grok-build", () => ({
  scanGrokBuild: async () => ({ available: false, unavailableReason: "stub", rows: [] }),
}));

const { scanAndPersistLocalUsage } = await import("./index");

beforeEach(() => {
  mocks.replace.length = 0;
  mocks.upsert.length = 0;
  mocks.scanSince.length = 0;
});

describe("scanAndPersistLocalUsage 的落盘方式", () => {
  it("全量扫描走整源替换（保留清理陈旧历史的能力）", async () => {
    await scanAndPersistLocalUsage();

    expect(mocks.upsert).toHaveLength(0);
    const sources = mocks.replace.map((c) => c.source);
    expect(sources).toContain("claude-code");
    expect(sources).toContain("codex");
    // 不可用来源不落盘，否则会把它的既有历史当成「扫不到」清空
    expect(sources).not.toContain("antigravity");
    expect(sources).not.toContain("grok-build");
    expect(mocks.replace.find((c) => c.source === "codex")?.rows).toHaveLength(2);
  });

  it("带 since 的窗口扫描只 upsert，绝不整源替换（回归）", async () => {
    // 此前无论有没有 since 都走整源替换。而 Usage 页「重新扫描」按钮传的是
    // 当前时间范围的起点，该页默认范围又是「当月」——点一下就会把本月之前的
    // 本地用量桶全部删掉。
    await scanAndPersistLocalUsage("2026-09-01");

    expect(mocks.replace).toHaveLength(0);
    expect(mocks.upsert.length).toBeGreaterThan(0);
    // 窗口内那一行确实写进去了
    const flat = mocks.upsert.flat();
    expect(flat.map((r) => r.date)).toEqual(["2026-09-01", "2026-09-01"]);
  });

  it("窗口扫描返回的仍是窗口内的行（界面要的就是这个）", async () => {
    const result = await scanAndPersistLocalUsage("2026-09-01");
    expect(result.rows.every((r) => r.date >= "2026-09-01")).toBe(true);
    // 采集器确实收到了 since，说明没有偷偷退化成全量扫描
    expect(mocks.scanSince).toContain("2026-09-01");
  });
});
