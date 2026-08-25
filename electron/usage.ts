import { getService, getSecrets, saveUsageRecords } from "./db";
import { getAdapter } from "./adapters";
import type { UsageResult } from "./types";

/**
 * 刷新单个服务的用量明细：调适配器 fetchUsage，结果写入 usageRecords。
 * 提取为独立模块供 IPC 调用，规避与 scheduler/ipc 的循环依赖。
 */
export async function refreshUsageInternal(
  id: string,
  period: { start: string; end: string },
): Promise<UsageResult> {
  const record = getService(id);
  if (!record) throw new Error("服务不存在");
  const adapter = getAdapter(record.provider);
  if (!adapter) throw new Error(`未注册适配器: ${record.provider}`);
  if (!adapter.fetchUsage) {
    throw new Error("该服务不支持用量查询");
  }
  const secrets = getSecrets(id);
  const usage = await adapter.fetchUsage(record.config, secrets, period);
  const periodKey = `${period.start}|${period.end}`;
  saveUsageRecords(id, usage.items, periodKey, usage.currency);
  return usage;
}
