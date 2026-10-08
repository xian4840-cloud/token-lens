import type { EventChannel, EventPayload } from "../../shared/ipc";

/**
 * 主进程向主窗口推事件。local-usage 不能 import scheduler（会循环），
 * 所以通知口单独放这里，main.ts 在 setMainWindow 之后接上。
 * 事件名与负载类型见 shared/ipc.ts 的 EventPayloads。
 */
let send: ((channel: EventChannel, payload?: unknown) => void) | null = null;

export function setRendererNotify(
  fn: ((channel: EventChannel, payload?: unknown) => void) | null,
): void {
  send = fn;
}

export function notifyRenderer<C extends EventChannel>(
  channel: C,
  ...payload: EventPayload<C> extends void ? [] : [EventPayload<C>]
): void {
  send?.(channel, payload[0]);
}
