import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 超算互联网 Token Plan 的到期时间解析。
 *
 * pickTime 的字符串分支有 NaN 防护，数字分支此前没有——而 Date 的合法上界是
 * 8.64e15（±100M 天），超界时 toISOString() 会抛 RangeError。一个可选的到期
 * 时间字段不该把整张卡片带崩：金额明明解析成功了，用户却只看到一句英文报错。
 * 项目在 antigravity.ts 里对这个坑有明确注释与防护，这里此前漏了。
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

const { scnetTokenPlanAdapter } = await import("./scnet_token_plan");

/** 一份能正常解析的套餐，字段名取自代码注释里记录的真实响应 */
function subscription(overrides: Record<string, unknown> = {}) {
  return {
    name: "标准版",
    status: "EFFECTIVE",
    totalAmount: 1_000_000,
    usedAmount: 250_000,
    unit: "Credits",
    maxExpireTime: 1_800_000_000_000,
    ...overrides,
  };
}

function respond(rows: unknown[]): void {
  state.body = { code: "0", msg: "ok", data: rows };
}

beforeEach(() => {
  respond([subscription()]);
  state.ok = true;
  state.status = 200;
});

describe("SCNet Token Plan 余额", () => {
  it("正常响应给出余量、总量与单位", async () => {
    const bal = await scnetTokenPlanAdapter.fetchBalance({}, { cookie: "c" });
    expect(bal.remaining).toBe(750_000);
    expect(bal.total).toBe(1_000_000);
    expect(bal.currency).toBe("Credits");
    expect(bal.expiresAt).toBe(new Date(1_800_000_000_000).toISOString());
  });

  it("到期时间是秒级时间戳时也能识别", async () => {
    respond([subscription({ maxExpireTime: 1_800_000_000 })]);
    const bal = await scnetTokenPlanAdapter.fetchBalance({}, { cookie: "c" });
    expect(bal.expiresAt).toBe(new Date(1_800_000_000_000).toISOString());
  });

  it("到期时间是大得离谱的数字时只丢弃该字段，不抛异常（回归）", async () => {
    // 纳秒级时间戳之类的脏数据：Date 会变成 Invalid，toISOString 抛 RangeError
    for (const bad of [1.7e18, 1e16, Number.POSITIVE_INFINITY]) {
      respond([subscription({ maxExpireTime: bad })]);
      const bal = await scnetTokenPlanAdapter.fetchBalance({}, { cookie: "c" });
      expect(bal.expiresAt, `maxExpireTime=${bad}`).toBeUndefined();
      // 关键：金额照常给出，不因为一个可选时间字段整张卡报错
      expect(bal.remaining).toBe(750_000);
    }
  });

  it("到期时间是合法字符串时照常解析", async () => {
    respond([subscription({ maxExpireTime: "2027-01-01T00:00:00Z" })]);
    const bal = await scnetTokenPlanAdapter.fetchBalance({}, { cookie: "c" });
    expect(bal.expiresAt).toBe("2027-01-01T00:00:00.000Z");
  });

  it("到期时间非法字符串时丢弃该字段", async () => {
    respond([subscription({ maxExpireTime: "not-a-date" })]);
    const bal = await scnetTokenPlanAdapter.fetchBalance({}, { cookie: "c" });
    expect(bal.expiresAt).toBeUndefined();
  });

  it("未订阅（data 为空）时给出可操作的提示，而不是 0", async () => {
    respond([]);
    await expect(
      scnetTokenPlanAdapter.fetchBalance({}, { cookie: "c" }),
    ).rejects.toThrow(/未订阅/);
  });

  it("缺少 totalAmount / usedAmount 时报错并列出实际字段名", async () => {
    respond([{ name: "标准版", unit: "Credits" }]);
    await expect(
      scnetTokenPlanAdapter.fetchBalance({}, { cookie: "c" }),
    ).rejects.toThrow(/缺少 totalAmount\/usedAmount/);
  });

  it("业务错误码写在 code 字段里时也要报错（HTTP 可能是 200）", async () => {
    state.body = { code: "401", msg: "未登录", data: [] };
    await expect(
      scnetTokenPlanAdapter.fetchBalance({}, { cookie: "c" }),
    ).rejects.toThrow(/401/);
  });

  it("缺少 Cookie 时立刻报错，不发请求", async () => {
    await expect(scnetTokenPlanAdapter.fetchBalance({}, {})).rejects.toThrow(
      /缺少 Cookie/,
    );
  });
});
