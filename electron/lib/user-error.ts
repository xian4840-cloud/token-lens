/**
 * 把适配器 / 网络层抛出的错误翻成卡片上能看懂的短句。
 *
 * 原文进日志（调用方 logError 之后再调这里），卡片只给人话：
 * `TypeError: fetch failed` 和 `OpenAI 401: {json 前 200 字}` 对排查有用，
 * 对「我的余额呢」没有用。
 */

const TIMEOUT = "请求超时，可在设置里调大超时";
const NETWORK = "连不上该服务，检查网络或代理";
const AUTH = "Key 无效或已过期，请到管理页更新";
const UPSTREAM = "服务商接口暂时不可用";
const MISSING = "缺少凭证，请到管理页补全";
const FALLBACK = "查询失败，详情见设置里的诊断日志";

export function mapErrorToUserMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";

  if (name === "AbortError" || /请求超时/.test(msg) || /aborted/i.test(msg)) {
    return TIMEOUT;
  }
  if (/\b401\b/.test(msg) || /\b403\b/.test(msg) || /unauthorized/i.test(msg)) {
    return AUTH;
  }
  if (/\b50[0-9]\b/.test(msg)) return UPSTREAM;
  if (/缺少\s*(API Key|Admin API Key|Cookie|AccessKey|凭证)/.test(msg)) {
    return MISSING;
  }
  if (
    /fetch failed/i.test(msg) ||
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH/i.test(msg) ||
    /network/i.test(msg)
  ) {
    return NETWORK;
  }
  // 适配器已经给过短中文（如「请重新登录获取凭证」），不含上游 JSON 就原样用
  if (/[\u4e00-\u9fff]/.test(msg) && msg.length <= 40 && !/[{<[]/.test(msg)) {
    return msg;
  }
  return FALLBACK;
}
