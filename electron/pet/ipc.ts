import { MAIN_ONLY, PET_ONLY, type GuardedIpc } from "../lib/ipc-guard";
import { typedIpc } from "../lib/typed-ipc";
import type { PetActivity, PetSpendSummary } from "./types";
import {
  getPetActivity,
  handlePetDragEnd,
  handlePetDragMove,
  handlePetDragStart,
  isPetEnabled,
  requestTodaySpend,
  setPetEnabled,
} from "./window";

/**
 * 桌宠相关通道。开关由主窗口的设置页调用；其余只对桌宠窗口开放，
 * 与 pet-preload.ts 暴露的 API 一一对应。
 */
export function registerPetIpc(guard: GuardedIpc): void {
  const ipc = typedIpc(guard);
  ipc.handle("pet:getEnabled", MAIN_ONLY, () => isPetEnabled());
  ipc.handle("pet:setEnabled", MAIN_ONLY, (_e, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("petEnabled 需为布尔值");
    return setPetEnabled(enabled);
  });
  ipc.handle("pet:todaySpend", PET_ONLY, () => requestTodaySpend());
  ipc.handle("pet:getActivity", PET_ONLY, () => getPetActivity());

  ipc.on("pet:drag-start", PET_ONLY, () => handlePetDragStart());
  ipc.on("pet:drag-move", PET_ONLY, () => handlePetDragMove());
  ipc.on("pet:drag-end", PET_ONLY, () => handlePetDragEnd());
}

export type { PetActivity, PetSpendSummary };
