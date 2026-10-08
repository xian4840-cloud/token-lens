import { contextBridge, ipcRenderer } from "electron";
import type {
  EventChannel,
  EventPayload,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  SendChannel,
  TokenLensPetApi,
} from "../shared/ipc";

/**
 * 桌宠窗口专用的最小 preload。
 *
 * 桌宠是常驻置顶的透明小窗，只需要：今日花费、Agent 活动、拖动、上报前端异常。
 * 此前它和主窗口共用 preload.ts，等于把改设置、删服务、导入备份、写注册表
 * 这些能力也全部挂在了一个常驻窗口上。这里只暴露它真正用到的几项，
 * 主进程侧（pet/ipc.ts + lib/ipc-guard）同样只对桌宠窗口开放这几个通道。
 *
 * 挂载名仍是 window.tokenLens，界面代码（ui/src/lib/ipc.ts）不用分两套。
 * 类型 TokenLensPetApi 定义在 shared/ipc.ts；preload 在沙箱里，只允许 import type。
 */
function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeArgs<C>
): Promise<InvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args);
}

function send(channel: SendChannel): void {
  ipcRenderer.send(channel);
}

function subscribe<C extends EventChannel>(
  channel: C,
  cb: (payload: EventPayload<C>) => void,
): () => void {
  const handler = (_e: unknown, payload: EventPayload<C>) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: TokenLensPetApi = {
  petTodaySpend: () => invoke("pet:todaySpend"),
  getPetActivity: () => invoke("pet:getActivity"),
  petDragStart: () => send("pet:drag-start"),
  petDragMove: () => send("pet:drag-move"),
  petDragEnd: () => send("pet:drag-end"),
  onPetActivity: (cb) => subscribe("pet:activity", cb),
  onPetSpendUpdated: (cb) => subscribe("pet:spend-updated", cb),
  reportRendererError: (message) => invoke("logs:report-renderer-error", message),
};

contextBridge.exposeInMainWorld("tokenLens", api);

export type { TokenLensPetApi };
