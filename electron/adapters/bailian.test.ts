import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 百炼（阿里云 BSSOpenAPI）余额解析。
 *
 * 这条路径的坑集中在两点：金额是带千分位的字符串（"1,234.56"），以及
 * 业务错误写在 200 响应的 JSON 里而不是 HTTP 状态码上。两者都属于「静默出错」
 * 的类型——解析错了不报错，只是数字不对或费用显示成 0。
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

const { bailianAdapter } = await import("./bailian");

function respond(body: unknown): void {
  state.body = body;
  state.text = JSON.stringify(body);
  state.ok = true;
  state.status = 200;
}

beforeEach(() => {
  respond({
    Code: "Success",
    Success: true,
    Data: { AvailableAmount: "1,234.56", Currency: "CNY" },
  });
});

const config = { accessKeyId: "LTAI-test" };
const secrets = { accessKeySecret: "secret" };

describe("百炼余额", () => {
  it("解析带千分位的金额字符串", async () => {
    const bal = await bailianAdapter.fetchBalance(config, secrets);
    expect(bal.remaining).toBe(1234.56);
    expect(bal.currency).toBe("CNY");
  });

  it("依次回退 AvailableAmount -> AvailableCashAmount -> Balance", async () => {
    respond({ Code: "Success", Data: { AvailableCashAmount: "20" } });
    expect((await bailianAdapter.fetchBalance(config, secrets)).remaining).toBe(20);

    respond({ Code: "Success", Data: { Balance: "30" } });
    expect((await bailianAdapter.fetchBalance(config, secrets)).remaining).toBe(30);
  });

  it("数字型的金额也能解析", async () => {
    respond({ Code: "Success", Data: { AvailableAmount: 88.5 } });
    expect((await bailianAdapter.fetchBalance(config, secrets)).remaining).toBe(88.5);
  });

  it("币种缺失时按 CNY（国内站）", async () => {
    respond({ Code: "Success", Data: { AvailableAmount: "10" } });
    expect((await bailianAdapter.fetchBalance(config, secrets)).currency).toBe("CNY");
  });

  it("金额取不到时给 undefined 而不是 0", async () => {
    // 给 0 会显示成 ¥0.00——凭空断言用户余额用尽
    respond({ Code: "Success", Data: {} });
    const bal = await bailianAdapter.fetchBalance(config, secrets);
    expect(bal.remaining).toBeUndefined();
  });

  it("Success=false 时抛错（HTTP 仍是 200）", async () => {
    respond({ Code: "SignatureDoesNotMatch", Success: false, Message: "签名错误" });
    await expect(bailianAdapter.fetchBalance(config, secrets)).rejects.toThrow(
      /SignatureDoesNotMatch/,
    );
  });

  it("Code 不是 Success 时抛错", async () => {
    respond({ Code: "Forbidden", Message: "无权限" });
    await expect(bailianAdapter.fetchBalance(config, secrets)).rejects.toThrow(
      /百炼/,
    );
  });

  it("响应不是 JSON 时给出可读错误", async () => {
    state.ok = true;
    state.status = 200;
    state.text = "<html>502 Bad Gateway</html>";
    await expect(bailianAdapter.fetchBalance(config, secrets)).rejects.toThrow(
      /非 JSON/,
    );
  });

  it("HTTP 错误时带上状态码", async () => {
    state.ok = false;
    state.status = 500;
    state.text = "internal error";
    await expect(bailianAdapter.fetchBalance(config, secrets)).rejects.toThrow(
      /百炼 500/,
    );
  });

  it("缺少 AccessKey 时立刻报错，不发请求", async () => {
    await expect(bailianAdapter.fetchBalance({}, secrets)).rejects.toThrow(
      /缺少 AccessKey/,
    );
    await expect(
      bailianAdapter.fetchBalance({ accessKeyId: "x" }, {}),
    ).rejects.toThrow(/缺少 AccessKey/);
  });
});
