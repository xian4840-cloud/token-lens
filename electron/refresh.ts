import {
  getService,
  getSecrets,
  onServiceChanged,
  saveBalanceSnapshot,
  saveLastBalance,
} from "./db";
import { logError } from "./lib/logger";
import { createRefreshCoordinator } from "./lib/refresh-coordinator";
import { getAdapter } from "./adapters";
import { NEEDS_CREDENTIALS_MESSAGE } from "./lib/backup";
import type { BalanceResult } from "./types";

/**
 * 刷新单个服务的余额并记录快照。
 * IPC handler 与后台调度器共用此逻辑，避免重复实现。
 *
 * isCurrent：请求发出后服务配置被改 / 被删时返回 false。此时拿到的是旧密钥的结果，
 * 不写快照、不写 lastBalance，免得盖掉用新配置刷出来的值（或给已删除的服务留下孤儿快照）。
 */
export async function refreshServiceInternal(
  id: string,
  isCurrent: () => boolean = () => true,
): Promise<BalanceResult> {
  const record = getService(id);
  if (!record) throw new Error("服务不存在");
  if (record.needsCredentials) throw new Error(NEEDS_CREDENTIALS_MESSAGE);
  const adapter = getAdapter(record.provider);
  if (!adapter) throw new Error(`未注册适配器: ${record.provider}`);
  const secrets = getSecrets(id);
  const balance = await adapter.fetchBalance(record.config, secrets);
  const { raw: _raw, ...safe } = balance;
  if (!isCurrent()) return safe;
  saveBalanceSnapshot(id, balance.remaining ?? balance.used, balance.currency);
  saveLastBalance(id, safe);
  return safe;
}

/** 手动与定时刷新共享的并发上限 */
export const REFRESH_CONCURRENCY = 3;

/**
 * 主进程唯一的刷新入口：IPC「刷新」与调度器都走这里，共享同一把锁和并发上限
 * （见 lib/refresh-coordinator）。失败在这里记一次日志：手动刷新撞上正在跑的
 * 定时刷新时两边拿到的是同一个 Promise，不会各记一笔。
 * 已作废的请求（配置改了 / 服务删了）不记：那是旧配置的结果，调用方也拿不到它。
 */
const coordinator = createRefreshCoordinator(async (id: string, isCurrent) => {
  try {
    return await refreshServiceInternal(id, isCurrent);
  } catch (e) {
    const record = getService(id);
    if (isCurrent() && record) logError(`refresh:${record.provider}`, e);
    throw e;
  }
}, REFRESH_CONCURRENCY);

// 服务的密钥、配置、凭据标记有任何改动（编辑、删除、备份导入新建）都作废在途请求：
// 挂在 db 层，所有改动入口都覆盖到，不依赖每个 IPC 记得调用
onServiceChanged((id) => coordinator.invalidate(id));

export function refreshService(id: string): Promise<BalanceResult> {
  return coordinator.refresh(id);
}

export function refreshServices(
  ids: readonly string[],
): Promise<PromiseSettledResult<BalanceResult>[]> {
  return coordinator.refreshMany(ids);
}
