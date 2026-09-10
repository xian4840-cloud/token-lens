import { describe, expect, it } from "vitest";
import { DEFAULT_BYPASS_RULES, shouldBypassProxy } from "./http";
import { DEFAULT_BYPASS_RULES as UI_DEFAULT_BYPASS_RULES } from "../../ui/src/lib/proxy";

/**
 * 代理直连旁路规则。
 *
 * 这个判断决定一个请求是直连还是走代理：判错的方向有两个，都不好受——
 * 该直连的走了代理，国内服务的 API Key 就经第三方出国；
 * 该走代理的直连了，用户在墙内根本连不上。
 */

describe("shouldBypassProxy", () => {
  it("默认规则放行国内服务域名（后缀匹配，含裸域）", () => {
    expect(shouldBypassProxy("https://api.moonshot.cn/v1/users/me/balance")).toBe(true);
    expect(shouldBypassProxy("https://api.siliconflow.cn/v1/user/info")).toBe(true);
    expect(shouldBypassProxy("https://business.aliyuncs.com/")).toBe(true);
    expect(shouldBypassProxy("https://www.scnet.cn/api")).toBe(true);
    // 裸域本身也算命中
    expect(shouldBypassProxy("https://moonshot.cn/")).toBe(true);
  });

  it("境外服务域名不旁路", () => {
    expect(shouldBypassProxy("https://api.openai.com/v1/models")).toBe(false);
    expect(shouldBypassProxy("https://api.anthropic.com/v1/messages")).toBe(false);
    // 不能把 "cn" 当成后缀去匹配任意以 cn 结尾的名字
    expect(shouldBypassProxy("https://evilcn.com/")).toBe(false);
  });

  it("<local> 放行本机各种写法（回归：IPv6 曾漏判）", () => {
    // WHATWG URL 的 hostname 对 IPv6 字面量带方括号（"[::1]"），
    // 此前直接拿去和 "::1" 比，永远不相等，环回地址会被推去走代理
    expect(shouldBypassProxy("http://[::1]:8080/x")).toBe(true);
    expect(shouldBypassProxy("http://127.0.0.1:5173/")).toBe(true);
    expect(shouldBypassProxy("http://localhost:5173/")).toBe(true);
    expect(shouldBypassProxy("http://0.0.0.0:8080/")).toBe(true);
    expect(shouldBypassProxy("http://printer.local/")).toBe(true);
  });

  it("主机名大小写不敏感", () => {
    expect(shouldBypassProxy("https://API.Moonshot.CN/x")).toBe(true);
  });

  it("自定义规则里 *. 与前导点两种写法等价", () => {
    expect(shouldBypassProxy("https://a.example.com/", "*.example.com")).toBe(true);
    expect(shouldBypassProxy("https://a.example.com/", ".example.com")).toBe(true);
    expect(shouldBypassProxy("https://example.com/", "*.example.com")).toBe(true);
    // 不该把 notexample.com 误判成 example.com 的子域
    expect(shouldBypassProxy("https://notexample.com/", "*.example.com")).toBe(false);
  });

  it("规则支持逗号、分号与换行分隔，并忽略空白项", () => {
    const rules = " *.foo.com ;\n bar.com ,, baz.com ";
    expect(shouldBypassProxy("https://x.foo.com/", rules)).toBe(true);
    expect(shouldBypassProxy("https://bar.com/", rules)).toBe(true);
    expect(shouldBypassProxy("https://baz.com/", rules)).toBe(true);
    expect(shouldBypassProxy("https://other.com/", rules)).toBe(false);
  });

  it("URL 非法时返回 false（宁可不旁路）", () => {
    expect(shouldBypassProxy("不是 URL")).toBe(false);
    expect(shouldBypassProxy("")).toBe(false);
  });

  it("默认规则本身包含本机与国内域名", () => {
    expect(DEFAULT_BYPASS_RULES).toContain("<local>");
    expect(DEFAULT_BYPASS_RULES).toContain("*.cn");
  });
});

describe("默认规则的跨进程一致性", () => {
  it("主进程实际生效的那份与界面展示的那份是同一套（回归）", () => {
    // 用户没设置过时，设置页显示界面侧的那份，而应用按主进程侧的那份分流。
    // 两份一旦不同，用户看到的就是一套不生效的规则，且无从察觉。
    expect(UI_DEFAULT_BYPASS_RULES).toBe(DEFAULT_BYPASS_RULES);
  });

  it("两份都不能为空且都要覆盖本机直连", () => {
    for (const rules of [DEFAULT_BYPASS_RULES, UI_DEFAULT_BYPASS_RULES]) {
      expect(rules.trim()).not.toBe("");
      expect(rules).toContain("<local>");
    }
  });
});
