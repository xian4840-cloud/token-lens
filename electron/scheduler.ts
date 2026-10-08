import type { BrowserWindow } from "electron";
import { listServices, getSetting } from "./db";
import { refreshServices } from "./refresh";
import { scanAndPersistLocalUsage } from "./local-usage";
import { logError } from "./lib/logger";
import { mapErrorToUserMessage } from "./lib/user-error";
import { createBusyLock } from "./lib/concurrency";
import { flushDb } from "./db";
import type { BalanceResult } from "./types";
import type { EventChannel, EventPayload } from "../shared/ipc";

/** 后台自动刷新调度器。应用运行期间按间隔刷新所有服务并记录快照，
 * 同时扫描本地 agent 用量落盘每日快照供趋势页使用。 */

let timer: NodeJS.Timeout | null = null;
let mainWin: BrowserWindow | null = null;
const refreshLock = createBusyLock();

export function setMainWindow(win: BrowserWindow | null): void {
  mainWin = win;
}

/** 通知前端某服务余额更新（或出错） */
function notify(id: string, payload: { balance?: BalanceResult; error?: string }): void {
  // 窗口可能已关闭或正在销毁，send 前检查
  if (mainWin && !mainWin.isDestroyed()) {
    const event: EventPayload<"balance:updated"> = { id, ...payload };
    mainWin.webContents.send("balance:updated" satisfies EventChannel, event);
  }
}

/**
 * 刷新所有服务：单个失败不影响其他；本地扫描与余额拆开。
 * 并发上限与「同一服务不重复请求」由 refresh.ts 的统一调度负责，与手动刷新共享；
 * 失败日志也在那里记（自动刷新在后台跑，用户只看到卡片不更新，必须留痕）。
 */
async function refreshAll(): Promise<void> {
  const started = refreshLock.tryRun(async () => {
    // 备份恢复、尚未补密钥的服务不进后台轮询：每轮必然失败，只会刷日志
    const services = listServices().filter((s) => !s.needsCredentials);
    await Promise.all(
      services.map(async (s) => {
        const [result] = await refreshServices([s.id]);
        if (result.status === "fulfilled") notify(s.id, { balance: result.value });
        else notify(s.id, { error: mapErrorToUserMessage(result.reason) });
      }),
    );
    flushDb();
  });
  if (!started) return;
  await started;
  try {
    await scanAndPersistLocalUsage();
  } catch (e) {
    // 本地扫描失败仅意味着本次不更新趋势，下次重试；但要留痕
    logError("local-usage", e);
  }
}

/** 默认刷新间隔（分钟），设置缺失或不可解析时使用 */
const DEFAULT_INTERVAL_MIN = 5;

/**
 * 归一化刷新间隔。返回 null 表示关闭自动刷新。
 *
 * 这里真正要挡的是 NaN。`NaN <= 0` 是 false，所以一个非数值的设置会一路走到
 * `setInterval(fn, NaN)`，而 Node 把非数值延迟当作 1 毫秒——那就成了每毫秒把
 * 所有服务商的 API 轮询一遍。触发路径真实存在：设置项就存在用户可以手工编辑的
 * token-lens-data.json 里（README 还专门教用户怎么去这个文件抢救数据）。
 *
 * 取值规则：显式的数值且 ≤0 才表示关闭，其余一律退回默认值。
 * 不把「关闭」和「疯狂刷新」这两个相反的后果交给一个比较运算的副作用决定。
 */
export function normalizeIntervalMinutes(raw: string | number | undefined): number | null {
  // 空字符串按「未设置」处理，不按 Number("") === 0 理解成关闭
  if (raw === undefined || raw === "") return DEFAULT_INTERVAL_MIN;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_INTERVAL_MIN;
  if (n <= 0) return null;
  return n;
}

/** 应用启动时调用：读取设置并启动调度器 */
export function startScheduler(): void {
  // 启动时扫一次本地 agent 用量，确保当日数据在（异步，不阻塞窗口显示）
  void scanAndPersistLocalUsage().catch((e) => {
    logError("local-usage", e);
  });
  restart(normalizeIntervalMinutes(getSetting("refreshInterval")) ?? 0);
}

/** 按新间隔重启调度器；<=0 表示关闭自动刷新 */
export function restart(intervalMin: number): void {
  stop();
  // 再挡一道：NaN 会让 setInterval 退化成 1 毫秒
  if (!Number.isFinite(intervalMin) || intervalMin <= 0) return;
  // 首次刷新由前端 init 触发（直接更新 balances，不依赖事件时序）；
  // 调度器只负责后续定时刷新
  timer = setInterval(() => void refreshAll(), intervalMin * 60 * 1000);
}

export function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
