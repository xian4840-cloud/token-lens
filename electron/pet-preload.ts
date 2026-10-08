import { contextBridge, ipcRenderer } from "electron";
import type { PetActivity, PetSpendSummary } from "./pet/types";

/**
 * 桌宠窗口专用的最小 preload。
 *
 * 桌宠是常驻置顶的透明小窗，只需要：今日花费、Agent 活动、拖动、上报前端异常。
 * 此前它和主窗口共用 preload.ts，等于把改设置、删服务、导入备份、写注册表
 * 这些能力也全部挂在了一个常驻窗口上。这里只暴露它真正用到的几项，
 * 主进程侧（pet/ipc.ts + lib/ipc-guard）同样只对桌宠窗口开放这几个通道。
 *
 * 挂载名仍是 window.tokenLens，界面代码（ui/src/lib/ipc.ts）不用分两套。
 */
const api = {
  petTodaySpend: () =>
    ipcRenderer.invoke("pet:todaySpend") as Promise<PetSpendSummary>,
  getPetActivity: () =>
    ipcRenderer.invoke("pet:getActivity") as Promise<PetActivity>,
  petDragStart: () => ipcRenderer.send("pet:drag-start"),
  petDragMove: () => ipcRenderer.send("pet:drag-move"),
  petDragEnd: () => ipcRenderer.send("pet:drag-end"),
  onPetActivity: (cb: (activity: PetActivity) => void) => {
    const handler = (_e: unknown, activity: PetActivity) => cb(activity);
    ipcRenderer.on("pet:activity", handler);
    return () => ipcRenderer.removeListener("pet:activity", handler);
  },
  onPetSpendUpdated: (cb: (summary: PetSpendSummary) => void) => {
    const handler = (_e: unknown, summary: PetSpendSummary) => cb(summary);
    ipcRenderer.on("pet:spend-updated", handler);
    return () => ipcRenderer.removeListener("pet:spend-updated", handler);
  },
  reportRendererError: (message: string) =>
    ipcRenderer.invoke("logs:report-renderer-error", message) as Promise<boolean>,
};

contextBridge.exposeInMainWorld("tokenLens", api);

export type TokenLensPetApi = typeof api;
