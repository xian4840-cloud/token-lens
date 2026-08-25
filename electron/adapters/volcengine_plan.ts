import type { Adapter, BalanceResult } from "../types";
import { fetchWithTimeout } from "../lib/http";

const USAGE_URL =
  "https://console.volcengine.com/api/top/ark/cn-beijing/2024-01-01/GetCodingPlanUsage";

/** 控制台 origin：控制台 API 的 Referer/Origin 来源校验需要 */
const CONSOLE_ORIGIN = "https://console.volcengine.com";
/**
 * 伪装为正常 Chrome UA（与登录窗口 volcengine-login.ts 一致）。
 * 火山方舟风控会识别非浏览器 UA（Node/undici 默认 UA）并拒绝请求，
 * 刷新用量时必须同样伪装，否则即便 Cookie 有效也可能返回 401/403。
 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** 配额级别中文标签 */
const LEVEL_LABEL: Record<string, string> = {
  session: "单次",
  weekly: "周度",
  monthly: "月度",
};

interface QuotaItem {
  Level: string;
  Percent: number;
  ResetTimestamp: number;
  Cap: number;
  RewardTotalPercent?: number;
}

interface UsageResponse {
  ResponseMetadata?: {
    Error?: { Code?: string; Message?: string };
  };
  Result?: {
    Status?: string;
    QuotaUsage?: QuotaItem[];
  };
}

/** 从 cookie 字符串提取指定字段值 */
function extractCookieValue(cookie: string, name: string): string | undefined {
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1];
}

/** 尝试从错误响应体解析火山引擎标准错误（ResponseMetadata.Error） */
function parseApiError(
  text: string,
): { Code?: string; Message?: string } | undefined {
  try {
    const json = JSON.parse(text) as UsageResponse;
    return json.ResponseMetadata?.Error;
  } catch {
    return undefined;
  }
}

/**
 * 火山方舟套餐适配器（非官方）。
 * coding plan 用量通过控制台 GetCodingPlanUsage（cookie + CSRF）查询。
 * 需提供控制台 Cookie（含 csrfToken）与 x-web-id（请求 header 值），
 * csrfToken 会自动从 cookie 提取并放入 x-csrf-token header。
 */
export const volcenginePlanAdapter: Adapter = {
  definition: {
    provider: "volcengine_plan",
    label: "火山方舟套餐",
    kind: "plan",
    official: false,
    description: "火山方舟 coding plan 用量（控制台 cookie，非官方，过期需更新）",
    configSchema: [
      {
        key: "cookie",
        label: "控制台 Cookie",
        type: "password",
        required: true,
        help: "点「登录获取凭证」自动填入；或 F12 复制 GetCodingPlanUsage 请求的 Cookie（含 csrfToken）；过期需更新",
      },
      {
        key: "xWebId",
        label: "x-web-id",
        type: "string",
        required: true,
        help: "点「登录获取凭证」自动填入；或 F12 复制 GetCodingPlanUsage 请求的 x-web-id header 值",
      },
    ],
  },

  async fetchBalance(config, secrets): Promise<BalanceResult> {
    const cookie = secrets.cookie;
    const xWebId = config.xWebId as string;
    if (!cookie) throw new Error("缺少 Cookie");
    if (!xWebId) throw new Error("缺少 x-web-id");

    const csrfToken = extractCookieValue(cookie, "csrfToken");
    if (!csrfToken) throw new Error("Cookie 中未找到 csrfToken 字段");

    const res = await fetchWithTimeout(USAGE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/plain, */*",
        // 伪装浏览器 UA + 补 Referer/Origin，过火山方舟风控与控制台来源校验
        "user-agent": BROWSER_UA,
        referer: `${CONSOLE_ORIGIN}/ark`,
        origin: CONSOLE_ORIGIN,
        cookie,
        "x-csrf-token": csrfToken,
        "x-web-id": xWebId,
      },
      body: "{}",
    });
    if (!res.ok) {
      const text = await res.text();
      const apiErr = parseApiError(text);
      if (apiErr) {
        // 401 多为 Cookie/csrf 过期，给出可操作提示；其余状态直接展示 Code/Message
        const hint =
          res.status === 401
            ? "（Cookie 可能已过期，请在「管理」页重新「登录获取凭证」）"
            : "";
        throw new Error(
          `火山方舟套餐 ${res.status} ${apiErr.Code ?? ""}: ${apiErr.Message ?? ""}${hint}`.replace(
            /\s+/g,
            " ",
          ),
        );
      }
      throw new Error(`火山方舟套餐 ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as UsageResponse;

    if (json.ResponseMetadata?.Error) {
      const e = json.ResponseMetadata.Error;
      throw new Error(`火山方舟套餐 ${e.Code ?? "错误"}: ${e.Message ?? ""}`);
    }

    const quotas = json.Result?.QuotaUsage ?? [];
    // 优先 monthly，其次 weekly，最后 session
    const quota =
      quotas.find((q) => q.Level === "monthly") ??
      quotas.find((q) => q.Level === "weekly") ??
      quotas.find((q) => q.Level === "session") ??
      quotas[0];

    if (!quota) {
      throw new Error("未找到用量数据");
    }

    const cap = quota.Cap ?? 100;
    const used = quota.Percent;
    const remaining = Math.max(0, cap - used);

    return {
      remaining,
      total: cap,
      used,
      currency: "%",
      expiresAt: quota.ResetTimestamp
        ? new Date(quota.ResetTimestamp * 1000).toISOString()
        : undefined,
      fetchedAt: new Date().toISOString(),
      raw: json,
      breakdown: quotas.map((q) => ({
        label: LEVEL_LABEL[q.Level] ?? q.Level,
        used: q.Percent,
        total: q.Cap,
        remaining: Math.max(0, (q.Cap ?? 100) - q.Percent),
        unit: "%",
        resetAt: q.ResetTimestamp
          ? new Date(q.ResetTimestamp * 1000).toISOString()
          : undefined,
      })),
    };
  },
};

/**
 * 验证候选凭证有效性：用 cookie + x-web-id 实调 GetCodingPlanUsage，
 * HTTP 200 且无 ResponseMetadata.Error 视为有效。
 *
 * 供登录窗口判断 partition 残留的 cookie 是否已过期--避免过期 cookie 透过
 * isValid 格式校验（含 csrfToken）被秒返回，导致用户无法重新登录更新凭证。
 * 验证逻辑与 fetchBalance 同源，复用同一接口与伪装头。
 */
export async function validateVolcenginePlanCredentials(
  cookie: string,
  xWebId: string,
): Promise<boolean> {
  if (!cookie || !xWebId) return false;
  const csrfToken = extractCookieValue(cookie, "csrfToken");
  if (!csrfToken) return false;
  try {
    const res = await fetchWithTimeout(USAGE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/plain, */*",
        "user-agent": BROWSER_UA,
        referer: `${CONSOLE_ORIGIN}/ark`,
        origin: CONSOLE_ORIGIN,
        cookie,
        "x-csrf-token": csrfToken,
        "x-web-id": xWebId,
      },
      body: "{}",
    });
    if (!res.ok) return false;
    const json = (await res.json()) as UsageResponse;
    return !json.ResponseMetadata?.Error;
  } catch {
    // 网络/解析异常一律视为无效，让登录窗口继续等待新凭证
    return false;
  }
}
