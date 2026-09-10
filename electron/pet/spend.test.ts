import { describe, expect, it } from "vitest";
import { rowTokens, summarizeLocalSpend, type SpendRow } from "./spend";
import { visibleTokens } from "../../ui/src/lib/format";

function row(partial: Partial<SpendRow> & Pick<SpendRow, "source" | "date">): SpendRow {
  return {
    cost: null,
    currency: "USD",
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    ...partial,
  };
}

describe("rowTokens", () => {
  it("与用量页同一口径：含缓存读取一次", () => {
    expect(
      rowTokens(
        row({
          source: "codex",
          date: "2026-09-04",
          inputTokens: 100,
          outputTokens: 20,
          cacheCreationTokens: 3,
          cacheReadTokens: 4,
          reasoningTokens: 5,
        }),
      ),
    ).toBe(132);
  });

  it("与界面侧的 visibleTokens 逐项相等", () => {
    // 「token 总量」在项目里有三份实现：界面侧的 visibleTokens、这里的
    // rowTokens、以及计费侧的 toCostTokens。它们必须给出同一个数——这个模式
    // 已经咬过一次（OpenCode 拆出 reasoning 后计费侧忘了加回来，导致界面显示
    // 的总量含推理、费用却不含）。每条跨模块的边界都钉一下，别只靠注释约定。
    const sample = row({
      source: "grok-build",
      date: "2026-09-04",
      inputTokens: 1_234,
      outputTokens: 567,
      cacheCreationTokens: 89,
      cacheReadTokens: 10_000,
      reasoningTokens: 321,
    });
    expect(rowTokens(sample)).toBe(visibleTokens(sample));
  });

  it("全零行两边都是 0", () => {
    const zero = row({ source: "codex", date: "2026-09-04" });
    expect(rowTokens(zero)).toBe(0);
    expect(visibleTokens(zero)).toBe(0);
  });
});

describe("summarizeLocalSpend", () => {
  it("只汇总指定日期", () => {
    const summary = summarizeLocalSpend(
      [
        row({ source: "codex", date: "2026-09-04", cost: 1.2, inputTokens: 10 }),
        row({ source: "codex", date: "2026-09-03", cost: 9, inputTokens: 999 }),
      ],
      "2026-09-04",
    );
    expect(summary.cost).toBe(1.2);
    expect(summary.tokens).toBe(10);
    expect(summary.bySource).toHaveLength(1);
  });

  it("按来源分组并保持固定顺序", () => {
    const summary = summarizeLocalSpend(
      [
        row({ source: "grok-build", date: "2026-09-04", cost: 0.5, inputTokens: 1 }),
        row({ source: "claude-code", date: "2026-09-04", cost: 2, inputTokens: 2 }),
        row({ source: "codex", date: "2026-09-04", cost: 1, inputTokens: 3 }),
      ],
      "2026-09-04",
    );
    expect(summary.bySource.map((s) => s.source)).toEqual([
      "claude-code",
      "codex",
      "grok-build",
    ]);
    expect(summary.cost).toBe(3.5);
  });

  it("未知价格不把费用当成 0", () => {
    const summary = summarizeLocalSpend(
      [
        row({ source: "codex", date: "2026-09-04", cost: null, inputTokens: 100 }),
      ],
      "2026-09-04",
    );
    expect(summary.cost).toBeNull();
    expect(summary.hasUnpriced).toBe(true);
    expect(summary.bySource[0]?.cost).toBeNull();
    expect(summary.bySource[0]?.unpriced).toBe(true);
    expect(summary.tokens).toBe(100);
  });

  it("同一来源有的模型有价、有的没有：合计只加有价的，并标 unpriced", () => {
    const summary = summarizeLocalSpend(
      [
        row({ source: "codex", date: "2026-09-04", cost: 1.5, inputTokens: 10 }),
        row({ source: "codex", date: "2026-09-04", cost: null, inputTokens: 20 }),
      ],
      "2026-09-04",
    );
    expect(summary.cost).toBe(1.5);
    expect(summary.hasUnpriced).toBe(true);
    expect(summary.bySource[0]?.cost).toBe(1.5);
    expect(summary.bySource[0]?.unpriced).toBe(true);
    expect(summary.tokens).toBe(30);
  });

  it("当天没有任何记录", () => {
    const summary = summarizeLocalSpend([], "2026-09-04");
    expect(summary.cost).toBeNull();
    expect(summary.tokens).toBe(0);
    expect(summary.bySource).toEqual([]);
    expect(summary.hasUnpriced).toBe(false);
  });
});
