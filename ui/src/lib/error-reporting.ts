/**
 * 渲染进程错误上报（上报给主进程写本地日志，不发往任何网络）。
 *
 * 为什么需要：前端抛出的异常此前只进 devtools 控制台，用户那边等于完全不可见。
 * 界面白屏、某个卡片渲染失败，我们事后拿不到任何线索。
 *
 * 注意 window.onerror / unhandledrejection 覆盖不到 React 渲染期间抛出的错误，
 * 那部分要靠 ErrorBoundary（见 ErrorBoundary.tsx），两者缺一不可。
 */

/** 同一条消息在这个时间窗内不重复上报，避免渲染死循环把日志刷爆 */
const DEDUPE_WINDOW_MS = 5_000;

const lastSeen = new Map<string, number>();

function shouldReport(message: string): boolean {
  const now = Date.now();
  const prev = lastSeen.get(message);
  if (prev != null && now - prev < DEDUPE_WINDOW_MS) return false;
  lastSeen.set(message, now);
  // 简单封顶，防止 Map 无限增长
  if (lastSeen.size > 100) lastSeen.clear();
  return true;
}

/** 上报一条前端错误。自身出错一律吞掉——上报失败不该再引发新错误。 */
export function reportError(scope: string, error: unknown): void {
  try {
    const detail =
      error instanceof Error
        ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
        : String(error);
    const message = `${scope} ${detail}`;
    if (!shouldReport(message)) return;
    void window.tokenLens?.reportRendererError(message);
  } catch {
    // 上报链路本身失败就放弃，不能因为记日志把界面搞崩
  }
}

/** 挂载全局错误钩子。在 main.tsx 渲染前调用一次。 */
export function installErrorReporting(): void {
  window.addEventListener("error", (e) => {
    // 资源加载失败（img/script）也会走 error 事件，但 e.error 为空，
    // 用 message 兜住，否则会漏掉静态资源 404 这类问题
    reportError("window.onerror", e.error ?? e.message);
  });

  window.addEventListener("unhandledrejection", (e) => {
    reportError("unhandledrejection", e.reason);
  });
}
