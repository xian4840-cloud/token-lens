import type { BackupImportResult, BackupPreview } from "@shared/types";

/** 预览 / 导入结果的定义在 shared/types/app.ts（与主进程共用） */
export type { BackupImportResult, BackupPreview };

export function formatBackupPreviewText(p: BackupPreview): string {
  const day = p.exportedAt.slice(0, 10);
  const when = /^\d{4}-\d{2}-\d{2}$/.test(day) ? `（导出于 ${day}）` : "";
  const services = p.services ? `、服务 ${p.services} 个` : "";
  return `将合并导入本地日桶 ${p.local} 条、API 用量 ${p.usage} 条${services}${when}。不含密钥和代理。确定导入？`;
}

/** 导入完成后的提示。新恢复的服务要明确告诉用户去补密钥。 */
export function formatBackupImportResult(r: BackupImportResult): string {
  const parts = [`已导入本地 ${r.local} 条、API 用量 ${r.usage} 条`];
  if (r.usageSkipped) parts.push(`跳过重复或无对应服务的用量 ${r.usageSkipped} 条`);
  if (r.services) parts.push(`恢复服务 ${r.services} 个，请到管理页重新填写密钥`);
  if (r.servicesSkipped) parts.push(`${r.servicesSkipped} 个服务类型不支持，未恢复`);
  return parts.join("；");
}
