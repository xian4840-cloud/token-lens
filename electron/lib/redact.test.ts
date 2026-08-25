import { describe, expect, it } from "vitest";
import {
  REDACTION_MASK,
  redactError,
  redactHeaders,
  redactText,
  redactUrl,
} from "./redact";

// 这些用例守的是「日志里绝不能出现明文密钥」这一条。
// 断言写成 not.toContain(密钥片段) 而不是比对完整输出：
// 只要密钥没漏，打码格式怎么变都算通过。

describe("redactUrl", () => {
  // 回归：Gemini 是唯一把 key 拼在查询串里的适配器（其余走 Authorization 头），
  // 叠加 fetchWithTimeout 的超时消息带 url，超时即明文泄露 key
  it("打掉 Gemini 拼在查询串里的 key", () => {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyC1234567890abcdefghijklmnop";
    const out = redactUrl(url);
    expect(out).not.toContain("AIzaSyC1234567890abcdefghijklmnop");
    expect(out).not.toContain("AIzaSyC");
    expect(out).toContain(REDACTION_MASK);
  });

  it("保留主机名与路径（排查要靠它们定位是哪个服务哪个接口）", () => {
    const out = redactUrl(
      "https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyC1234567890abcdefghij",
    );
    expect(out).toContain("generativelanguage.googleapis.com");
    expect(out).toContain("/v1beta/models");
  });

  it("非敏感查询参数原样保留", () => {
    const out = redactUrl(
      "https://api.openai.com/v1/organization/costs?start_time=1700000000&limit=100",
    );
    expect(out).toContain("start_time=1700000000");
    expect(out).toContain("limit=100");
  });

  it("同时存在敏感与非敏感参数时只打掉敏感的", () => {
    const out = redactUrl("https://x.test/a?limit=10&api_key=sk-abcdefghijklmnopqrstuvwx&page=2");
    expect(out).toContain("limit=10");
    expect(out).toContain("page=2");
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwx");
  });

  it("参数名大小写不敏感", () => {
    expect(redactUrl("https://x.test/a?ApiKey=AIzaSyC1234567890abcdefghij")).not.toContain(
      "AIzaSyC",
    );
    expect(redactUrl("https://x.test/a?TOKEN=gsk_1234567890abcdefghij")).not.toContain("gsk_");
  });

  it("打掉 URL 里的 user:password@host 形式", () => {
    const out = redactUrl("http://user:hunter2secret@proxy.test:8080/path");
    expect(out).not.toContain("hunter2secret");
  });

  // 畸形 URL 是最危险的情况：解析失败若直接返回原串，等于把 key 原样记下来
  it("URL 解析失败时退化为文本脱敏，而不是原样返回", () => {
    const out = redactUrl("не-url ?key=AIzaSyC1234567890abcdefghij");
    expect(out).not.toContain("AIzaSyC1234567890abcdefghij");
  });
});

describe("redactText", () => {
  it("打掉各家密钥字面量", () => {
    const cases: Array<[string, string]> = [
      ["sk-abcdefghijklmnopqrstuvwxyz123456", "OpenAI 系"],
      ["gsk_abcdefghijklmnopqrstuvwxyz1234", "Groq"],
      ["AIzaSyC1234567890abcdefghijklmnop", "Google"],
      ["LTAI5tabcdefghijklmnop", "阿里云 AccessKeyId"],
      ["AKLTabcdefghijklmnopqrst", "火山引擎 AccessKeyId"],
      ["ghp_abcdefghijklmnopqrstuvwxyz1234", "GitHub"],
    ];
    for (const [secret, label] of cases) {
      const out = redactText(`请求失败，凭据 ${secret} 无效`);
      expect(out, label).not.toContain(secret);
      expect(out, label).toContain(REDACTION_MASK);
    }
  });

  it("打掉 Bearer / Basic 后的凭据", () => {
    expect(redactText("Authorization: Bearer abc123xyz789")).not.toContain("abc123xyz789");
    expect(redactText("Authorization: Basic dXNlcjpwYXNz")).not.toContain("dXNlcjpwYXNz");
  });

  it("正常错误文本不受影响", () => {
    const msg = "请求超时（15000ms）：https://api.deepseek.com/user/balance";
    expect(redactText(msg)).toBe(msg);
  });

  it("空串与无密钥文本原样返回", () => {
    expect(redactText("")).toBe("");
    expect(redactText("硅基流动 401: 未授权")).toBe("硅基流动 401: 未授权");
  });

  it("一段文本里多个密钥全部打掉", () => {
    const out = redactText(
      "key1=sk-abcdefghijklmnopqrstuvwx key2=gsk_abcdefghijklmnopqrst",
    );
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect(out).not.toContain("gsk_abcdefghijklmnopqrst");
  });
});

describe("redactError 的 cause 展开", () => {
  // 回归：undici 把所有网络故障包成 "TypeError: fetch failed"，
  // 真实原因在 cause 里。只取 message 的话日志上只剩这一句，无法定位
  it("展开 cause 暴露真实网络原因", () => {
    const inner = new Error("connect ECONNREFUSED 127.0.0.1:7890");
    (inner as Error & { code?: string }).code = "ECONNREFUSED";
    const outer = new TypeError("fetch failed");
    (outer as Error & { cause?: unknown }).cause = inner;

    const out = redactError(outer);
    expect(out).toContain("fetch failed");
    expect(out).toContain("ECONNREFUSED");
    expect(out).toContain("127.0.0.1:7890");
  });

  it("带上 code 便于分类", () => {
    const e = new Error("getaddrinfo ENOTFOUND api.moonshot.cn");
    (e as Error & { code?: string }).code = "ENOTFOUND";
    expect(redactError(e)).toContain("[ENOTFOUND]");
  });

  it("多层 cause 逐层展开", () => {
    const l3 = new Error("最内层");
    const l2 = new Error("中间层");
    (l2 as Error & { cause?: unknown }).cause = l3;
    const l1 = new Error("最外层");
    (l1 as Error & { cause?: unknown }).cause = l2;
    const out = redactError(l1);
    expect(out).toContain("最外层");
    expect(out).toContain("中间层");
    expect(out).toContain("最内层");
  });

  it("自引用的 cause 不会死循环", () => {
    const e = new Error("循环");
    (e as Error & { cause?: unknown }).cause = e;
    // 只要能返回就算通过（深度上限生效）
    expect(redactError(e)).toContain("循环");
  });

  it("cause 里的密钥同样被脱敏", () => {
    const inner = new Error("Authorization: Bearer sk-abcdefghijklmnopqrstuvwx 被拒");
    const outer = new TypeError("fetch failed");
    (outer as Error & { cause?: unknown }).cause = inner;
    expect(redactError(outer)).not.toContain("sk-abcdefghijklmnopqrstuvwx");
  });
});

describe("redactError", () => {
  it("清洗 Error 的消息", () => {
    const e = new Error(
      "请求超时（15000ms）：https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyC1234567890abcdefghij",
    );
    const out = redactError(e);
    expect(out).not.toContain("AIzaSyC1234567890abcdefghij");
    expect(out).toContain("请求超时");
  });

  it("保留非 Error 类型的字符串形态", () => {
    expect(redactError("普通字符串")).toBe("普通字符串");
    expect(redactError(404)).toBe("404");
  });

  it("保留自定义错误类型名便于分类", () => {
    const e = new Error("boom");
    e.name = "AbortError";
    expect(redactError(e)).toBe("AbortError: boom");
  });

  it("null / undefined 不抛异常", () => {
    expect(redactError(null)).toBe("null");
    expect(redactError(undefined)).toBe("undefined");
  });
});

describe("redactHeaders", () => {
  it("打掉 Authorization 与 Cookie", () => {
    const out = redactHeaders({
      Authorization: "Bearer sk-abcdefghijklmnopqrstuvwx",
      Cookie: "Token=abc123; session=xyz",
      "Content-Type": "application/json",
    });
    expect(out.Authorization).toBe(REDACTION_MASK);
    expect(out.Cookie).toBe(REDACTION_MASK);
    expect(out["Content-Type"]).toBe("application/json");
  });

  it("头名字大小写不敏感", () => {
    expect(redactHeaders({ authorization: "Bearer x" }).authorization).toBe(REDACTION_MASK);
    expect(redactHeaders({ "X-API-KEY": "abc" })["X-API-KEY"]).toBe(REDACTION_MASK);
  });

  it("undefined 返回空对象", () => {
    expect(redactHeaders(undefined)).toEqual({});
  });
});
