import type { Adapter, BalanceResult, BreakdownItem } from "../types";
import { fetchWithTimeout } from "../lib/http";
import {
  API_KEY_FIELD,
  REGION_FIELD,
  fetchZhipuJson,
  pickNumber,
  resolveZhipuBase,
  resolveZhipuRegion,
  type ZhipuEnvelope,
} from "./zhipu-common";

interface CashParts {
  available?: number;
  cash?: number;
  voucher?: number;
}

const CASH_AVAILABLE_KEYS = [
  "availableBalance",
  "available_balance",
  "availableAmount",
  "available_amount",
  "totalBalance",
  "total_balance",
  "totalAmount",
  "total_amount",
  "accountBalance",
  "account_balance",
  "balance",
];
const CASH_KEYS = [
  "cashBalance",
  "cash_balance",
  "cashAmount",
  "cash_amount",
  "rechargeBalance",
  "recharge_balance",
  "rechargeAmount",
  "recharge_amount",
  "chargeBalance",
  "charge_balance",
  "toppedUpBalance",
  "topped_up_balance",
];
const VOUCHER_KEYS = [
  "voucherBalance",
  "voucher_balance",
  "giftBalance",
  "gift_balance",
  "giftAmount",
  "gift_amount",
  "grantedBalance",
  "granted_balance",
  "bonusBalance",
  "bonus_balance",
  "bonusAmount",
  "bonus_amount",
];
const NESTED_CASH_KEYS = ["account", "wallet", "finance", "asset", "accountInfo"];

const PACKAGE_BALANCE_KEYS = [
  "availableBalance",
  "available_balance",
  "tokenBalance",
  "token_balance",
  "remainAmount",
  "remain_amount",
  "balance",
  "tokensMagnitude",
];

/**
 * 从 getCustomerBalance 的 data 里拆出现金 / 赠金 / 可用总额。
 * 字段名以社区抓包与同类国内站为准，多组别名兜底。
 */
export function parseCustomerBalance(data: unknown): CashParts {
  if (data == null) return {};
  if (typeof data === "number" && Number.isFinite(data)) {
    return { available: data };
  }
  if (typeof data === "string" && data.trim() !== "") {
    const n = Number(data.replace(/,/g, "").trim());
    return Number.isFinite(n) ? { available: n } : {};
  }
  if (typeof data !== "object") return {};
  const root = data as Record<string, unknown>;
  const sources: Record<string, unknown>[] = [root];
  // balance 若是对象再往里找；若是数字则留给 pickNumber 当 available
  if (root.balance && typeof root.balance === "object" && !Array.isArray(root.balance)) {
    sources.push(root.balance as Record<string, unknown>);
  }
  for (const k of NESTED_CASH_KEYS) {
    const v = root[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      sources.push(v as Record<string, unknown>);
    }
  }
  let available: number | undefined;
  let cash: number | undefined;
  let voucher: number | undefined;
  for (const src of sources) {
    available ??= pickNumber(src, CASH_AVAILABLE_KEYS);
    cash ??= pickNumber(src, CASH_KEYS);
    voucher ??= pickNumber(src, VOUCHER_KEYS);
  }
  if (available == null && cash == null && voucher == null) return {};
  if (available == null && (cash != null || voucher != null)) {
    return {
      cash,
      voucher,
      available: (cash ?? 0) + (voucher ?? 0),
    };
  }
  return { available, cash, voucher };
}

/**
 * 财务总览 query-customer-account-report。
 * availableBalance / balance 才是还能花的钱。
 * rechargeAmount / giveAmount 是累计充值/赠金，不是剩余，不能拿来当余额。
 */
export function parseAccountReport(data: unknown): CashParts {
  const obj = asRecord(data);
  if (!obj) return parseCustomerBalance(data);
  const available = pickNumber(obj, ["availableBalance", "balance"]);
  if (available == null) return parseCustomerBalance(data);
  return { available };
}

export interface PackageRow {
  label: string;
  remaining: number;
  unit: string;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function extractRows(envelope: ZhipuEnvelope): Record<string, unknown>[] {
  const candidates: unknown[] = [envelope.rows];
  const data = envelope.data;
  if (Array.isArray(data)) candidates.push(data);
  const dataObj = asRecord(data);
  if (dataObj) {
    candidates.push(dataObj.rows, dataObj.list, dataObj.records, dataObj.items);
  }
  for (const c of candidates) {
    if (Array.isArray(c)) {
      return c.filter((row): row is Record<string, unknown> => asRecord(row) != null);
    }
  }
  return [];
}

function packageLabel(row: Record<string, unknown>): string {
  for (const k of [
    "resourcePackageName",
    "suitableModel",
    "suitableScene",
    "name",
    "tokenNo",
    "bundleNo",
    "bundleCode",
  ]) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "资源包";
}

/**
 * 资源包单位：体验包的 tokenBalance 是 token 数或次数，不是人民币。
 * 把 500 万 GLM-4.7 体验包加进 ¥ 会得到卡片上那种 ¥23000120。
 */
export function classifyPackageUnit(label: string, remaining: number, declared?: string): string {
  const unit = (declared ?? "").trim();
  if (unit) {
    if (/次|count|times/i.test(unit)) return "次";
    if (/token/i.test(unit)) return "tokens";
    if (/usd|dollar/i.test(unit)) return "USD";
    if (/元|cny|rmb|￥|¥/i.test(unit)) return "CNY";
  }
  if (/次/.test(label) && !/万|token/i.test(label)) return "次";
  if (/万/.test(label)) return "tokens";
  if (/(体验包|资源包|token)/i.test(label) && remaining >= 1_000) return "tokens";
  if (/通用|现金|赠金|余额/.test(label)) return "CNY";
  if (/bundle_502|bundle_793/i.test(label)) return "CNY";
  if (Number.isInteger(remaining) && remaining >= 10_000) return "tokens";
  return "CNY";
}

function declaredUnit(row: Record<string, unknown>): string | undefined {
  const consume = row.consumeType;
  if (typeof consume === "string") {
    if (consume.toUpperCase() === "TIMES") return "次";
    if (consume.toUpperCase() === "TOKENS") return "tokens";
    if (consume.toUpperCase() === "AMOUNT" || consume.toUpperCase() === "CASH") {
      return "CNY";
    }
  }
  for (const k of ["unit", "unitName", "unit_name", "currency", "balanceUnit"]) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

/** 从 tokenAccounts/list/my 提取各资源包剩余额度，并标上单位 */
export function parseTokenAccounts(envelope: ZhipuEnvelope): PackageRow[] {
  const out: PackageRow[] = [];
  for (const row of extractRows(envelope)) {
    const status = typeof row.status === "string" ? row.status.toUpperCase() : "";
    if (status && status !== "EFFECTIVE" && status !== "ACTIVE") continue;
    const remaining = pickNumber(row, PACKAGE_BALANCE_KEYS);
    if (remaining == null) continue;
    const label = packageLabel(row);
    out.push({
      label,
      remaining,
      unit: classifyPackageUnit(label, remaining, declaredUnit(row)),
    });
  }
  return out;
}

function mergeSameLabel(rows: PackageRow[]): PackageRow[] {
  const map = new Map<string, PackageRow>();
  for (const row of rows) {
    const prev = map.get(row.label);
    if (prev) {
      prev.remaining += row.remaining;
    } else {
      map.set(row.label, { ...row });
    }
  }
  return Array.from(map.values());
}

/**
 * 卡片主数字只取现金/赠金（人民币）。
 * 取不到钱包时，才退回 tokenAccounts 里「通用」这类 CNY 包；
 * 体验包 / 次数包绝不能加进来。
 */
export function pickZhipuWallet(
  cashAvailable: number | undefined,
  cnyPackSum: number,
  hasCnyPacks: boolean,
): number | undefined {
  if (cashAvailable != null) return cashAvailable;
  if (hasCnyPacks) return cnyPackSum;
  return undefined;
}

/**
 * 智谱 GLM 按量 API 适配器。
 *
 * 官方公开文档没有余额接口。控制台财务总览走的是：
 * - GET /api/biz/account/query-customer-account-report  现金/赠金可用余额
 * - GET /api/biz/tokenAccounts/list/my                  资源包（consumeType=TOKENS/TIMES）
 *
 * 旧路径 /customer/getCustomerBalance 已不存在（HTTP 200 + code 404）。
 */
export const zhipuAdapter: Adapter = {
  definition: {
    provider: "zhipu",
    label: "智谱 GLM",
    kind: "api",
    official: true,
    description: "智谱开放平台按量账户。卡片主数字是现金/赠金余额，体验包与次数包在明细里单独列出",
    configSchema: [API_KEY_FIELD, REGION_FIELD],
  },

  async fetchBalance(config, secrets): Promise<BalanceResult> {
    const apiKey = secrets.apiKey;
    if (!apiKey) throw new Error("缺少 API Key");
    const base = resolveZhipuBase(config);
    const currency = resolveZhipuRegion(config) === "global" ? "USD" : "CNY";
    const fetchedAt = new Date().toISOString();

    const [cashResult, packResult] = await Promise.allSettled([
      fetchZhipuJson(`${base}/api/biz/account/query-customer-account-report`, apiKey),
      fetchZhipuJson(`${base}/api/biz/tokenAccounts/list/my`, apiKey),
    ]);

    const cash =
      cashResult.status === "fulfilled"
        ? parseAccountReport(cashResult.value.data ?? cashResult.value)
        : undefined;
    const packs =
      packResult.status === "fulfilled" ? mergeSameLabel(parseTokenAccounts(packResult.value)) : [];

    if (cashResult.status === "rejected" && packResult.status === "rejected") {
      return fallbackValidateKey(base, apiKey, currency, fetchedAt, cashResult.reason);
    }

    // 只汇总与本区域记账币种一致的钱包类资源包。
    // 此前是 `unit === "CNY" || unit === "USD"` 一起加，等于把两种货币求和后
    // 当作单一币种显示——而 currency 是按区域定的（国内 CNY / 国际 USD），
    // 混进来的另一种货币既没换算也没标注。宁可少一个数字，也不能给错数字。
    const walletPacks = packs.filter((p) => p.unit === currency);
    const otherPacks = packs.filter((p) => p.unit !== currency && p.remaining > 0);
    const walletPackSum = walletPacks.reduce((s, p) => s + p.remaining, 0);
    const remaining = pickZhipuWallet(cash?.available, walletPackSum, walletPacks.length > 0);

    const parts: BreakdownItem[] = [];
    for (const p of walletPacks) {
      if (p.label === "通用" || p.label === "资源包") continue;
      parts.push({ label: p.label, remaining: p.remaining, unit: p.unit });
    }
    for (const p of otherPacks) {
      parts.push({ label: p.label, remaining: p.remaining, unit: p.unit });
    }

    const breakdown: BreakdownItem[] | undefined =
      remaining != null && parts.length > 0
        ? [{ label: "账户余额", remaining, unit: currency }, ...parts]
        : parts.length > 0
          ? parts
          : undefined;

    const raw = {
      cash: cashResult.status === "fulfilled" ? cashResult.value : undefined,
      packages: packResult.status === "fulfilled" ? packResult.value : undefined,
    };

    return {
      remaining,
      total: remaining,
      currency,
      fetchedAt,
      raw,
      breakdown,
    };
  },
};

async function fallbackValidateKey(
  base: string,
  apiKey: string,
  currency: string,
  fetchedAt: string,
  cause: unknown,
): Promise<BalanceResult> {
  const reason =
    cause instanceof Error ? cause.message.replace(/^智谱\s+\d+:\s*/, "") : "余额接口失败";
  const res = await fetchWithTimeout(`${base}/api/paas/v4/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`智谱 GLM ${res.status}: ${text.slice(0, 200) || reason}`);
  }
  return {
    currency,
    statusLabel: `Key 有效（${reason}）`,
    fetchedAt,
  };
}
