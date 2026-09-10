import { describe, expect, it } from "vitest";
import { toCostTokens } from "./index";
import { visibleTokens } from "../../ui/src/lib/format";
import type { LocalSource, LocalUsageRow } from "./types";

const SOURCES: LocalSource[] = [
  "claude-code",
  "codex",
  "opencode",
  "antigravity",
  "grok-build",
];

function row(
  source: LocalSource,
  partial: Partial<LocalUsageRow> = {},
): LocalUsageRow {
  return {
    source,
    model: "test-model",
    date: "2026-09-10",
    sessions: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    ...partial,
  };
}

/** 一行样本：五项都非零，能暴露任何一项被漏掉或多加 */
function fullRow(source: LocalSource): LocalUsageRow {
  return row(source, {
    inputTokens: 1_000,
    outputTokens: 400,
    cacheCreationTokens: 50,
    cacheReadTokens: 2_000,
    reasoningTokens: 300,
  });
}

describe("toCostTokens", () => {
  it("五家都把 reasoning 按 output 价计入", () => {
    for (const source of SOURCES) {
      const r = fullRow(source);
      const cost = toCostTokens(r);
      expect(cost.output, `${source} 的 reasoning 未计入`).toBe(
        r.outputTokens + r.reasoningTokens,
      );
    }
  });

  it("OpenCode 的 reasoning 不再漏计（回归）", () => {
    // 0.1.6 把 reasoning 从 OpenCode 的 output 里拆出去以修界面双计，
    // 但计费侧按 source 分支时没有跟着加回来，导致推理 token 完全不计费。
    const cost = toCostTokens(fullRow("opencode"));
    expect(cost.output).toBe(700);
  });

  it("input 一律不含 cacheRead，缓存读写各自独立", () => {
    for (const source of SOURCES) {
      const r = fullRow(source);
      const cost = toCostTokens(r);
      expect(cost.input, `${source} 的 input 混入了缓存`).toBe(r.inputTokens);
      expect(cost.cacheRead).toBe(r.cacheReadTokens);
      expect(cost.cacheCreation).toBe(r.cacheCreationTokens);
    }
  });

  it("计费口径与界面口径逐项相等", () => {
    // 这是本轮修复的核心不变量：同一个桶，算钱用的 token 数必须等于界面
    // 显示的总量。此前 OpenCode 两边不一致——界面含推理、费用不含，
    // 于是「显示 300 万 token、费用却按 200 万算」这种对不上账的情况。
    for (const source of SOURCES) {
      const r = fullRow(source);
      const c = toCostTokens(r);
      const billed =
        (c.input ?? 0) +
        (c.output ?? 0) +
        (c.cacheRead ?? 0) +
        (c.cacheCreation ?? 0);
      expect(billed, `${source} 的计费与显示口径不一致`).toBe(visibleTokens(r));
    }
  });

  it("全零行不产生负数或 NaN", () => {
    for (const source of SOURCES) {
      const c = toCostTokens(row(source));
      for (const v of [c.input, c.output, c.cacheRead, c.cacheCreation]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBe(0);
      }
    }
  });
});
