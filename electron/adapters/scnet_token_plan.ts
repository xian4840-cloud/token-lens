import type { Adapter, BalanceResult } from "../types";
import { fetchWithTimeout } from "../lib/http";

const USAGE_URL =
  "https://www.scnet.cn/acx/charge/account/currentuser/tokenplan/list";

/** 控制台 origin：接口 Referer/Origin 来源校验 */
const CONSOLE_ORIGIN = "https://www.scnet.cn";
/**
 * 伪装为正常 Chrome UA（与登录窗口 scnet-login.ts 一致）。
 * 控制台接口带来源校验，刷新用量时同样伪装，避免 Node/undici 默认 UA 被拒。
 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** 控制台前端版本号（接口请求头携带，与浏览器一致；SCNet 控制台更新后需同步此值） */
const CONSOLE_VERSION = "2.3.1";

/** 响应未带 unit 时的兜底计量单位 */
const DEFAULT_UNIT = "Credits";

/**
 * tokenplan/list 返回的单个套餐条目。
 *
 * 字段名取自购买后的真实响应，data[0] 实际键为：
 *   resourceAccountId, resourceId, name, status, totalDays,
 *   usedAmount, totalAmount, unit, minValidTime, maxExpireTime, currentTime
 *
 * 注意：**响应中没有 remaining 字段**，余量须由 totalAmount - usedAmount 推算。
 * 早期版本猜的 totalCredits / limit / quota / monthlyLimit / request[].limit
 * 均不存在，已删除。
 */
interface ScnetSubscription {
  /** 套餐名，如「标准版」 */
  name?: string;
  status?: string | number;
  /** 套餐总天数 */
  totalDays?: number;
  /** 已用量（与 totalAmount 同单位） */
  usedAmount?: number | string;
  /** 总量（与 usedAmount 同单位） */
  totalAmount?: number | string;
  /** 计量单位 */
  unit?: string;
  /** 生效时间 */
  minValidTime?: number | string;
  /** 到期时间 */
  maxExpireTime?: number | string;
  /** 服务端当前时间 */
  currentTime?: number | string;
  [key: string]: unknown;
}

interface ScnetResponse {
  code?: string;
  msg?: string;
  data?: ScnetSubscription[];
}

/** 按候选字段名取数值（兼容 number 与数字字符串） */
function pickNumber(
  obj: { [key: string]: unknown },
  keys: string[],
): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return undefined;
}

/** 按候选字段名取时间，返回 ISO 字符串（兼容毫秒/秒级时间戳与日期字符串） */
function pickTime(
  obj: { [key: string]: unknown },
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && v > 0) {
      const ms = v > 1e12 ? v : v * 1000;
      return new Date(ms).toISOString();
    }
    if (typeof v === "string" && v.trim() !== "" && /\d/.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return undefined;
}

/**
 * 超算互联网（SCNet）Token Plan 适配器（非官方）。
 * Token Plan 是 SCNet 大模型包月订阅，Credits 统一计量，用量通过控制台
 * /acx/charge/account/currentuser/tokenplan/list（cookie 鉴权）查询。
 *
 * 字段映射已按购买后的真实响应校准（见 ScnetSubscription 注释）：
 * totalAmount / usedAmount / unit / maxExpireTime，remaining 由前两者相减推算。
 * 未购买时接口返回 data:[]，此时抛「未订阅」提示。
 */
export const scnetTokenPlanAdapter: Adapter = {
  definition: {
    provider: "scnet_token_plan",
    label: "超算互联网 Token Plan",
    kind: "plan",
    official: false,
    description:
      "超算互联网 Token Plan 套餐 Credits 用量（控制台 cookie，非官方，过期需更新）",
    configSchema: [
      {
        key: "cookie",
        label: "控制台 Cookie",
        type: "password",
        required: true,
        help: "点「登录获取凭证」自动填入；或 F12 复制 tokenplan/list 请求的 Cookie；过期需更新",
      },
    ],
  },

  async fetchBalance(_config, secrets): Promise<BalanceResult> {
    const cookie = secrets.cookie;
    if (!cookie) throw new Error("缺少 Cookie");

    const res = await fetchWithTimeout(USAGE_URL, {
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent": BROWSER_UA,
        referer: `${CONSOLE_ORIGIN}/ui/console/index.html`,
        origin: CONSOLE_ORIGIN,
        cookie,
        version: CONSOLE_VERSION,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      const hint =
        res.status === 401
          ? "（Cookie 可能已过期，请在「管理」页重新「登录获取凭证」）"
          : "";
      throw new Error(
        `超算互联网 Token Plan ${res.status}: ${text.slice(0, 300)}${hint}`,
      );
    }

    const json = (await res.json()) as ScnetResponse;

    if (json.code != null && String(json.code) !== "0") {
      throw new Error(`超算互联网 Token Plan ${json.code}: ${json.msg ?? ""}`);
    }

    const data = json.data ?? [];
    if (data.length === 0) {
      throw new Error(
        "未订阅 Token Plan 套餐（请先在超算互联网控制台购买 Token Plan）",
      );
    }

    // data 为数组（可同时持有多个套餐），逐条解析后汇总
    const plans = data.map((sub, i) => {
      const total = pickNumber(sub, ["totalAmount"]);
      const used = pickNumber(sub, ["usedAmount"]);
      // 字段缺失则带上实际键名抛出，便于接口变更后定位
      if (total == null || used == null) {
        throw new Error(
          `超算互联网 Token Plan：data[${i}] 缺少 totalAmount/usedAmount` +
            `（total=${total ?? "?"} used=${used ?? "?"}）。实际字段: ${Object.keys(sub).join(", ")}`,
        );
      }
      return {
        label: sub.name?.trim() || "Token Plan",
        total,
        used,
        // 响应无 remaining 字段，由总量减已用推算
        remaining: Math.max(0, total - used),
        unit: sub.unit?.trim() || DEFAULT_UNIT,
        expiresAt: pickTime(sub, ["maxExpireTime"]),
      };
    });

    // 单位不一致时无法相加，宁可报错也不给出错误数字
    const units = new Set(plans.map((p) => p.unit));
    if (units.size > 1) {
      throw new Error(
        `超算互联网 Token Plan：多个套餐计量单位不一致（${[...units].join(", ")}），无法汇总，请反馈`,
      );
    }

    const total = plans.reduce((s, p) => s + p.total, 0);
    const used = plans.reduce((s, p) => s + p.used, 0);
    const remaining = plans.reduce((s, p) => s + p.remaining, 0);
    // 多套餐取最早到期时间（ISO 字符串可直接字典序比较）
    const expiresAt = plans
      .map((p) => p.expiresAt)
      .filter((t): t is string => t != null)
      .sort()[0];

    return {
      remaining,
      total,
      used,
      currency: plans[0].unit,
      expiresAt,
      fetchedAt: new Date().toISOString(),
      raw: json,
      breakdown: plans.map((p) => ({
        label: p.label,
        used: p.used,
        total: p.total,
        remaining: p.remaining,
        unit: p.unit,
        resetAt: p.expiresAt,
      })),
    };
  },
};

/**
 * 验证候选凭证有效性：用 cookie 实调 tokenplan/list，HTTP 200 且业务
 * code 为 0（或无 code 字段）视为有效。
 *
 * 注意：未订阅时接口返回 data:[] 但 code 仍为 0，cookie 仍有效，故只判
 * code 不判 data 是否非空。供登录窗口判断残留 cookie 是否已过期，避免
 * 过期 cookie 透过 isValid 格式校验（含 Token=）被秒返回。验证逻辑与
 * fetchBalance 同源，复用同一接口与伪装头。
 */
export async function validateScnetCredentials(
  cookie: string,
): Promise<boolean> {
  if (!cookie) return false;
  try {
    const res = await fetchWithTimeout(USAGE_URL, {
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent": BROWSER_UA,
        referer: `${CONSOLE_ORIGIN}/ui/console/index.html`,
        origin: CONSOLE_ORIGIN,
        cookie,
        version: CONSOLE_VERSION,
      },
    });
    if (!res.ok) return false;
    const json = (await res.json()) as ScnetResponse;
    return json.code == null || String(json.code) === "0";
  } catch {
    // 网络/解析异常一律视为无效，让登录窗口继续等待新凭证
    return false;
  }
}
