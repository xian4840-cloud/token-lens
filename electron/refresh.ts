import { getService, getSecrets, saveBalanceSnapshot, saveLastBalance } from "./db";
import { logError } from "./lib/logger";
import { createRefreshCoordinator } from "./lib/refresh-coordinator";
import { getAdapter } from "./adapters";
import { NEEDS_CREDENTIALS_MESSAGE } from "./lib/backup";
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
  if (record.needsCredentials) throw new Error(NEEDS_CREDENTIALS_MESSAGE);
  const adapter = getAdapter(record.provider);
  if (!adapter) throw new Error(`未注册适配器: ${record.provider}`);
  const secrets = getSecrets(id);
  const balance = await adapter.fetchBalance(record.config, secrets);
  saveBalanceSnapshot(id, balance.remaining ?? balance.used, balance.currency);
  const { raw: _raw, ...safe } = balance;
  saveLastBalance(id, safe);
  return safe;
}

/** 手动与定时刷新共享的并发上限 */
export const REFRESH_CONCURRENCY = 3;

/**
 * 主进程唯一的刷新入口：IPC「刷新」与调度器都走这里，共享同一把锁和并发上限
 * （见 lib/refresh-coordinator）。失败在这里记一次日志：手动刷新撞上正在跑的
 * 定时刷新时两边拿到的是同一个 Promise，不会各记一笔。
 */
const coordinator = createRefreshCoordinator(async (id: string) => {
  try {
    return await refreshServiceInternal(id);
  } catch (e) {
    const record = getService(id);
    logError(`refresh:${record?.provider ?? "unknown"}`, e);
    throw e;
  }
}, REFRESH_CONCURRENCY);

export function refreshService(id: string): Promise<BalanceResult> {
  return coordinator.refresh(id);
}

export function refreshServices(
  ids: readonly string[],
): Promise<PromiseSettledResult<BalanceResult>[]> {
  return coordinator.refreshMany(ids);
}
