import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DeepSeek 余额解析。
 *
 * 响应结构以官方文档为准（GET /user/balance）：
 *   { is_available: boolean,
 *     balance_infos: [ { currency: "CNY" | "USD",
 *                        total_balance: string,
 *                        granted_balance: string,
 *                        topped_up_balance: string } ] }
 *
 * 注意 balance_infos 是**数组**、currency 的取值集合有两种：两处都充过值的
 * 账号会拿到两条。取第一条当主数字是对的（跨币种不能求和），但把其余几条
 * 整个丢掉就少显示了一半信息。
 */

const state = { body: {} as unknown, ok: true, status: 200 };

vi.mock("../lib/http", () => ({
  fetchWithTimeout: async () => ({
    ok: state.ok,
    status: state.status,
    json: async () => state.body,
    text: async () => JSON.stringify(state.body),
  }),
}));

const { deepseekAdapter } = await import("./deepseek");

const one = (overrides: Record<string, unknown> = {}) => ({
  is_available: true,
  balance_infos: [
    {
      currency: "CNY",
      total_balance: "88.88",
      granted_balance: "0.00",
      topped_up_balance: "88.88",
      ...overrides,
    },
  ],
});

beforeEach(() => {
  state.body = one();
  state.ok = true;
  state.status = 200;
});

describe("DeepSeek 余额", () => {
  it("解析字符串金额与币种", async () => {
    const bal = await deepseekAdapter.fetchBalance({}, { apiKey: "sk-x" });
    expect(bal.total).toBe(88.88);
    expect(bal.remaining).toBe(88.88);
    expect(bal.currency).toBe("CNY");
  });

  it("单条时不产生 breakdown（列出来只会重复主数字）", async () => {
    const bal = await deepseekAdapter.fetchBalance({}, { apiKey: "sk-x" });
    expect(bal.breakdown).toBeUndefined();
  });

  it("两条（CNY + USD）时主数字取第一条，另一条进 breakdown（回归）", async () => {
    state.body = {
      is_available: true,
      balance_infos: [
        { currency: "CNY", total_balance: "100.00" },
        { currency: "USD", total_balance: "20.00" },
      ],
    };
    const bal = await deepseekAdapter.fetchBalance({}, { apiKey: "sk-x" });

    expect(bal.remaining).toBe(100);
    expect(bal.currency).toBe("CNY");
    // 第二种货币不再被丢弃——但它也不能被加进主数字
    expect(bal.breakdown).toHaveLength(2);
    expect(bal.breakdown?.[0]).toMatchObject({ label: "CNY", remaining: 100 });
    expect(bal.breakdown?.[1]).toMatchObject({ label: "USD", remaining: 20 });
  });

  it("breakdown 第一条与主数字一致（总览页拿第一条当主数字）", async () => {
    state.body = {
      balance_infos: [
        { currency: "USD", total_balance: "5.50" },
        { currency: "CNY", total_balance: "9.90" },
      ],
    };
    const bal = await deepseekAdapter.fetchBalance({}, { apiKey: "sk-x" });
    expect(bal.breakdown?.[0].remaining).toBe(bal.remaining);
    expect(bal.breakdown?.[0].unit).toBe(bal.currency);
  });

  it("金额字段缺失时给 undefined 而不是 NaN（回归）", async () => {
    state.body = { balance_infos: [{ currency: "CNY" }] };
    const bal = await deepseekAdapter.fetchBalance({}, { apiKey: "sk-x" });
    expect(bal.remaining).toBeUndefined();
    expect(Number.isNaN(bal.remaining as number)).toBe(false);
  });

  it("balance_infos 整个缺失时不报错，也不产生 NaN", async () => {
    state.body = { is_available: false };
    const bal = await deepseekAdapter.fetchBalance({}, { apiKey: "sk-x" });
    expect(bal.remaining).toBeUndefined();
    expect(bal.currency).toBe("CNY");
  });

  it("HTTP 错误时带上状态码", async () => {
    state.ok = false;
    state.status = 401;
    state.body = { error: "unauthorized" };
    await expect(deepseekAdapter.fetchBalance({}, { apiKey: "sk-x" })).rejects.toThrow(
      /DeepSeek 401/,
    );
  });

  it("缺少 API Key 时立刻报错", async () => {
    await expect(deepseekAdapter.fetchBalance({}, {})).rejects.toThrow(/缺少 API Key/);
  });
});
