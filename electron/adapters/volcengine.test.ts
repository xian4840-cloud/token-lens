import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 火山引擎（火山方舟）余额解析。
 *
 * 与百炼同构：业务错误写在 200 响应的 ResponseMetadata.Error 里，金额是字符串。
 * 这两点都属于「错了也不报错、只是数字不对」的类型。
 */

const state = { body: {} as unknown, text: "", ok: true, status: 200 };

vi.mock("../lib/http", () => ({
  fetchWithTimeout: async () => ({
    ok: state.ok,
    status: state.status,
    text: async () => state.text,
    json: async () => state.body,
  }),
}));

const { volcengineAdapter } = await import("./volcengine");

function respond(body: unknown): void {
  state.body = body;
  state.text = JSON.stringify(body);
  state.ok = true;
  state.status = 200;
}

beforeEach(() => {
  respond({ ResponseMetadata: { RequestId: "r1" }, Result: { AvailableBalance: "88.88" } });
});

const config = { accessKeyId: "AKLT-test" };
const secrets = { accessKeySecret: "secret" };

describe("火山引擎余额", () => {
  it("解析可用余额", async () => {
    const bal = await volcengineAdapter.fetchBalance(config, secrets);
    expect(bal.remaining).toBe(88.88);
    expect(bal.currency).toBe("CNY");
  });

  it("金额是数字时也能解析", async () => {
    respond({ Result: { AvailableBalance: 100 } });
    expect((await volcengineAdapter.fetchBalance(config, secrets)).remaining).toBe(100);
  });

  it("余额字段缺失时给 undefined 而不是 NaN（回归）", async () => {
    // 此前是 Number(balance)，Number(undefined) 得到 NaN 并一路带进界面
    respond({ Result: {} });
    const bal = await volcengineAdapter.fetchBalance(config, secrets);
    expect(bal.remaining).toBeUndefined();
    expect(Number.isNaN(bal.remaining as number)).toBe(false);
  });

  it("Result 整个缺失时也不产生 NaN", async () => {
    respond({ ResponseMetadata: { RequestId: "r1" } });
    expect(
      (await volcengineAdapter.fetchBalance(config, secrets)).remaining,
    ).toBeUndefined();
  });

  it("金额是非数字字符串时不产生 NaN", async () => {
    respond({ Result: { AvailableBalance: "N/A" } });
    expect(
      (await volcengineAdapter.fetchBalance(config, secrets)).remaining,
    ).toBeUndefined();
  });

  it("业务错误写在 ResponseMetadata.Error 时抛错（HTTP 仍是 200）", async () => {
    respond({
      ResponseMetadata: { Error: { Code: "InvalidAccessKey", Message: "AK 无效" } },
    });
    await expect(volcengineAdapter.fetchBalance(config, secrets)).rejects.toThrow(
      /InvalidAccessKey/,
    );
  });

  it("HTTP 错误时带上状态码", async () => {
    state.ok = false;
    state.status = 403;
    state.text = "forbidden";
    await expect(volcengineAdapter.fetchBalance(config, secrets)).rejects.toThrow(
      /火山引擎 403/,
    );
  });

  it("缺少 AccessKey 时立刻报错，不发请求", async () => {
    await expect(volcengineAdapter.fetchBalance({}, secrets)).rejects.toThrow(
      /缺少 AccessKey/,
    );
  });
});
