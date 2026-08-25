import { getService, getSecrets, saveBalanceSnapshot } from "./db";
import { getAdapter } from "./adapters";
import type { BalanceResult } from "./types";

/**
 * 刷新单个服务的余额并记录快照。
 * IPC handler 与后台调度器共用此逻辑，避免重复实现。
 */
export async function refreshServiceInternal(
  id: string,
): Promise<BalanceResult> {
  const record = getService(id);
  if (!record) throw new Error("服务不存在");
  const adapter = getAdapter(record.provider);
  if (!adapter) throw new Error(`未注册适配器: ${record.provider}`);
  const secrets = getSecrets(id);
  const balance = await adapter.fetchBalance(record.config, secrets);
  saveBalanceSnapshot(id, balance.remaining ?? balance.used, balance.currency);
  return balance;
}
