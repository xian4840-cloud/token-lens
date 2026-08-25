import { BrowserWindow, session } from "electron";

/**
 * 通用登录窗口凭证获取工具。
 *
 * 适用于「web 端控制台 + cookie/header 鉴权」的 plan 服务：开独立 partition
 * 窗口加载官方控制台，用户登录后，通过 webRequest 拦截该域请求，提取指定
 * header（cookie / csrf / web-id 等）作为适配器凭证。
 *
 * 好处：用户无需手动 F12 抓包，应用内登录即自动取凭证；partition 持久化，
 * 下次可能免重登。
 *
 * 不做逆向登录接口（避开验证码/风控），仅加载官方控制台拦截真实请求，最可靠。
 */

export interface LoginWindowOptions {
  /** 独立 partition 名（持久化，隔离主 app session，免重登） */
  partition: string;
  /** 加载的控制台/登录 URL（未登录通常自动跳登录页） */
  loginUrl: string;
  /** 窗口标题 */
  title: string;
  /**
   * 允许的域（hostname 后缀）。hostname 等于或以 `.${domain}` 结尾均算。
   * 用于导航限制（防诱导跳转）与请求拦截过滤。
   * 如 ["volcengine.com"] 匹配 volcengine.com 与 *.volcengine.com。
   */
  allowedDomains: string[];
  /**
   * 需从请求 header 提取的字段名（HTTP header 大小写不敏感，写小写即可）。
   * 如 ["cookie", "x-web-id"]。
   */
  extractHeaders: string[];
  /**
   * 判断提取到的 header 是否构成有效凭证（如 cookie 含 csrfToken 表示已登录）。
   * 返回 true 触发完成。提取字段缺失时由调用方在 isValid 内处理。
   */
  isValid: (headers: Record<string, string>) => boolean;
  /** 可选 UA 伪装（避开风控识别 Electron） */
  userAgent?: string;
  /**
   * 可选：对拦截到的候选凭证做真实接口有效性验证（cookie 鉴权服务用）。
   * 返回 true 才视为有效并完成；返回 false 则丢弃该候选、继续监听，等用户
   * 在控制台重新登录后产生的新凭证。
   *
   * 用于避免 partition 残留的过期 cookie 透过 isValid 格式校验后被秒返回，
   * 导致用户想更新凭证时根本进不到登录页。未提供时退化为仅 isValid 格式
   * 校验（原行为）。
   */
  validate?: (credentials: ExtractedCredentials) => Promise<boolean>;
  /** 窗口宽，默认 1100 */
  width?: number;
  /** 窗口高，默认 800 */
  height?: number;
}

/** 提取到的凭证（header 名小写 -> 值） */
export type ExtractedCredentials = Record<string, string>;

/** 大小写不敏感取请求 header（HTTP header 存储时大小写不定） */
function getHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/** 判断 URL hostname 是否在允许域内 */
function isAllowedUrl(url: string, allowedDomains: string[]): boolean {
  try {
    const h = new URL(url).hostname;
    return allowedDomains.some((d) => h === d || h.endsWith("." + d));
  } catch {
    return false;
  }
}

/** 域名列表转 onBeforeSendHeaders 的 URL 过滤模式（仅 https，控制台均为 https） */
function toUrlPatterns(allowedDomains: string[]): string[] {
  return allowedDomains.flatMap((d) => [
    `https://*.${d}/*`,
    `https://${d}/*`,
  ]);
}

/**
 * 打开通用登录窗口，提取凭证 header。返回 null 表示用户关闭窗口未完成。
 *
 * 流程：加载控制台 -> 用户登录 -> 拦截允许域的请求 -> 提取指定 header ->
 * isValid 通过则延迟关闭窗口并返回凭证。
 */
export function openLoginWindow(
  options: LoginWindowOptions,
): Promise<ExtractedCredentials | null> {
  const {
    partition,
    loginUrl,
    title,
    allowedDomains,
    extractHeaders,
    isValid,
    validate,
    userAgent,
    width = 1100,
    height = 800,
  } = options;

  return new Promise((resolve) => {
    let resolved = false;
    const ses = session.fromPartition(partition);

    const win = new BrowserWindow({
      width,
      height,
      title,
      backgroundColor: "#ffffff",
      webPreferences: {
        partition,
        contextIsolation: true,
        sandbox: true,
      },
    });

    if (userAgent) {
      win.webContents.setUserAgent(userAgent);
    }

    // 安全加固：登录窗口内拒绝新窗口；导航仅限允许域，防被诱导跳转到第三方站点
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e, url) => {
      if (!isAllowedUrl(url, allowedDomains)) e.preventDefault();
    });

    const finish = (cred: ExtractedCredentials | null) => {
      if (resolved) return;
      resolved = true;
      // partition 持久，注销监听避免下次登录累积重复监听器
      try {
        ses.webRequest.onBeforeSendHeaders(null as never);
      } catch {
        // 某些 Electron 版本不接受 null；resolved 标志已防重复
      }
      resolve(cred);
    };

    // 已处理过的候选凭证 key（避免对同一残留 cookie 重复打接口验证）
    const seenKeys = new Set<string>();
    // 正在验证中的 key（防止同 key 并发重复验证）
    const validatingKeys = new Set<string>();

    ses.webRequest.onBeforeSendHeaders(
      { urls: toUrlPatterns(allowedDomains) },
      (details, cb) => {
        cb({}); // 先放行请求，验证异步进行，不阻塞页面加载
        if (resolved) return;
        const extracted: Record<string, string> = {};
        for (const name of extractHeaders) {
          const v = getHeader(details.requestHeaders, name);
          if (v) extracted[name.toLowerCase()] = v;
        }
        if (Object.keys(extracted).length === 0 || !isValid(extracted)) return;

        const key = JSON.stringify(extracted);
        // 同一候选已验证过或正在验证：跳过，等用户重登产生新 cookie（key 不同）再验
        if (seenKeys.has(key) || validatingKeys.has(key)) return;
        validatingKeys.add(key);

        void (async () => {
          try {
            const ok = validate ? await validate(extracted) : true;
            seenKeys.add(key);
            if (ok && !resolved) {
              finish(extracted);
              // 延迟关闭，避免在请求回调内同步关闭导致异常
              setTimeout(() => win.close(), 0);
            }
            // ok=false：候选无效（如残留的过期 cookie），保持监听等新凭证
          } catch {
            seenKeys.add(key);
            // 验证异常视为无效，继续等待
          } finally {
            validatingKeys.delete(key);
          }
        })();
      },
    );

    win.on("closed", () => finish(null));
    void win.loadURL(loginUrl);
  });
}
