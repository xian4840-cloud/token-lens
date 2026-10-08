/**
 * 页面可见时定时轮询、隐藏时暂停的调度器（模型监控页用）。
 *
 * 此前模型监控固定每 3 秒拉一次，窗口最小化或藏到托盘后照旧在主进程里列目录、
 * stat 几千个会话文件。现在：
 * - 上一轮结束后才排下一轮（不会叠加）；
 * - document.hidden 时不排下一轮；重新可见时立刻补一轮，再恢复定时。
 */

/** 模型监控自动更新间隔 */
export const MONITOR_POLL_MS = 10_000;

export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface VisiblePollOptions {
  intervalMs?: number;
  /** 为 false 时只跑一次，不定时（对应页面上的「自动更新」开关） */
  repeat?: boolean;
  doc?: VisibilitySource;
}

export function startVisiblePoll(
  load: () => Promise<void>,
  { intervalMs = MONITOR_POLL_MS, repeat = true, doc = document }: VisiblePollOptions = {},
): () => void {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (stopped || !repeat || doc.hidden || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, intervalMs);
  };

  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await load();
    } catch {
      // load 自己负责展示错误；这里只保证轮询不断
    } finally {
      running = false;
    }
    schedule();
  };

  const onVisibility = () => {
    if (stopped || !repeat) return;
    if (doc.hidden) {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      return;
    }
    // 重新可见：立刻补一轮（若上一轮还在跑，它结束后会自己排下一轮）
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    void run();
  };

  doc.addEventListener("visibilitychange", onVisibility);
  void run();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}
