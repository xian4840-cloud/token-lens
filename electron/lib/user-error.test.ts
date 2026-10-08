import { describe, expect, it } from "vitest";
import { mapErrorToUserMessage } from "./user-error";

describe("mapErrorToUserMessage", () => {
  it("超时映射为人话，不带 URL", () => {
    expect(mapErrorToUserMessage(new Error("请求超时（15000ms）：https://api.openai.com/v1"))).toBe(
      "请求超时，可在设置里调大超时",
    );
    const aborted = new Error("This operation was aborted");
    aborted.name = "AbortError";
    expect(mapErrorToUserMessage(aborted)).toBe("请求超时，可在设置里调大超时");
  });

  it("网络失败不把 TypeError: fetch failed 丢到卡片上", () => {
    const e = new Error("fetch failed");
    e.name = "TypeError";
    expect(mapErrorToUserMessage(e)).toBe("连不上该服务，检查网络或代理");
    expect(mapErrorToUserMessage(new Error("getaddrinfo ENOTFOUND api.openai.com"))).toBe(
      "连不上该服务，检查网络或代理",
    );
  });

  it("401 / 403 提示去管理页更新凭证", () => {
    expect(mapErrorToUserMessage(new Error('OpenAI 401: {"error":"invalid_api_key"}'))).toBe(
      "Key 无效或已过期，请到管理页更新",
    );
    expect(mapErrorToUserMessage(new Error("DeepSeek 403: forbidden"))).toBe(
      "Key 无效或已过期，请到管理页更新",
    );
  });

  it("5xx 提示服务商暂时不可用", () => {
    expect(mapErrorToUserMessage(new Error("Anthropic 502: bad gateway"))).toBe(
      "服务商接口暂时不可用",
    );
  });

  it("缺凭证走补全提示", () => {
    expect(mapErrorToUserMessage(new Error("缺少 API Key"))).toBe("缺少凭证，请到管理页补全");
    expect(mapErrorToUserMessage(new Error("缺少 Cookie"))).toBe("缺少凭证，请到管理页补全");
  });

  it("已经是短中文、不含上游原文的句子原样保留", () => {
    expect(mapErrorToUserMessage(new Error("请重新登录获取凭证"))).toBe("请重新登录获取凭证");
  });

  it("其余情况给一句能去日志里看的兜底，不把 JSON 原文甩到卡片", () => {
    expect(mapErrorToUserMessage(new Error("Cannot read properties of undefined"))).toBe(
      "查询失败，详情见设置里的诊断日志",
    );
  });
});
