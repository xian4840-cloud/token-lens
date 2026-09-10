import { describe, expect, it } from "vitest";
import { isAllowedUrl } from "./login-window";

/**
 * 登录窗口的域白名单。
 *
 * 这个判断同时管两件事：导航限制（防被诱导跳转到第三方站点）与请求拦截范围
 * （只从允许域提取 cookie）。判宽了等于把凭证交给攻击者挑的域，判严了用户
 * 登录时控制台自身的请求被漏掉、永远取不到凭证。所以边界要钉死。
 */

const DOMAINS = ["volcengine.com"];

describe("isAllowedUrl", () => {
  it("放行裸域与其子域", () => {
    expect(isAllowedUrl("https://volcengine.com/ark", DOMAINS)).toBe(true);
    expect(isAllowedUrl("https://console.volcengine.com/ark", DOMAINS)).toBe(true);
    expect(isAllowedUrl("https://a.b.volcengine.com/x", DOMAINS)).toBe(true);
  });

  it("拒绝把允许域名当后缀拼接的仿冒域（回归重点）", () => {
    // 若写成 h.endsWith(d) 或 h.includes(d)，下面这些都会被放行
    expect(isAllowedUrl("https://evil-volcengine.com/", DOMAINS)).toBe(false);
    expect(isAllowedUrl("https://notvolcengine.com/", DOMAINS)).toBe(false);
    expect(isAllowedUrl("https://volcengine.com.evil.com/", DOMAINS)).toBe(false);
    expect(isAllowedUrl("https://xvolcengine.com/", DOMAINS)).toBe(false);
  });

  it("主机名大小写不敏感", () => {
    expect(isAllowedUrl("https://Console.VolcEngine.COM/ark", DOMAINS)).toBe(true);
  });

  it("URL 非法时拒绝（宁可不放行）", () => {
    expect(isAllowedUrl("不是 URL", DOMAINS)).toBe(false);
    expect(isAllowedUrl("", DOMAINS)).toBe(false);
    expect(isAllowedUrl("javascript:alert(1)", DOMAINS)).toBe(false);
  });

  it("多个允许域各自生效", () => {
    const many = ["volcengine.com", "scnet.cn"];
    expect(isAllowedUrl("https://www.scnet.cn/ui", many)).toBe(true);
    expect(isAllowedUrl("https://console.volcengine.com/", many)).toBe(true);
    expect(isAllowedUrl("https://example.com/", many)).toBe(false);
  });

  it("空允许域列表一律拒绝", () => {
    expect(isAllowedUrl("https://volcengine.com/", [])).toBe(false);
  });
});
