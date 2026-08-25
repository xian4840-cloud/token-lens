import { session, shell } from "electron";
import { ProxyAgent, Socks5ProxyAgent, type Dispatcher } from "undici";
import { getSetting } from "../db";
import type { ProxyTestResult } from "../types";

/**
 * 网络与外部链接的安全工具集合。
 *
 * - fetchWithTimeout：支持通过 undici ProxyAgent / Socks5ProxyAgent 代理分发与超时控制
 * - shouldBypassProxy：智能分流国内服务域名（直连旁路）
 * - applySessionProxy：同步 Electron Session 代理
 * - testNetworkConnectivity：一键测试海外与国内节点的网络连通性与延迟
 * - safeOpenExternal：仅放行 http/https 的 shell.openExternal，拦截 javascript:/file: 等危险协议
 * - CSP 域名白名单与构造：主窗口内容安全策略，限制脚本来源与外联目标
 */

/**
 * 适配器所需的全部远端域名（connect-src 白名单）。
 * 新增适配器时须在此登记，否则 CSP 会拦截其请求。
 */
export const CSP_CONNECT_DOMAINS: readonly string[] = [
  "api.openai.com",
  "openrouter.ai",
  "api.deepseek.com",
  "api.siliconflow.cn",
  "api.groq.com",
  "generativelanguage.googleapis.com",
  "api.together.xyz",
  "api.anthropic.com",
  "business.aliyuncs.com",
  "billing.volcengineapi.com",
  "console.volcengine.com",
  "api.moonshot.cn",
  "www.scnet.cn",
];

/** 默认请求超时（ms）。远端未响应则中止，避免调度器卡死。 */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** 默认国内服务与本地直连旁路规则 */
export const DEFAULT_BYPASS_RULES =
  "<local>,*.cn,*.aliyuncs.com,*.volcengineapi.com,*.volcengine.com,*.moonshot.cn,*.minimax.chat,*.minimaxi.com,*.xiaomimimo.com,*.scnet.cn,*.siliconflow.cn";

/** 代理 Agent 缓存，避免重复为相同代理地址创建 Agent */
const agentCache = new Map<string, Dispatcher>();

export function clearProxyAgentCache(): void {
  agentCache.clear();
}

function getOrCreateAgent(proxyUrl: string): Dispatcher {
  const trimmed = proxyUrl.trim();
  let agent = agentCache.get(trimmed);
  if (agent) return agent;
  if (trimmed.startsWith("socks5://") || trimmed.startsWith("socks://")) {
    agent = new Socks5ProxyAgent(trimmed);
  } else {
    agent = new ProxyAgent(trimmed);
  }
  agentCache.set(trimmed, agent);
  return agent;
}

/** 解析旁路规则字符串为规则列表 */
function parseBypassRules(rulesStr?: string): string[] {
  const raw = rulesStr ?? DEFAULT_BYPASS_RULES;
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** 判断目标 URL 是否符合直连旁路规则 */
export function shouldBypassProxy(targetUrl: string, rulesStr?: string): boolean {
  try {
    const { hostname } = new URL(targetUrl);
    const host = hostname.toLowerCase();
    const rules = parseBypassRules(rulesStr);

    for (const rule of rules) {
      if (
        rule === "<local>" ||
        rule === "localhost" ||
        rule === "127.0.0.1" ||
        rule === "::1" ||
        rule === "0.0.0.0"
      ) {
        if (
          host === "localhost" ||
          host === "127.0.0.1" ||
          host === "::1" ||
          host === "0.0.0.0" ||
          host.endsWith(".local")
        ) {
          return true;
        }
        continue;
      }

      if (rule.startsWith("*.")) {
        const suffix = rule.slice(2);
        if (host === suffix || host.endsWith("." + suffix)) {
          return true;
        }
        continue;
      }

      if (rule.startsWith(".")) {
        const suffix = rule.slice(1);
        if (host === suffix || host.endsWith("." + suffix)) {
          return true;
        }
        continue;
      }

      if (host === rule || host.endsWith("." + rule)) {
        return true;
      }
    }
  } catch {
    // URL 解析失败默认不旁路
  }
  return false;
}

export interface ProxyConfigOverride {
  mode?: string;
  customUrl?: string;
  bypassRules?: string;
}

/** 根据 URL 及当前配置获取 undici Dispatcher（支持 override 供测试用） */
export async function getDispatcherForUrl(
  url: string,
  override?: ProxyConfigOverride,
): Promise<Dispatcher | undefined> {
  const mode = override?.mode ?? getSetting("proxyMode") ?? "system";
  const customUrl = override?.customUrl ?? getSetting("proxyCustomUrl") ?? "";
  const bypassRules =
    override?.bypassRules ?? getSetting("proxyBypassRules") ?? DEFAULT_BYPASS_RULES;

  // 1. 命中智能分流直连规则
  if (shouldBypassProxy(url, bypassRules)) {
    return undefined;
  }

  // 2. 直连模式
  if (mode === "direct") {
    return undefined;
  }

  // 3. 自定义代理模式
  if (mode === "custom") {
    if (!customUrl.trim()) return undefined;
    return getOrCreateAgent(customUrl);
  }

  // 4. 跟随系统代理模式
  try {
    if (session.defaultSession) {
      const resolved = await session.defaultSession.resolveProxy(url);
      const parts = resolved.split(";").map((p) => p.trim());
      for (const part of parts) {
        if (part.startsWith("PROXY ")) {
          const host = part.replace(/^PROXY\s+/, "").trim();
          return getOrCreateAgent("http://" + host);
        }
        if (part.startsWith("SOCKS5 ") || part.startsWith("SOCKS ")) {
          const host = part.replace(/^SOCKS5?\s+/, "").trim();
          return getOrCreateAgent("socks5://" + host);
        }
        if (part.startsWith("HTTPS ")) {
          const host = part.replace(/^HTTPS\s+/, "").trim();
          return getOrCreateAgent("https://" + host);
        }
      }
    }
  } catch {
    // resolveProxy 失败时尝试读取环境变量兜底
  }

  const envProxy =
    process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (envProxy) {
    return getOrCreateAgent(envProxy);
  }

  return undefined;
}

/** 同步 Electron Session 代理配置 */
export async function applySessionProxy(): Promise<void> {
  clearProxyAgentCache();
  const mode = getSetting("proxyMode") || "system";
  const customUrl = getSetting("proxyCustomUrl") || "";
  const bypassRules = getSetting("proxyBypassRules") ?? DEFAULT_BYPASS_RULES;

  try {
    if (session.defaultSession) {
      if (mode === "direct") {
        await session.defaultSession.setProxy({ mode: "direct" });
      } else if (mode === "custom" && customUrl.trim()) {
        await session.defaultSession.setProxy({
          proxyRules: customUrl.trim(),
          proxyBypassRules: bypassRules,
        });
      } else {
        await session.defaultSession.setProxy({ mode: "system" });
      }
    }
  } catch (e) {
    console.error("应用 Session 代理设置失败:", e);
  }
}

/**
 * 带 AbortController 超时与代理分发的 fetch 包装。
 * 超时则 abort 并抛出「请求超时」错误；若调用方传入 init.signal 则尊重之。
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<Response> {
  const configuredTimeout = (() => {
    if (timeoutMs != null) return timeoutMs;
    const s = getSetting("requestTimeout");
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n * 1000 : DEFAULT_TIMEOUT_MS;
  })();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), configuredTimeout);
  try {
    const dispatcher =
      (init as { dispatcher?: Dispatcher }).dispatcher ??
      (await getDispatcherForUrl(url));

    return await fetch(url, {
      ...init,
      // @ts-expect-error Node global fetch supports dispatcher
      dispatcher,
      signal: init.signal ?? controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`请求超时（${configuredTimeout}ms）：${url}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 测试目标配置 */
export const TEST_TARGETS = [
  { name: "OpenAI", url: "https://api.openai.com/v1/models" },
  { name: "Anthropic", url: "https://api.anthropic.com/v1/messages" },
  { name: "Google Gemini", url: "https://generativelanguage.googleapis.com" },
  { name: "DeepSeek", url: "https://api.deepseek.com" },
  { name: "硅基流动 (国内直连)", url: "https://api.siliconflow.cn" },
];

/** 一键探测网络连通性与响应延迟 */
export async function testNetworkConnectivity(
  override?: ProxyConfigOverride,
): Promise<ProxyTestResult> {
  const results = await Promise.all(
    TEST_TARGETS.map(async (target) => {
      const start = Date.now();
      try {
        const dispatcher = await getDispatcherForUrl(target.url, override);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
          const res = await fetch(target.url, {
            method: "GET",
            // @ts-expect-error Node global fetch supports dispatcher
            dispatcher,
            signal: controller.signal,
          });
          const latencyMs = Date.now() - start;
          return {
            name: target.name,
            url: target.url,
            ok: true,
            latencyMs,
            statusText: `HTTP ${res.status}`,
          };
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        const latencyMs = Date.now() - start;
        const msg = e instanceof Error ? e.message : String(e);
        return {
          name: target.name,
          url: target.url,
          ok: false,
          latencyMs,
          error: msg.includes("AbortError") ? "连接超时 (10s)" : msg,
        };
      }
    }),
  );

  return { targets: results };
}

/**
 * 仅允许 http/https 协议的外部链接交给系统打开。
 * javascript:、file:、vbscript: 及自定义协议一律拒绝，防止被诱导执行。
 */
export function safeOpenExternal(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      void shell.openExternal(parsed.href);
    }
  } catch {
    // 非法 URL 静默忽略
  }
}

/**
 * 构造主窗口内容安全策略。
 * dev 模式为 Vite HMR 放开 localhost 与 'unsafe-eval'；生产模式严格限制。
 */
export function buildCsp(dev: boolean): string {
  const connectDomains = [
    "'self'",
    ...CSP_CONNECT_DOMAINS.map((d) => `https://${d}`),
  ];
  if (dev) {
    connectDomains.push(
      "http://localhost:5173",
      "ws://localhost:5173",
      "http://127.0.0.1:5173",
      "ws://127.0.0.1:5173",
    );
  }

  const scriptSrc = dev
    ? "'self' 'unsafe-eval' 'unsafe-inline'"
    : "'self'";
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectDomains.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

