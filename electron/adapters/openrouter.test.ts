import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OpenRouter 余额解析。
 *
 * 这个适配器直接解 `json.data.total_credits`，没有任何结构防护。响应一旦不合
 * 预期（字段改名、返回错误信封而非余额、网关插了一层），用户看到的是
 * 「TypeError: Cannot read properties of undefined (reading 'total_credits')」——
 * 一句对排查毫无帮助的英文。同族的 deepseek / kimi 都用了可选链或兜底。
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

const { openrouterAdapter } = await import("./openrouter");

beforeEach(() => {
  state.body = { data: { total_credits: 100, total_usage: 30 } };
  state.ok = true;
  state.status = 200;
});

describe("OpenRouter 余额", () => {
  it("正常响应给出总额、已用与剩余", async () => {
    const bal = await openrouterAdapter.fetchBalance({}, { apiKey: "sk-or-x" });
    expect(bal.total).toBe(100);
    expect(bal.used).toBe(30);
    expect(bal.remaining).toBe(70);
    expect(bal.currency).toBe("USD");
  });

  it("缺 data 字段时抛可读的错误，而不是 TypeError（回归）", async () => {
    state.body = { error: { message: "invalid key" } };
    let caught: unknown;
    try {
      await openrouterAdapter.fetchBalance({}, { apiKey: "sk-or-x" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = caught instanceof Error ? caught.message : String(caught);
    expect(msg).not.toMatch(/Cannot read propert/);
    expect(msg).toMatch(/OpenRouter/);
  });

  it("data 里的数字缺失时给出 undefined 而不是 NaN", async () => {
    // NaN 会一路带进界面：卡片显示 "-"，副行却写「该服务无余额查询 API」
    state.body = { data: {} };
    const bal = await openrouterAdapter.fetchBalance({}, { apiKey: "sk-or-x" });
    expect(bal.remaining).toBeUndefined();
    expect(bal.total).toBeUndefined();
  });

  it("data 里的值是非数字字符串时不产生 NaN", async () => {
    state.body = { data: { total_credits: "abc", total_usage: "def" } };
    const bal = await openrouterAdapter.fetchBalance({}, { apiKey: "sk-or-x" });
    expect(Number.isNaN(bal.remaining as number)).toBe(false);
    expect(bal.remaining).toBeUndefined();
  });

  it("数字型字符串可正常解析", async () => {
    state.body = { data: { total_credits: "100.5", total_usage: "0.5" } };
    const bal = await openrouterAdapter.fetchBalance({}, { apiKey: "sk-or-x" });
    expect(bal.remaining).toBe(100);
  });

  it("HTTP 错误时抛出带状态码与服务名的错误", async () => {
    state.ok = false;
    state.status = 401;
    state.body = { error: "unauthorized" };
    await expect(
      openrouterAdapter.fetchBalance({}, { apiKey: "sk-or-x" }),
    ).rejects.toThrow(/OpenRouter 401/);
  });

  it("缺少 API Key 时立刻报错，不发请求", async () => {
    await expect(openrouterAdapter.fetchBalance({}, {})).rejects.toThrow(
      /缺少 API Key/,
    );
  });
});
