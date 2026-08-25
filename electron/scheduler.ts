import type { BrowserWindow } from "electron";
import { listServices, getSetting } from "./db";
import { refreshServiceInternal } from "./refresh";
import { scanAndPersistLocalUsage } from "./local-usage";
import type { BalanceResult } from "./types";

/** 后台自动刷新调度器。应用运行期间按间隔刷新所有服务并记录快照，
 * 同时扫描本地 agent 用量落盘每日快照供趋势页使用。 */

let timer: NodeJS.Timeout | null = null;
let mainWin: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null): void {
  mainWin = win;
}

/** 通知前端某服务余额更新（或出错） */
function notify(
  id: string,
  payload: { balance?: BalanceResult; error?: string },
): void {
  // 窗口可能已关闭或正在销毁，send 前检查
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send("balance:updated", { id, ...payload });
  }
}

/** 刷新所有服务：逐个记录快照并通知前端，单个失败不影响其他；
 *  末尾顺带扫描本地 agent 用量落盘每日快照（失败不影响余额刷新）。 */
async function refreshAll(): Promise<void> {
  const services = listServices();
  for (const s of services) {
    try {
      const balance = await refreshServiceInternal(s.id);
      notify(s.id, { balance });
    } catch (e) {
      notify(s.id, { error: e instanceof Error ? e.message : String(e) });
    }
  }
  try {
    await scanAndPersistLocalUsage();
  } catch {
    // 本地扫描失败仅意味着本次不更新趋势，下次重试
  }
}

/** 应用启动时调用：读取设置并启动调度器 */
export function startScheduler(): void {
  const min = Number(getSetting("refreshInterval") ?? "5");
  // 启动时扫一次本地 agent 用量，确保当日数据在（异步，不阻塞窗口显示）
  void scanAndPersistLocalUsage().catch(() => {});
  restart(min);
}

/** 按新间隔重启调度器；<=0 表示关闭自动刷新 */
export function restart(intervalMin: number): void {
  stop();
  if (intervalMin <= 0) return;
  // 首次刷新由前端 init 触发（直接更新 balances，不依赖事件时序）；
  // 调度器只负责后续定时刷新
  timer = setInterval(() => void refreshAll(), intervalMin * 60 * 1000);
}

export function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
