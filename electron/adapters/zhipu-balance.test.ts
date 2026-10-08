import { describe, expect, it, vi } from "vitest";

/**
 * 智谱卡片主数字的币种一致性。
 *
 * currency 按区域定（国内 CNY / 国际 USD），而钱包类资源包各自带单位。
 * 把不同单位的包直接相加，等于把两种货币求和后当作单一币种显示——
 * 既没换算也没标注，用户看到的是一个不存在于任何账户的金额。
 */

const CASH_URL_PART = "query-customer-account-report";

/** 现金接口返回空（模拟取不到），资源包返回一个 CNY 包 + 一个 USD 包 */
vi.mock("../lib/http", () => ({
  fetchWithTimeout: async (url: string) => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify(
        url.includes(CASH_URL_PART)
          ? { code: 200, data: {} }
          : {
              code: 200,
              data: {
                rows: [
                  {
                    resourcePackageName: "现金包",
                    consumeType: "CASH",
                    availableBalance: "100",
                  },
                  {
                    // consumeType 非 AMOUNT/TOKENS/TIMES -> 单位取自 unit 字段
                    resourcePackageName: "美元包",
                    consumeType: "OTHER",
                    unit: "USD",
                    availableBalance: "50",
                  },
                ],
              },
            },
      ),
  }),
}));

const { zhipuAdapter } = await import("./zhipu");

describe("智谱钱包主数字不混币种", () => {
  it("国内区域只汇总 CNY 包，USD 包不计入主数字（回归）", async () => {
    const bal = await zhipuAdapter.fetchBalance({ region: "cn" }, { apiKey: "k" });

    expect(bal.currency).toBe("CNY");
    // 旧行为是两个包直接相加得到 150，把 50 美元当成了 50 元
    expect(bal.remaining).toBe(100);
  });

  it("另一种货币的包仍会出现在明细里（不丢信息，只是不参与求和）", async () => {
    const bal = await zhipuAdapter.fetchBalance({ region: "cn" }, { apiKey: "k" });
    const usd = bal.breakdown?.find((b) => b.label === "美元包");
    expect(usd?.remaining).toBe(50);
    expect(usd?.unit).toBe("USD");
  });

  it("国际区域只汇总 USD 包", async () => {
    const bal = await zhipuAdapter.fetchBalance({ region: "global" }, { apiKey: "k" });
    expect(bal.currency).toBe("USD");
    expect(bal.remaining).toBe(50);
  });
});
