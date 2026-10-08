import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalSource } from "./types";

/**
 * 设置里关掉的来源不应被扫描。
 *
 * 此前 scanLocalUsage 先把五家全部扫完，再把关掉来源的行过滤掉：关掉一个装了几千个
 * 会话的来源，每轮定时扫描照样完整走一遍它的目录、逐行读新文件，只是结果被丢弃。
 */

const mocks = vi.hoisted(() => ({
  disabled: [] as string[],
  calls: [] as string[],
}));

vi.mock("../db", () => ({
  markLocalScanned: () => {},
  getSetting: (key: string) =>
    key === "disabledLocalSources" ? JSON.stringify(mocks.disabled) : undefined,
  replaceLocalDailyUsageBySource: () => {},
  upsertLocalDailyUsage: () => {},
}));
vi.mock("./cache", () => ({ persistScanCache: () => false }));

const row = (source: LocalSource) => ({
  source,
  model: "m",
  date: "2026-09-01",
  sessions: 1,
  inputTokens: 1,
  outputTokens: 1,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
});
vi.mock("./claude-code", () => ({
  scanClaudeCode: async () => (mocks.calls.push("claude-code"), [row("claude-code")]),
}));
vi.mock("./codex", () => ({ scanCodex: async () => (mocks.calls.push("codex"), [row("codex")]) }));
vi.mock("./opencode", () => ({
  scanOpenCode: async () => (
    mocks.calls.push("opencode"),
    { available: true, rows: [row("opencode")] }
  ),
}));
vi.mock("./antigravity", () => ({
  scanAntigravity: async () => (
    mocks.calls.push("antigravity"),
    { available: true, rows: [row("antigravity")] }
  ),
}));
vi.mock("./grok-build", () => ({
  scanGrokBuild: async () => (
    mocks.calls.push("grok-build"),
    { available: true, rows: [row("grok-build")] }
  ),
}));

const { scanLocalUsage } = await import("./index");

beforeEach(() => {
  mocks.disabled = [];
  mocks.calls.length = 0;
});

describe("scanLocalUsage 跳过已关闭的来源", () => {
  it("关闭的来源一个文件都不读，结果与之前一致（无行 + 「已在设置中关闭」）", async () => {
    mocks.disabled = ["codex", "opencode", "grok-build"];
    const result = await scanLocalUsage();
    expect(mocks.calls.sort()).toEqual(["antigravity", "claude-code"]);
    expect(result.rows.map((r) => r.source).sort()).toEqual(["antigravity", "claude-code"]);
    expect(result.unavailable).toEqual(
      expect.arrayContaining([
        { source: "codex", reason: "已在设置中关闭" },
        { source: "opencode", reason: "已在设置中关闭" },
        { source: "grok-build", reason: "已在设置中关闭" },
      ]),
    );
    // 关闭的来源只报一次「已在设置中关闭」，不会再叠加「不可用」之类的原因
    expect(result.unavailable.filter((u) => u.source === "opencode")).toHaveLength(1);
  });

  it("全部开启时五家都扫", async () => {
    await scanLocalUsage();
    expect(mocks.calls.sort()).toEqual([
      "antigravity",
      "claude-code",
      "codex",
      "grok-build",
      "opencode",
    ]);
  });
});
