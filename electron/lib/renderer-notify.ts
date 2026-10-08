/**
 * 主进程向主窗口推事件。local-usage 不能 import scheduler（会循环），
 * 所以通知口单独放这里，main.ts 在 setMainWindow 之后接上。
 */
let send: ((channel: string, payload?: unknown) => void) | null = null;

export function setRendererNotify(
  fn: ((channel: string, payload?: unknown) => void) | null,
): void {
  send = fn;
}

export function notifyRenderer(channel: string, payload?: unknown): void {
  send?.(channel, payload);
}
