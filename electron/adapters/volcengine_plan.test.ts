import { describe, expect, it, vi } from "vitest";

/**
 * 配额类适配器与总览页之间的隐含约定。
 *
 * 总览页把 breakdown 的第一条当卡片主数字渲染，其余的放进展开面板
 * （见 Dashboard.tsx：breakdown[0] 画主块，slice(1) 画浮层）。
 * 而适配器算出的 remaining/total/used 会被趋势页记进快照。
 *
 * 两者必须是同一个东西，否则同一张卡片会出现「主数字是一个窗口、
 * 趋势图记的是另一个窗口」。zhipu_plan 与 zhipu 都遵守了这个约定
 * （前者 primary 就是 windows[0]，后者显式把「账户余额」合成第一条），
 * volcengine_plan 曾经没有——它按月>周>次挑主配额，却把 breakdown 留在
 * 接口返回顺序上。
 */

const QUOTA = {
  ResponseMetadata: {},
  Result: {
    Status: "ok",
    // 故意把 session 排在第一位：接口顺序不可控，月度配额在后面
    QuotaUsage: [
      { Level: "session", Percent: 10, Cap: 100, ResetTimestamp: 1_800_000_000 },
      { Level: "weekly", Percent: 20, Cap: 100, ResetTimestamp: 1_800_000_000 },
      { Level: "monthly", Percent: 60, Cap: 100, ResetTimestamp: 1_800_000_000 },
    ],
  },
};

vi.mock("../lib/http", () => ({
  fetchWithTimeout: async () => ({
    ok: true,
    status: 200,
    json: async () => QUOTA,
    text: async () => "",
  }),
}));

const { volcenginePlanAdapter } = await import("./volcengine_plan");

describe("火山方舟套餐的卡片主数字", () => {
  it("breakdown 第一条就是被选中的主配额（回归）", async () => {
    const bal = await volcenginePlanAdapter.fetchBalance(
      { xWebId: "w" },
      { cookie: "csrfToken=abc" },
    );

    // 主配额按 月 > 周 > 次 选定
    expect(bal.used).toBe(60);
    expect(bal.remaining).toBe(40);

    // 而界面主数字读的是 breakdown[0]，两者必须一致
    expect(bal.breakdown?.[0].used).toBe(bal.used);
    expect(bal.breakdown?.[0].remaining).toBe(bal.remaining);
    expect(bal.breakdown?.[0].label).toBe("月度");
  });

  it("其余配额按顺序跟在后面，一条不漏", async () => {
    const bal = await volcenginePlanAdapter.fetchBalance(
      { xWebId: "w" },
      { cookie: "csrfToken=abc" },
    );
    expect(bal.breakdown).toHaveLength(3);
    expect(bal.breakdown?.map((b) => b.label)).toEqual(["月度", "单次", "周度"]);
  });
});
