import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 登录窗口的完整流程（Electron 换成假的）：域过滤、导航与重定向拦截、
 * 凭证提取、validate 异步验证、用户关闭窗口、过期残留 cookie 不误判成功。
 */

interface Listener {
  event: string;
  cb: (...a: never[]) => void;
}

interface FakeWindow {
  webContents: {
    setUserAgent: ReturnType<typeof vi.fn>;
    setWindowOpenHandler: ReturnType<typeof vi.fn>;
    on: (event: string, cb: (...a: never[]) => void) => void;
    emit: (event: string, ...a: unknown[]) => void;
  };
  loadURL: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: (event: string, cb: (...a: never[]) => void) => void;
  emit: (event: string, ...a: unknown[]) => void;
}

const windows: FakeWindow[] = [];
const sessions: {
  filter: unknown;
  handler: ((d: unknown, cb: (o: unknown) => void) => void) | null;
}[] = [];

vi.mock("electron", () => ({
  BrowserWindow: class {
    webContents: FakeWindow["webContents"];
    loadURL = vi.fn();
    close = vi.fn();
    private listeners: Listener[] = [];
    constructor() {
      const wcListeners: Listener[] = [];
      this.webContents = {
        setUserAgent: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        on: (event: string, cb: (...a: never[]) => void) => {
          wcListeners.push({ event, cb });
        },
        emit: (event: string, ...a: unknown[]) => {
          for (const l of wcListeners) if (l.event === event) l.cb(...(a as never[]));
        },
      };
      windows.push(this as unknown as FakeWindow);
    }
    on(event: string, cb: (...a: never[]) => void) {
      this.listeners.push({ event, cb });
    }
    emit(event: string, ...a: unknown[]) {
      for (const l of this.listeners) if (l.event === event) l.cb(...(a as never[]));
    }
  },
  session: {
    fromPartition: vi.fn(() => {
      const s = {
        filter: undefined as unknown,
        handler: null as ((d: unknown, cb: (o: unknown) => void) => void) | null,
      };
      sessions.push(s);
      return {
        webRequest: {
          onBeforeSendHeaders: (
            filter: unknown,
            handler?: (d: unknown, cb: (o: unknown) => void) => void,
          ) => {
            s.filter = filter;
            s.handler = handler ?? null;
          },
        },
      };
    }),
  },
}));

const { openLoginWindow } = await import("./login-window");

const base = {
  partition: "persist:test-auth",
  loginUrl: "https://console.example.com/login",
  title: "登录测试",
  allowedDomains: ["example.com"],
  extractHeaders: ["cookie", "x-web-id"],
  isValid: (h: Record<string, string>) =>
    !!h.cookie && !!h["x-web-id"] && h.cookie.includes("csrfToken"),
};

function request(headers: Record<string, string>, url = "https://console.example.com/api") {
  const cb = vi.fn();
  sessions.at(-1)?.handler?.({ url, requestHeaders: headers }, cb);
  return cb;
}

beforeEach(() => {
  windows.length = 0;
  sessions.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("openLoginWindow", () => {
  it("窗口配置：独立 partition、隔离、沙箱、UA 与拦截范围", async () => {
    const p = openLoginWindow({ ...base, userAgent: "TestUA/1", width: 900 });
    const win = windows[0];
    expect(win.loadURL).toHaveBeenCalledWith(base.loginUrl);
    expect(win.webContents.setUserAgent).toHaveBeenCalledWith("TestUA/1");
    expect(sessions[0].filter).toEqual({
      urls: ["https://*.example.com/*", "https://example.com/*"],
    });
    win.emit("closed");
    await expect(p).resolves.toBeNull();
  });

  it("拦截到有效凭证：返回提取结果并关闭窗口；拦截器放行请求、header 大小写不敏感", async () => {
    const p = openLoginWindow(base);
    const cb = request({
      Cookie: "csrfToken=abc; sid=1",
      "X-Web-Id": "w1",
      Authorization: "Bearer x",
    });
    expect(cb).toHaveBeenCalledWith({});
    await expect(p).resolves.toEqual({ cookie: "csrfToken=abc; sid=1", "x-web-id": "w1" });
    vi.runAllTimers();
    expect(windows[0].close).toHaveBeenCalledTimes(1);
  });

  it("缺字段或格式不符（未登录）不结束，继续等到有效请求", async () => {
    const p = openLoginWindow(base);
    request({ cookie: "sid=1" }); // 没有 csrfToken
    request({ "x-web-id": "w1" }); // 没有 cookie
    request({});
    expect(windows[0].close).not.toHaveBeenCalled();
    request({ cookie: "csrfToken=ok", "x-web-id": "w1" });
    await expect(p).resolves.toEqual({ cookie: "csrfToken=ok", "x-web-id": "w1" });
  });

  it("validate：真实接口不过的残留 cookie 不结束，换一套新凭证才算成功", async () => {
    const validate = vi.fn(async (h: Record<string, string>) => h.cookie.includes("new"));
    const p = openLoginWindow({ ...base, validate });
    request({ cookie: "csrfToken=stale", "x-web-id": "w1" });
    await vi.waitFor(() => expect(validate).toHaveBeenCalledTimes(1));
    expect(windows[0].close).not.toHaveBeenCalled();
    // 同一套残留 cookie 反复出现不再打接口
    request({ cookie: "csrfToken=stale", "x-web-id": "w1" });
    request({ cookie: "csrfToken=stale", "x-web-id": "w1" });
    expect(validate).toHaveBeenCalledTimes(1);
    request({ cookie: "csrfToken=new", "x-web-id": "w2" });
    await expect(p).resolves.toEqual({ cookie: "csrfToken=new", "x-web-id": "w2" });
  });

  it("validate 抛错视为无效，不结束、不重复验证同一候选", async () => {
    const validate = vi.fn(async () => {
      throw new Error("网络错误");
    });
    const p = openLoginWindow({ ...base, validate });
    request({ cookie: "csrfToken=x", "x-web-id": "w1" });
    await vi.waitFor(() => expect(validate).toHaveBeenCalledTimes(1));
    request({ cookie: "csrfToken=x", "x-web-id": "w1" });
    expect(validate).toHaveBeenCalledTimes(1);
    windows[0].emit("closed");
    await expect(p).resolves.toBeNull();
  });

  it("验证进行中用户关掉窗口：结果是 null，迟到的验证成功不再关闭", async () => {
    let decide: (v: boolean) => void = () => undefined;
    const p = openLoginWindow({
      ...base,
      validate: () => new Promise<boolean>((r) => (decide = r)),
    });
    request({ cookie: "csrfToken=x", "x-web-id": "w1" });
    windows[0].emit("closed");
    await expect(p).resolves.toBeNull();
    decide(true);
    await vi.runAllTimersAsync();
    expect(windows[0].close).not.toHaveBeenCalled();
  });

  it("导航与重定向：允许域放行，域外阻止；新窗口一律拒绝", async () => {
    openLoginWindow(base);
    const win = windows[0];
    expect(win.webContents.setWindowOpenHandler).toHaveBeenCalled();
    const openHandler = win.webContents.setWindowOpenHandler.mock.calls[0][0] as () => unknown;
    expect(openHandler()).toEqual({ action: "deny" });

    const nav = (event: string, url: string) => {
      const e = { preventDefault: vi.fn() };
      win.webContents.emit(event, e, url);
      return e.preventDefault.mock.calls.length;
    };
    expect(nav("will-navigate", "https://console.example.com/home")).toBe(0);
    expect(nav("will-navigate", "https://evil-example.com/phish")).toBe(1);
    expect(nav("will-redirect", "https://phish.example")).toBe(1);
    expect(nav("will-redirect", "https://a.example.com/cb")).toBe(0);
    windows[0].emit("closed");
  });

  it("完成后注销请求监听，后续请求不再处理", async () => {
    const p = openLoginWindow(base);
    request({ cookie: "csrfToken=ok", "x-web-id": "w1" });
    await p;
    expect(sessions[0].handler).toBeNull();
  });
});
