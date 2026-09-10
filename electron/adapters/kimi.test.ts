import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Kimi 适配器的降级链。
 *
 * 这是全部适配器里控制流最绕的一个：余额接口先试，失败或取不到字段就退化为
 * 「用 /models 校验 Key」，并把失败原因写进 statusLabel。此前整段不捕获异常，
 * 网络故障会直接冒出去，用户看到的就是一句「TypeError: fetch failed」，
 * 余额和 Key 状态全没了。这条链值得逐档钉住。
 */

const state = {
  balance: { ok: true as boolean, status: 200, body: {} as unknown, throws: false },
  models: { ok: true as boolean, status: 200, body: {} as unknown, throws: false },
};

vi.mock("../lib/http", () => ({
  fetchWithTimeout: async (url: string) => {
    const isBalance = url.includes("/users/me/balance");
    const s = isBalance ? state.balance : state.models;
    if (s.throws) throw new TypeError("fetch failed");
    return {
      ok: s.ok,
      status: s.status,
      json: async () => s.body,
      text: async () => JSON.stringify(s.body),
    };
  },
}));

const { kimiAdapter } = await import("./kimi");

beforeEach(() => {
  state.balance = { ok: true, status: 200, body: {}, throws: false };
  state.models = { ok: true, status: 200, body: {}, throws: false };
});

const secrets = { apiKey: "sk-test" };

describe("Kimi 余额查询", () => {
  it("余额接口正常时给出数字与币种", async () => {
    state.balance.body = { code: 0, data: { available_balance: 88.5 } };
    const bal = await kimiAdapter.fetchBalance({}, secrets);
    expect(bal.remaining).toBe(88.5);
    expect(bal.currency).toBe("CNY");
  });

  it("字段在顶层时也能取到（多字段兜底）", async () => {
    state.balance.body = { available_balance: 12 };
    const bal = await kimiAdapter.fetchBalance({}, secrets);
    expect(bal.remaining).toBe(12);
  });

  it("余额字段为空串时不算 0，退化为校验 Key", async () => {
    // Number("") 是 0：若照搬，空字段会显示成 ¥0.00
    state.balance.body = { data: { available_balance: "" } };
    const bal = await kimiAdapter.fetchBalance({}, secrets);
    expect(bal.remaining).toBeUndefined();
    expect(bal.statusLabel).toContain("余额字段未取到");
  });

  it("余额接口抛网络异常时不整张卡报错，降级且写明原因（回归）", async () => {
    state.balance.throws = true;
    const bal = await kimiAdapter.fetchBalance({}, secrets);
    expect(bal.remaining).toBeUndefined();
    expect(bal.statusLabel).toContain("Key 有效");
    expect(bal.statusLabel).toContain("连接失败");
  });

  it("余额接口返回非 200 时把状态码写进原因", async () => {
    state.balance = { ok: false, status: 401, body: {}, throws: false };
    const bal = await kimiAdapter.fetchBalance({}, secrets);
    expect(bal.statusLabel).toContain("401");
  });

  it("/models 也不可达时才抛错，且错误信息可读", async () => {
    state.balance.throws = true;
    state.models = { ok: false, status: 403, body: { error: "bad key" }, throws: false };
    await expect(kimiAdapter.fetchBalance({}, secrets)).rejects.toThrow(/Kimi 403/);
  });

  it("缺少 API Key 时立刻报错，不发请求", async () => {
    await expect(kimiAdapter.fetchBalance({}, {})).rejects.toThrow(/缺少 API Key/);
  });
});
