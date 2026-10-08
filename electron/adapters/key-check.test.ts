import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Groq / Gemini / Together AI 共用 key-check 实现后，对外行为与抽取前逐项一致：
 * 定义（含字段、占位提示）、请求地址与鉴权头、成功结果、报错文案。
 */

const http = vi.hoisted(() => ({
  calls: [] as { url: string; headers: Record<string, string> }[],
  response: { ok: true, status: 200, text: "" },
}));
vi.mock("../lib/http", () => ({
  fetchWithTimeout: async (url: string, init?: { headers?: Record<string, string> }) => {
    http.calls.push({ url, headers: init?.headers ?? {} });
    return { ok: http.response.ok, status: http.response.status, text: async () => http.response.text };
  },
}));

const { groqAdapter } = await import("./groq");
const { geminiAdapter } = await import("./gemini");
const { togetherAdapter } = await import("./together");

const apiKeyField = (placeholder?: string) => ({
  key: "apiKey",
  label: "API Key",
  type: "password",
  ...(placeholder ? { placeholder } : {}),
  required: true,
});

const cases = [
  {
    adapter: groqAdapter,
    definition: {
      provider: "groq",
      label: "Groq",
      kind: "api",
      official: true,
      description: "无余额 / 配额查询 API，仅校验 Key 有效性（用量见 GroqCloud 控制台）",
      configSchema: [apiKeyField("gsk_...")],
    },
    url: "https://api.groq.com/openai/v1/models",
    headers: { Authorization: "Bearer k-1" },
    errorName: "Groq",
  },
  {
    adapter: geminiAdapter,
    definition: {
      provider: "gemini",
      label: "Google Gemini",
      kind: "api",
      official: true,
      description: "无余额 / 配额查询 API，仅校验 Key 有效性（额度见 AI Studio 控制台）",
      configSchema: [apiKeyField("AIza...")],
    },
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: { "x-goog-api-key": "k-1" },
    errorName: "Gemini",
  },
  {
    adapter: togetherAdapter,
    definition: {
      provider: "together",
      label: "Together AI",
      kind: "api",
      official: true,
      description: "开源模型推理。无公开余额 API，仅校验 Key 有效性（credits 见控制台）",
      configSchema: [apiKeyField()],
    },
    url: "https://api.together.xyz/v1/models",
    headers: { Authorization: "Bearer k-1" },
    errorName: "Together",
  },
];

beforeEach(() => {
  http.calls.length = 0;
  http.response = { ok: true, status: 200, text: "" };
});

describe.each(cases)("$definition.label（key-check）", ({ adapter, definition, url, headers, errorName }) => {
  it("定义与抽取前一致", () => {
    expect(adapter.definition).toStrictEqual(definition);
    expect(adapter.fetchUsage).toBeUndefined();
  });

  it("用 Key 请求 /models，成功时只返回「Key 有效」", async () => {
    const r = await adapter.fetchBalance({}, { apiKey: "k-1" });
    expect(http.calls).toEqual([{ url, headers }]);
    expect(r).toMatchObject({ currency: "USD", statusLabel: "Key 有效" });
    expect(Object.keys(r).sort()).toEqual(["currency", "fetchedAt", "statusLabel"]);
    expect(Number.isFinite(Date.parse(r.fetchedAt))).toBe(true);
  });

  it("失败时报「名称 状态码: 响应前 200 字」", async () => {
    http.response = { ok: false, status: 401, text: "x".repeat(300) };
    await expect(adapter.fetchBalance({}, { apiKey: "k-1" })).rejects.toThrow(
      `${errorName} 401: ${"x".repeat(200)}`,
    );
  });

  it("缺少 Key 时不发请求", async () => {
    await expect(adapter.fetchBalance({}, {})).rejects.toThrow("缺少 API Key");
    expect(http.calls).toEqual([]);
  });
});
