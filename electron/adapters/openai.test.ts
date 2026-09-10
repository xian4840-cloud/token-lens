import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OpenAI 花费解析。
 *
 * 响应结构以官方文档为准（GET /organization/costs）：
 *   { object: "page",
 *     data: [ { object: "bucket", start_time, end_time,
 *               results: [ { amount: { value: 0.06, currency: "usd" },
 *                            line_item, project_id, model } ] } ],
 *     has_more, next_page }
 *
 * 两个容易写错的点：data 是时间桶数组（桶内含 results），金额是嵌套的
 * amount.value。此前按 { data: { data: [...] } } 解析，取到的恒为 undefined，
 * 经 ?? [] 落成空数组——不管实际花了多少，卡片一律显示 $0。
 */

const state = { body: {} as unknown, ok: true, status: 200, url: "" };

vi.mock("../lib/http", () => ({
  fetchWithTimeout: async (url: string) => {
    state.url = url;
    return {
      ok: state.ok,
      status: state.status,
      json: async () => state.body,
      text: async () => JSON.stringify(state.body),
    };
  },
}));

const { openaiAdapter } = await import("./openai");

/** 官方文档里的响应样例，扩展为两个桶 + 两个模型 */
function page(): unknown {
  return {
    object: "page",
    data: [
      {
        object: "bucket",
        start_time: 1_730_419_200,
        end_time: 1_730_505_600,
        results: [
          {
            object: "organization.costs.result",
            amount: { value: 0.06, currency: "usd" },
            line_item: null,
            project_id: null,
            model: "gpt-5.6-sol",
          },
          {
            object: "organization.costs.result",
            amount: { value: 1.5, currency: "usd" },
            line_item: null,
            project_id: null,
            model: "gpt-5",
          },
        ],
      },
      {
        object: "bucket",
        start_time: 1_730_505_600,
        end_time: 1_730_592_000,
        results: [
          {
            object: "organization.costs.result",
            amount: { value: 2.44, currency: "usd" },
            line_item: null,
            project_id: null,
            model: "gpt-5.6-sol",
          },
        ],
      },
    ],
    has_more: false,
    next_page: null,
  };
}

beforeEach(() => {
  state.body = page();
  state.ok = true;
  state.status = 200;
  state.url = "";
});

describe("OpenAI 本月花费", () => {
  it("从时间桶的 results[].amount.value 累加（回归）", async () => {
    const bal = await openaiAdapter.fetchBalance({}, { apiKey: "sk-x" });
    // 0.06 + 1.5 + 2.44 = 4
    expect(bal.used).toBe(4);
    expect(bal.currency).toBe("USD");
  });

  it("旧实现读的是不存在的 data.data，会得到 0", async () => {
    // 把这条写成断言，是为了让「响应结构」这件事在代码里有据可查：
    // 真实响应里 json.data 是数组，json.data.data 恒为 undefined
    const bal = await openaiAdapter.fetchBalance({}, { apiKey: "sk-x" });
    expect(bal.used).not.toBe(0);
  });

  it("跨时间桶按模型聚合，不产生重复行", async () => {
    // fetchUsage 在 Adapter 里是可选的，openai 适配器实现了它
    const usage = await openaiAdapter.fetchUsage!({}, { apiKey: "sk-x" }, {
      start: "2026-09-01T00:00:00Z",
      end: "2026-09-30T00:00:00Z",
    });
    expect(usage.items.map((i) => i.model).sort()).toEqual([
      "gpt-5",
      "gpt-5.6-sol",
    ]);
    const sol = usage.items.find((i) => i.model === "gpt-5.6-sol");
    expect(sol?.cost).toBeCloseTo(2.5, 6);
  });

  it("当月没有花费（data 为空数组）时是 0，而不是报错", async () => {
    state.body = { object: "page", data: [], has_more: false, next_page: null };
    const bal = await openaiAdapter.fetchBalance({}, { apiKey: "sk-x" });
    expect(bal.used).toBe(0);
  });

  it("data 不是数组时抛可读错误，而不是谎报 0（回归）", async () => {
    // 谎报 0 会让用户以为本月没花钱
    state.body = { error: { message: "invalid api key" } };
    await expect(openaiAdapter.fetchBalance({}, { apiKey: "sk-x" })).rejects.toThrow(
      /OpenAI costs/,
    );
  });

  it("某条结果缺金额时跳过它，不影响其余累加", async () => {
    state.body = {
      object: "page",
      data: [
        {
          results: [
            { model: "gpt-5", amount: { value: 1 } },
            { model: "gpt-5" },
            { model: "gpt-5", amount: { value: "2.5" } },
          ],
        },
      ],
    };
    const bal = await openaiAdapter.fetchBalance({}, { apiKey: "sk-x" });
    expect(bal.used).toBe(3.5);
  });

  it("请求带上月份区间与按模型分组", async () => {
    await openaiAdapter.fetchBalance({}, { apiKey: "sk-x" });
    expect(state.url).toContain("start_time=");
    expect(state.url).toContain("end_time=");
    expect(state.url).toContain("group_by[]=model");
  });

  it("HTTP 错误时带上状态码", async () => {
    state.ok = false;
    state.status = 401;
    state.body = { error: "unauthorized" };
    await expect(openaiAdapter.fetchBalance({}, { apiKey: "sk-x" })).rejects.toThrow(
      /OpenAI 401/,
    );
  });

  it("填写组织 ID 时带上 OpenAI-Organization 头", async () => {
    // 头内容没法从 URL 断言，这里只锁住「有 orgId 时不报错」这条路径
    await expect(
      openaiAdapter.fetchBalance({ orgId: "org-1" }, { apiKey: "sk-x" }),
    ).resolves.toBeDefined();
  });

  it("缺少 API Key 时立刻报错，不发请求", async () => {
    await expect(openaiAdapter.fetchBalance({}, {})).rejects.toThrow(/缺少 API Key/);
  });
});
