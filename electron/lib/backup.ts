/**
 * 本机备份：用量历史 + 服务清单 + 非敏感设置。
 * 故意不含密钥、代理 URL、窗口坐标——备份文件常被丢到网盘/聊天里。
 */

import { ALL_LOCAL_SOURCES, type LocalSource, type LocalUsageRow } from "../local-usage/types";

export interface BackupService {
  id: string;
  name: string;
  provider: string;
  kind: string;
  createdAt: string;
}

export interface BackupPayload {
  app: "token-lens";
  version: 1;
  exportedAt: string;
  services: BackupService[];
  usageRecords: unknown[];
  localDailyUsage: unknown[];
  settings: {
    refreshInterval: string;
    requestTimeout: string;
    monthlyBudgetUsd: string;
    pricingOverrides: string;
    petEnabled: string;
    pinnedServiceIds: string;
    hiddenServiceIds?: string;
  };
}

export function buildBackupPayload(input: {
  services: Array<{
    id: string;
    name: string;
    provider: string;
    kind: string;
    createdAt: string;
    config?: unknown;
  }>;
  usageRecords: unknown[];
  localDailyUsage: unknown[];
  settings: Record<string, string | undefined>;
  exportedAt: string;
}): BackupPayload {
  return {
    app: "token-lens",
    version: 1,
    exportedAt: input.exportedAt,
    services: input.services.map((s) => ({
      id: s.id,
      name: s.name,
      provider: s.provider,
      kind: s.kind,
      createdAt: s.createdAt,
    })),
    usageRecords: input.usageRecords,
    localDailyUsage: input.localDailyUsage,
    settings: {
      refreshInterval: input.settings.refreshInterval ?? "5",
      requestTimeout: input.settings.requestTimeout ?? "15",
      monthlyBudgetUsd: input.settings.monthlyBudgetUsd ?? "",
      pricingOverrides: input.settings.pricingOverrides ?? "",
      petEnabled: input.settings.petEnabled ?? "0",
      pinnedServiceIds: input.settings.pinnedServiceIds ?? "[]",
      hiddenServiceIds: input.settings.hiddenServiceIds ?? "[]",
    },
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 备份里的本地桶转成 upsert 用的行。来源不认识的丢掉。 */
export function toLocalUsageRows(raw: unknown[]): LocalUsageRow[] {
  const out: LocalUsageRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.source !== "string") continue;
    if (!(ALL_LOCAL_SOURCES as string[]).includes(r.source)) continue;
    if (typeof r.model !== "string" || typeof r.date !== "string") continue;
    out.push({
      source: r.source as LocalSource,
      model: r.model,
      date: r.date,
      sessions: num(r.sessions),
      inputTokens: num(r.inputTokens),
      outputTokens: num(r.outputTokens),
      cacheCreationTokens: num(r.cacheCreationTokens),
      cacheReadTokens: num(r.cacheReadTokens),
      reasoningTokens: num(r.reasoningTokens),
      cost: typeof r.cost === "number" && Number.isFinite(r.cost) ? r.cost : undefined,
      currency: typeof r.currency === "string" ? r.currency : undefined,
      firstAt: typeof r.firstAt === "string" ? r.firstAt : undefined,
      lastAt: typeof r.lastAt === "string" ? r.lastAt : undefined,
    });
  }
  return out;
}

export function backupPreviewStats(payload: BackupPayload): {
  local: number;
  usage: number;
  exportedAt: string;
} {
  return {
    local: toLocalUsageRows(payload.localDailyUsage).length,
    usage: payload.usageRecords.length,
    exportedAt: payload.exportedAt,
  };
}

export function saveDialogFilters(
  defaultName: string,
): { name: string; extensions: string[] }[] {
  const ext = defaultName.split(".").pop()?.toLowerCase();
  if (ext === "json") return [{ name: "JSON", extensions: ["json"] }];
  if (ext === "csv") return [{ name: "CSV", extensions: ["csv"] }];
  return [{ name: "文本", extensions: ["txt"] }];
}

export type ParsedBackup =
  | { ok: true; payload: BackupPayload }
  | { ok: false; error: string };

/**
 * 解析备份。含 secrets / 代理 URL 的文件直接拒绝。
 * 导入只信我们自己导出的形状，别的 JSON 不瞎吞。
 */
export function parseBackupJson(raw: string): ParsedBackup {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ok: false, error: "不是合法 JSON" };
  }
  if (!v || typeof v !== "object") return { ok: false, error: "备份格式无效" };
  const obj = v as Record<string, unknown>;
  if ("secrets" in obj) return { ok: false, error: "备份含密钥字段，已拒绝导入" };
  if (obj.app !== "token-lens") return { ok: false, error: "不是 Token Lens 备份" };
  if (obj.version !== 1) return { ok: false, error: "不支持的备份版本" };
  if (!Array.isArray(obj.usageRecords) || !Array.isArray(obj.localDailyUsage)) {
    return { ok: false, error: "缺少用量数据" };
  }
  const settings =
    obj.settings && typeof obj.settings === "object"
      ? (obj.settings as Record<string, unknown>)
      : {};
  if (typeof settings.proxyCustomUrl === "string" && settings.proxyCustomUrl) {
    return { ok: false, error: "备份含代理地址，已拒绝导入" };
  }
  const services = Array.isArray(obj.services) ? obj.services : [];
  return {
    ok: true,
    payload: {
      app: "token-lens",
      version: 1,
      exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : "",
      services: services.filter(
        (s): s is BackupService =>
          !!s &&
          typeof s === "object" &&
          typeof (s as BackupService).id === "string" &&
          typeof (s as BackupService).name === "string" &&
          typeof (s as BackupService).provider === "string",
      ) as BackupService[],
      usageRecords: obj.usageRecords,
      localDailyUsage: obj.localDailyUsage,
      settings: {
        refreshInterval:
          typeof settings.refreshInterval === "string"
            ? settings.refreshInterval
            : "5",
        requestTimeout:
          typeof settings.requestTimeout === "string"
            ? settings.requestTimeout
            : "15",
        monthlyBudgetUsd:
          typeof settings.monthlyBudgetUsd === "string"
            ? settings.monthlyBudgetUsd
            : "",
        pricingOverrides:
          typeof settings.pricingOverrides === "string"
            ? settings.pricingOverrides
            : "",
        petEnabled:
          typeof settings.petEnabled === "string" ? settings.petEnabled : "0",
        pinnedServiceIds:
          typeof settings.pinnedServiceIds === "string"
            ? settings.pinnedServiceIds
            : "[]",
        hiddenServiceIds:
          typeof settings.hiddenServiceIds === "string"
            ? settings.hiddenServiceIds
            : "[]",
      },
    },
  };
}
