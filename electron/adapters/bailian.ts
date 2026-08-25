import type { Adapter, BalanceResult } from "../types";
import { fetchWithTimeout } from "../lib/http";
import { signAcs3 } from "./signing";

const HOST = "business.aliyuncs.com";
/** BSSOpenAPI 版本号 */
const API_VERSION = "2017-12-14";

interface BalanceResponse {
  Code?: string;
  Message?: string;
  Success?: boolean;
  RequestId?: string;
  Data?: {
    AccountName?: string;
    Balance?: string;
    AvailableAmount?: string;
    AvailableCashAmount?: string;
    CreditAmount?: string;
    MybankCreditAmount?: string;
    Currency?: string;
  };
}

/** 金额字符串转数字。阿里云返回形如 "1,234.56"，需先去掉千分位分隔符 */
function parseAmount(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 百炼（阿里云）适配器。
 *
 * 百炼 DashScope 的 API Key（sk-）没有余额查询接口，故改用阿里云 AccessKey
 * 调 BSSOpenAPI 的 QueryAccountBalance。
 *
 * 注意语义：返回的是**整个阿里云账号**的可用余额，不是百炼单独的消费额度。
 * 账号下若还有其它阿里云产品，该数字为共用余额。
 *
 * 签名走 signAcs3（ACS3-HMAC-SHA256），已用阿里云官方自校验向量验证过；
 * 不要改回 signSigV4，两者算法结构不同。
 */
export const bailianAdapter: Adapter = {
  definition: {
    provider: "bailian",
    label: "百炼",
    kind: "api",
    official: true,
    description:
      "阿里云百炼。经 BSSOpenAPI 查询阿里云账号可用余额（需 AccessKey，非百炼 sk- 密钥；余额为账号级共用）",
    configSchema: [
      {
        key: "accessKeyId",
        label: "AccessKey ID",
        type: "string",
        required: true,
        help: "阿里云主账号或 RAM 用户的 AccessKey ID（非百炼 sk- 密钥）。RAM 用户需授予 AliyunBSSReadOnlyAccess 权限",
      },
      {
        key: "accessKeySecret",
        label: "AccessKey Secret",
        type: "password",
        required: true,
      },
    ],
  },

  async fetchBalance(config, secrets): Promise<BalanceResult> {
    const ak = config.accessKeyId as string;
    const sk = secrets.accessKeySecret;
    if (!ak || !sk) throw new Error("缺少 AccessKey");

    // RPC 风格接口：路径固定 "/"，动作与版本走 x-acs-* header，无查询参数
    const { headers } = signAcs3({
      method: "GET",
      uri: "/",
      query: {},
      host: HOST,
      headers: {
        "x-acs-action": "QueryAccountBalance",
        "x-acs-version": API_VERSION,
        accept: "application/json",
      },
      payload: "",
      ak,
      sk,
    });

    const res = await fetchWithTimeout(`https://${HOST}/`, { method: "GET", headers });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`百炼 ${res.status}: ${text.slice(0, 200)}`);
    }

    let json: BalanceResponse;
    try {
      json = JSON.parse(text) as BalanceResponse;
    } catch {
      throw new Error(`百炼响应非 JSON: ${text.slice(0, 200)}`);
    }

    // 成功响应为 Code="Success" / Success=true；其余视为业务错误
    const okCode = json.Code === "Success" || json.Code === "200" || json.Code == null;
    if (json.Success === false || !okCode) {
      throw new Error(`百炼 ${json.Code ?? "错误"}: ${json.Message ?? "查询失败"}`);
    }

    const data = json.Data;
    const remaining =
      parseAmount(data?.AvailableAmount) ??
      parseAmount(data?.AvailableCashAmount) ??
      parseAmount(data?.Balance);

    return {
      remaining,
      currency: data?.Currency ?? "CNY",
      fetchedAt: new Date().toISOString(),
      raw: json,
    };
  },
};
