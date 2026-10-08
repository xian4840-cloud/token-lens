import type { InvokeChannel, InvokeResult, SendChannel } from "../../shared/ipc";
import type { ChannelPolicy, GuardedIpc } from "./ipc-guard";

/**
 * 按 shared/ipc.ts 的契约给 guard 加上类型：通道名必须是契约里登记过的，
 * 处理函数的返回值必须与契约一致。参数仍按 unknown 由处理函数自行校验（渲染进程不可信）。
 * 运行时就是 guard 本身，不多包一层。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 事件对象类型随 ipcMain / 测试替身而变
export type IpcEvent = any;

export type InvokeHandler<C extends InvokeChannel> = (
  event: IpcEvent,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 参数来自渲染进程，由处理函数自行校验
  ...args: any[]
) => InvokeResult<C> | Promise<InvokeResult<C>>;

export interface TypedIpc {
  handle<C extends InvokeChannel>(
    channel: C,
    policy: ChannelPolicy,
    listener: InvokeHandler<C>,
  ): void;
  on(
    channel: SendChannel,
    policy: ChannelPolicy,
    listener: (event: IpcEvent, ...args: unknown[]) => void,
  ): void;
}

export function typedIpc(guard: GuardedIpc): TypedIpc {
  return guard;
}
