import { describe, expect, it, vi } from "vitest";
import { groupByModel } from "./anthropic";

/**
 * usage_reports 的聚合口径。
 *
 * 这条路径同时喂两个界面：卡片主数字（本月累计 token）和用量明细的合计。
 * 此前它们是两份独立实现——卡片那份（sumTokens）只加 input + output，
 * 把缓存读写整个漏掉，同一个接口的数据两个页面显示两个数。所以这里既要锁
 * 聚合函数本身，也要锁 fetchBalance 真的走了它。
 */

const REPORT = [
  {
    date: "2026-09-01",
    model: "claude-sonnet-5",
    input_tokens: 1_000,
    output_tokens: 400,
    cache_creation_input_tokens: 50,
    cache_read_input_tokens: 20_000,
  },
  {
    date: "2026-09-02",
    model: "claude-sonnet-5",
    input_tokens: 500,
    output_tokens: 100,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 9_000,
  },
];

vi.mock("../lib/http", () => ({
  fetchWithTimeout: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: REPORT }),
    text: async () => "",
  }),
}));

const { anthropicAdapter } = await import("./anthropic");

/** input 1500 + output 500 + cacheCreation 50 + cacheRead 29000 */
const EXPECTED_TOTAL = 31_050;

function report() {
  return REPORT.map((r) => ({ ...r }));
}

describe("groupByModel", () => {
  it("totalTokens 含缓存读写", () => {
    const items = groupByModel(report());
    expect(items).toHaveLength(1);
    expect(items[0].totalTokens).toBe(EXPECTED_TOTAL);
    expect(items[0].promptTokens).toBe(1_000 + 500 + 50 + 29_000);
    expect(items[0].completionTokens).toBe(500);
  });

  it("promptTokens 与 completionTokens 之和等于 totalTokens", () => {
    const it0 = groupByModel(report())[0];
    expect((it0.promptTokens ?? 0) + (it0.completionTokens ?? 0)).toBe(it0.totalTokens);
  });

  it("按模型分组，不同模型各自成项", () => {
    const items = groupByModel([
      { date: "2026-09-01", model: "claude-sonnet-5", input_tokens: 1, output_tokens: 1 },
      { date: "2026-09-01", model: "claude-opus-5", input_tokens: 2, output_tokens: 2 },
    ]);
    expect(items.map((i) => i.model).sort()).toEqual(["claude-opus-5", "claude-sonnet-5"]);
  });

  it("缺字段按 0 计，不产生 NaN", () => {
    const items = groupByModel([{ date: "2026-09-01", model: "claude-sonnet-5" }]);
    expect(items[0].totalTokens).toBe(0);
    expect(Number.isFinite(items[0].totalTokens)).toBe(true);
  });

  it("空输入返回空数组", () => {
    expect(groupByModel(undefined)).toEqual([]);
    expect(groupByModel([])).toEqual([]);
  });
});

describe("fetchBalance 的卡片主数字", () => {
  it("与用量明细的合计一致，含缓存读写（回归）", async () => {
    const bal = await anthropicAdapter.fetchBalance({ organizationId: "org-1" }, { apiKey: "k" });
    // 旧实现这里是 2000（只加了 input + output）
    expect(bal.used).toBe(EXPECTED_TOTAL);
    expect(bal.currency).toBe("tokens");

    const items = groupByModel(report());
    expect(bal.used).toBe(items.reduce((sum, it) => sum + (it.totalTokens ?? 0), 0));
  });
});
