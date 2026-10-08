export function formatDiagnosticSummary(input: {
  stats?: {
    bytes: number;
    services: number;
    usageRecords: number;
    localDaily: number;
    snapshots: number;
  } | null;
  logPath?: string;
  logs: Array<{ time: string; level: string; scope: string; message: string }>;
  limit?: number;
}): string {
  const limit = input.limit ?? 30;
  const lines: string[] = [];
  if (input.stats) {
    lines.push(
      `数据文件 ${(input.stats.bytes / 1024).toFixed(1)} KB · 服务 ${input.stats.services} · API 用量 ${input.stats.usageRecords} · 本地日桶 ${input.stats.localDaily} · 快照 ${input.stats.snapshots}`,
    );
  }
  if (input.logPath) lines.push(`日志: ${input.logPath}`);
  for (const e of input.logs.slice(0, limit)) {
    lines.push(`${e.time} [${e.level}] [${e.scope}] ${e.message}`);
  }
  return lines.join("\n");
}
