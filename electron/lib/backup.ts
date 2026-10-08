/**
 * 本机备份：用量历史 + 服务清单 + 非敏感设置。
 * 故意不含密钥、代理 URL、窗口坐标——备份文件常被丢到网盘/聊天里。
 */

import { ALL_LOCAL_SOURCES, type LocalSource, type LocalUsageRow } from "../local-usage/types";

/** 备份恢复的服务在补全密钥前刷新时给出的提示（≤40 字，卡片上原样显示） */
export const NEEDS_CREDENTIALS_MESSAGE = "从备份恢复的服务，请到管理页重新填写密钥";

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
  services: number;
  exportedAt: string;
} {
  return {
    local: toLocalUsageRows(payload.localDailyUsage).length,
    usage: payload.usageRecords.length,
    services: payload.services.length,
    exportedAt: payload.exportedAt,
  };
}

/**
 * 导入时合并置顶 / 隐藏列表：本机原有的保留，备份里的经 idMap 换成本机 id，
 * 只留本机确实存在的服务，去重保序。用并集而非覆盖，重复导入不会冲掉本机的设置。
 */
export function mergeImportedIdList(
  local: string[],
  fromBackup: string[],
  idMap: Map<string, string>,
  existingIds: Set<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined) => {
    if (!id || seen.has(id) || !existingIds.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const id of local) push(id);
  for (const id of fromBackup) push(idMap.get(id) ?? id);
  return out;
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

/** 字段缺省时当空数组（旧备份 / 手工裁剪过的文件）；存在但不是数组则报错。 */
function optionalArray(
  obj: Record<string, unknown>,
  key: string,
): { ok: true; value: unknown[]; present: boolean } | { ok: false; error: string } {
  const v = obj[key];
  if (v === undefined || v === null) return { ok: true, value: [], present: false };
  if (!Array.isArray(v)) return { ok: false, error: `备份格式无效：${key} 不是数组` };
  return { ok: true, value: v, present: true };
}

function normalizeService(s: unknown): BackupService | null {
  if (!s || typeof s !== "object") return null;
  const r = s as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.name !== "string" || typeof r.provider !== "string" || !r.provider) {
    return null;
  }
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    kind: typeof r.kind === "string" ? r.kind : "",
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
  };
}

/**
 * 解析备份。含 secrets / 代理 URL 的文件直接拒绝。
 * 导入只信我们自己导出的形状，别的 JSON 不瞎吞。
 *
 * 兼容：services / usageRecords / localDailyUsage 任一缺省都按空处理
 * （0.1.15 之前的手工备份、或用户自己删过字段的文件），但三者至少要有一个，
 * 否则多半不是备份文件。字段存在却不是数组、服务条目缺字段这类残缺内容：
 * 前者整份拒绝并说明哪个字段不对，后者逐条丢弃，不让一条坏数据拖垮整份导入。
 */
export function parseBackupJson(raw: string): ParsedBackup {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ok: false, error: "不是合法 JSON" };
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return { ok: false, error: "备份格式无效" };
  }
  const obj = v as Record<string, unknown>;
  if ("secrets" in obj) return { ok: false, error: "备份含密钥字段，已拒绝导入" };
  if (obj.app !== "token-lens") return { ok: false, error: "不是 Token Lens 备份" };
  if (obj.version !== 1) {
    return { ok: false, error: `不支持的备份版本（${String(obj.version)}）` };
  }
  const usage = optionalArray(obj, "usageRecords");
  if (!usage.ok) return usage;
  const local = optionalArray(obj, "localDailyUsage");
  if (!local.ok) return local;
  const svc = optionalArray(obj, "services");
  if (!svc.ok) return svc;
  if (!usage.present && !local.present && !svc.present) {
    return { ok: false, error: "缺少用量数据" };
  }
  const settings =
    obj.settings && typeof obj.settings === "object" && !Array.isArray(obj.settings)
      ? (obj.settings as Record<string, unknown>)
      : {};
  if (typeof settings.proxyCustomUrl === "string" && settings.proxyCustomUrl) {
    return { ok: false, error: "备份含代理地址，已拒绝导入" };
  }
  const services = svc.value
    .map(normalizeService)
    .filter((s): s is BackupService => s !== null);
  return {
    ok: true,
    payload: {
      app: "token-lens",
      version: 1,
      exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : "",
      services,
      usageRecords: usage.value,
      localDailyUsage: local.value,
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
