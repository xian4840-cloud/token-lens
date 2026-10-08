import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoginWindowOptions } from "./login-window";

/**
 * 火山方舟 / 超算互联网的登录入口：只声明各自的控制台、允许域、提取字段、
 * 「已登录」判定与真实接口验证。判定写错的后果是要么游客 cookie 被当成登录成功，
 * 要么永远等不到完成，所以把这几条规则钉住。
 */

const m = vi.hoisted(() => ({
  openLoginWindow: vi.fn(),
  validateVolc: vi.fn(async () => true),
  validateScnet: vi.fn(async () => true),
}));
vi.mock("./login-window", () => ({ openLoginWindow: m.openLoginWindow }));
vi.mock("../adapters/volcengine_plan", () => ({
  validateVolcenginePlanCredentials: m.validateVolc,
}));
vi.mock("../adapters/scnet_token_plan", () => ({ validateScnetCredentials: m.validateScnet }));

const { openVolcengineLogin } = await import("./volcengine-login");
const { openScnetLogin } = await import("./scnet-login");
const { BROWSER_UA } = await import("../lib/user-agent");

const lastOptions = () => m.openLoginWindow.mock.calls.at(-1)?.[0] as LoginWindowOptions;

beforeEach(() => {
  m.openLoginWindow.mockReset();
});

describe("openVolcengineLogin", () => {
  it("限定 volcengine.com、持久 partition、与适配器同一个 UA，返回 cookie + xWebId", async () => {
    m.openLoginWindow.mockResolvedValue({ cookie: "csrfToken=a", "x-web-id": "w" });
    await expect(openVolcengineLogin()).resolves.toEqual({ cookie: "csrfToken=a", xWebId: "w" });
    const o = lastOptions();
    expect(o.allowedDomains).toEqual(["volcengine.com"]);
    expect(o.partition).toMatch(/^persist:/);
    expect(o.userAgent).toBe(BROWSER_UA);
    expect(o.extractHeaders).toEqual(["cookie", "x-web-id"]);
  });

  it("已登录判定要求 cookie 含 csrfToken 且有 x-web-id", async () => {
    m.openLoginWindow.mockResolvedValue(null);
    await expect(openVolcengineLogin()).resolves.toBeNull();
    const { isValid, validate } = lastOptions();
    expect(isValid({ cookie: "csrfToken=a", "x-web-id": "w" })).toBe(true);
    expect(isValid({ cookie: "sid=1", "x-web-id": "w" })).toBe(false);
    expect(isValid({ cookie: "csrfToken=a" })).toBe(false);
    await validate?.({ cookie: "csrfToken=a", "x-web-id": "w" });
    expect(m.validateVolc).toHaveBeenCalledWith("csrfToken=a", "w");
  });
});

describe("openScnetLogin", () => {
  it("只认登录态 Token= cookie，游客 cookie 不算；validate 走真实接口", async () => {
    m.openLoginWindow.mockResolvedValue({ cookie: "a=1; Token=xyz" });
    await expect(openScnetLogin()).resolves.toEqual({ cookie: "a=1; Token=xyz" });
    const { isValid, validate, allowedDomains } = lastOptions();
    expect(allowedDomains).toEqual(["scnet.cn"]);
    expect(isValid({ cookie: "a=1; Token=xyz" })).toBe(true);
    expect(isValid({ cookie: "Token=xyz" })).toBe(true);
    expect(isValid({ cookie: "visitorToken=1; a=2" })).toBe(false);
    expect(isValid({})).toBe(false);
    await validate?.({ cookie: "Token=xyz" });
    expect(m.validateScnet).toHaveBeenCalledWith("Token=xyz");
  });

  it("用户关闭窗口返回 null", async () => {
    m.openLoginWindow.mockResolvedValue(null);
    await expect(openScnetLogin()).resolves.toBeNull();
  });
});
