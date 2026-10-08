export interface BackupPreview {
  local: number;
  usage: number;
  exportedAt: string;
}

export function formatBackupPreviewText(p: BackupPreview): string {
  const day = p.exportedAt.slice(0, 10);
  const when = /^\d{4}-\d{2}-\d{2}$/.test(day) ? `（导出于 ${day}）` : "";
  return `将合并导入本地日桶 ${p.local} 条、API 用量 ${p.usage} 条${when}。不含密钥和代理。确定导入？`;
}