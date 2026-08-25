import type { Adapter, BalanceResult } from "../types";
import { fetchWithTimeout } from "../lib/http";
import {
  signSigV4,
  formatSigV4Date,
  formatSigV4DateTime,
} from "./signing";

const HOST = "billing.volcengineapi.com";

interface VolcResponse {
  ResponseMetadata?: {
    RequestId?: string;
    Error?: { Code?: string; Message?: string; CodeN?: number };
  };
  Result?: {
    AccountID?: number;
    AvailableBalance?: string;
    CashBalance?: string;
    CreditLimit?: string;
    ArrearsBalance?: string;
    FreezeAmount?: string;
  };
}

/**
 * 火山引擎（火山方舟）适配器。
 * 方舟服务本身无余额查询 OpenAPI，通过计费服务 billing 的
 * QueryBalanceAcct 查询账户可用余额。签名走 Volcengine Signature V4，
 * 注意 host 与 content-type 不参与签名（与官方 Node SDK 一致）。
 */
export const volcengineAdapter: Adapter = {
  definition: {
    provider: "volcengine",
    label: "火山引擎",
    kind: "api",
    official: true,
    description: "火山方舟。经计费服务 QueryBalanceAcct 查询账户可用余额",
    configSchema: [
      {
        key: "accessKeyId",
        label: "AccessKey ID",
        type: "string",
        required: true,
        help: "火山引擎主账号或 IAM 用户的 AccessKey ID",
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

    const now = new Date();
    const body = "{}";
    const headers: Record<string, string> = {
      "content-type": "application/json; charset=utf-8",
    };

    const { headers: signedHeaders } = signSigV4({
      method: "POST",
      uri: "/",
      query: { Action: "QueryBalanceAcct", Version: "2022-01-01" },
      host: HOST,
      headers,
      payload: body,
      ak,
      sk,
      dateYYYYMMDD: formatSigV4Date(now),
      dateTimeISO: formatSigV4DateTime(now),
      region: "cn-north-1",
      service: "billing",
      requestType: "request",
      algorithm: "HMAC-SHA256",
      dateHeader: "x-date",
      contentSha256Header: "x-content-sha256",
      // 火山引擎签名不包含 host 与 content-type（官方 SDK 行为）
      unsignable: ["host", "content-type"],
    });

    const url = `https://${HOST}/?Action=QueryBalanceAcct&Version=2022-01-01`;
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: signedHeaders,
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`火山引擎 ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as VolcResponse;
    if (json.ResponseMetadata?.Error) {
      const e = json.ResponseMetadata.Error;
      throw new Error(`火山引擎 ${e.Code ?? "错误"}: ${e.Message ?? ""}`);
    }
    const balance = json.Result?.AvailableBalance;
    return {
      remaining: balance != null ? Number(balance) : undefined,
      currency: "CNY",
      fetchedAt: new Date().toISOString(),
      raw: json,
    };
  },
};
