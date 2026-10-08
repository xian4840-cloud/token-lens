import type { Adapter, BalanceResult, ConfigField } from "../types";
import { fetchWithTimeout } from "../lib/http";

/**
 * 「只能校验 Key」的适配器的共用实现（Groq / Gemini / Together AI）。
 *
 * 这几家都没有公开的余额 / 配额查询 API，只能请求一个需要鉴权的轻量接口（/models）
 * 判断 Key 是否有效：成功返回「Key 有效」且不带任何数字，失败抛出「<名称> <状态码>: <响应前 200 字>」。
 * 各家只在 URL、鉴权头和展示文案上不同。
 */
export interface KeyCheckAdapterOptions {
  provider: string;
  label: string;
  description: string;
  /** API Key 输入框的占位提示 */
  placeholder?: string;
  /** 用于校验 Key 的接口 */
  checkUrl: string;
  /** 由 Key 生成鉴权请求头 */
  authHeaders: (apiKey: string) => Record<string, string>;
  /** 报错信息里的服务名，如 "Groq" */
  errorName: string;
}

export function createKeyCheckAdapter(opts: KeyCheckAdapterOptions): Adapter {
  const apiKeyField: ConfigField = {
    key: "apiKey",
    label: "API Key",
    type: "password",
    ...(opts.placeholder ? { placeholder: opts.placeholder } : {}),
    required: true,
  };
  return {
    definition: {
      provider: opts.provider,
      label: opts.label,
      kind: "api",
      official: true,
      description: opts.description,
      configSchema: [apiKeyField],
    },

    async fetchBalance(_config, secrets): Promise<BalanceResult> {
      const apiKey = secrets.apiKey;
      if (!apiKey) throw new Error("缺少 API Key");
      const res = await fetchWithTimeout(opts.checkUrl, {
        headers: opts.authHeaders(apiKey),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${opts.errorName} ${res.status}: ${text.slice(0, 200)}`);
      }
      // 无任何数字可返回，只能告知 Key 通过校验
      return {
        currency: "USD",
        statusLabel: "Key 有效",
        fetchedAt: new Date().toISOString(),
      };
    },
  };
}
