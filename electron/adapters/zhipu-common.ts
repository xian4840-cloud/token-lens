import { fetchWithTimeout } from "../lib/http";

export { pickNumber } from "../lib/amount";

/** 智谱开放平台业务接口的统一信封 */
export interface ZhipuEnvelope {
  code?: number | string;
  msg?: string;
  message?: string;
  success?: boolean;
  data?: unknown;
  rows?: unknown;
  [key: string]: unknown;
}

export type ZhipuRegion = "cn" | "global";

/**
 * 区域 → API 根地址。
 * 国内站 open.bigmodel.cn 与国际站 api.z.ai 的路径相同，只是 host 不同。
 * 实测 tokenAccounts / getCustomerBalance / quota/limit / subscription/list
 * 在两边都存在，鉴权失败时 HTTP 仍可能是 200，业务码在 JSON 的 code 字段。
 */
export function resolveZhipuBase(config: Record<string, unknown>): string {
  const raw = String(config.region ?? "cn")
    .trim()
    .toLowerCase();
  if (raw === "global" || raw === "intl" || raw === "zai" || raw === "z.ai") {
    return "https://api.z.ai";
  }
  return "https://open.bigmodel.cn";
}

export function resolveZhipuRegion(config: Record<string, unknown>): ZhipuRegion {
  return resolveZhipuBase(config).includes("z.ai") ? "global" : "cn";
}

/**
 * 业务接口是否成功。
 *
 * 智谱 /api/biz/* 与 /api/monitor/* 在鉴权失败时仍返回 HTTP 200，
 * 真正的失败写在 JSON：`{ code: 401, success: false, msg: "..." }`。
 * 只看 res.ok 会把无效 Key 当成查到了空余额。
 */
export function isEnvelopeOk(httpOk: boolean, json: ZhipuEnvelope): boolean {
  if (!httpOk) return false;
  if (json.success === false) return false;
  if (json.code == null || json.code === "") return true;
  const c = Number(json.code);
  if (Number.isFinite(c)) return c === 200 || c === 0;
  const s = String(json.code).toLowerCase();
  return s === "success" || s === "ok";
}

function isAuthFailure(status: number, json: ZhipuEnvelope): boolean {
  if (status === 401 || status === 403) return true;
  const c = Number(json.code);
  return c === 401 || c === 403 || c === 1000 || c === 1001 || c === 1002 || c === 1004;
}

async function requestJson(
  url: string,
  apiKey: string,
  bearer: boolean,
): Promise<{ status: number; ok: boolean; text: string; json: ZhipuEnvelope }> {
  const res = await fetchWithTimeout(url, {
    headers: {
      Authorization: bearer ? `Bearer ${apiKey}` : apiKey,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let json: ZhipuEnvelope = {};
  if (text.trim()) {
    try {
      json = JSON.parse(text) as ZhipuEnvelope;
    } catch {
      json = {};
    }
  }
  return { status: res.status, ok: res.ok, text, json };
}

/**
 * 调智谱业务接口并解析信封。
 *
 * 认证头先带 `Bearer`，若判定为鉴权失败再用不带前缀的裸 Key 重试——
 * 社区实现两种写法都有，官方控制台与 CodexBar 用 Bearer，
 * 部分 Coding Plan 查询脚本用不带前缀的 Authorization。
 */
export async function fetchZhipuJson(url: string, apiKey: string): Promise<ZhipuEnvelope> {
  let result = await requestJson(url, apiKey, true);
  if (!isEnvelopeOk(result.ok, result.json) && isAuthFailure(result.status, result.json)) {
    const retry = await requestJson(url, apiKey, false);
    if (isEnvelopeOk(retry.ok, retry.json)) return retry.json;
    result = retry;
  }
  if (!isEnvelopeOk(result.ok, result.json)) {
    const msg =
      (typeof result.json.msg === "string" && result.json.msg) ||
      (typeof result.json.message === "string" && result.json.message) ||
      result.text.slice(0, 200) ||
      `HTTP ${result.status}`;
    if (isAuthFailure(result.status, result.json)) {
      throw new Error(`智谱: Key 无效或已过期（${msg}）`);
    }
    throw new Error(`智谱 ${result.status}: ${msg}`);
  }
  return result.json;
}

export const REGION_FIELD = {
  key: "region",
  label: "区域",
  type: "select" as const,
  options: [
    { label: "国内（open.bigmodel.cn）", value: "cn" },
    { label: "国际（api.z.ai）", value: "global" },
  ],
  help: "国内站与国际站账号、余额互相独立，选错会报 Key 无效。留空默认国内。",
};

export const API_KEY_FIELD = {
  key: "apiKey",
  label: "API Key",
  type: "password" as const,
  placeholder: "xxxxxxxx.xxxxxxxx",
  required: true,
  help: "智谱开放平台 API Keys 页创建，格式为 {id}.{secret}",
};
