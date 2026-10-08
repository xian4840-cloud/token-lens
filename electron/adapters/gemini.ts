import { createKeyCheckAdapter } from "./key-check";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Google Gemini（AI Studio）适配器。
 * 未提供余额 / 配额查询 API，额度与计费需在 Google AI Studio 与 Cloud 控制台查看。
 * 此处调用 /models 校验 API Key 有效性，不返回余额数字。
 * 注意：Gemini API 同时存在免费档与付费档，故不在文案里断言「免费服务」。
 */
export const geminiAdapter = createKeyCheckAdapter({
  provider: "gemini",
  label: "Google Gemini",
  description: "无余额 / 配额查询 API，仅校验 Key 有效性（额度见 AI Studio 控制台）",
  placeholder: "AIza...",
  checkUrl: `${BASE}/models`,
  // key 走 x-goog-api-key 头而非 ?key= 查询串（官方文档现只展示头方式）：
  // 拼在 URL 里会随各类带 url 的错误消息、日志、代理访问记录一起漏出去，
  // 请求头则不会被这些路径带上。
  authHeaders: (apiKey) => ({ "x-goog-api-key": apiKey }),
  errorName: "Gemini",
});
