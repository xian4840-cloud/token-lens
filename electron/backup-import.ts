import {
  getSetting,
  importBackupServices,
  importUsageRecords,
  listServices,
  setSetting,
  upsertLocalDailyUsage,
} from "./db";
import {
  mergeImportedIdList,
  toLocalUsageRows,
  type BackupPayload,
} from "./lib/backup";
import { parseIdList } from "./lib/id-list";
import type { ServiceKind } from "./types";

export interface BackupImportResult {
  /** 写入（或覆盖）的本地日桶数 */
  local: number;
  /** 新写入的 API 用量记录数 */
  usage: number;
  /** 因重复或找不到对应服务而跳过的用量记录数 */
  usageSkipped: number;
  /** 新建、需重新填写密钥的服务数 */
  services: number;
  /** 对上本机已有服务的数 */
  servicesMatched: number;
  /** 类型不支持或条目残缺、未恢复的服务数 */
  servicesSkipped: number;
}

/**
 * 把解析好的备份合并进本机数据。
 *
 * 顺序有讲究：先恢复服务清单拿到「备份 id -> 本机 id」，再据此映射用量记录与
 * 置顶/隐藏列表。整个过程幂等：同一份备份导入两次，第二次不会新增任何东西。
 *
 * 从 ipc 抽出来是为了能在测试里直接跑（ipc 依赖 Electron，测试里起不来），
 * resolveKind 由调用方注入适配器注册表的查询，测试里给桩。
 */
export function applyBackupImport(
  payload: BackupPayload,
  resolveKind: (provider: string) => ServiceKind | undefined,
): BackupImportResult {
  const svc = importBackupServices(payload.services, resolveKind);
  const localRows = toLocalUsageRows(payload.localDailyUsage);
  upsertLocalDailyUsage(localRows);
  const usage = importUsageRecords(payload.usageRecords, svc.idMap);

  const s = payload.settings;
  if (s.monthlyBudgetUsd) setSetting("monthlyBudgetUsd", s.monthlyBudgetUsd);
  if (s.pricingOverrides) setSetting("pricingOverrides", s.pricingOverrides);
  const existingIds = new Set(listServices().map((x) => x.id));
  for (const key of ["pinnedServiceIds", "hiddenServiceIds"] as const) {
    const fromBackup = s[key];
    if (!fromBackup) continue;
    setSetting(
      key,
      JSON.stringify(
        mergeImportedIdList(
          parseIdList(getSetting(key)),
          parseIdList(fromBackup),
          svc.idMap,
          existingIds,
        ),
      ),
    );
  }

  return {
    local: localRows.length,
    usage: usage.imported,
    usageSkipped: usage.skipped,
    services: svc.restored,
    servicesMatched: svc.matched,
    servicesSkipped: svc.skipped,
  };
}
