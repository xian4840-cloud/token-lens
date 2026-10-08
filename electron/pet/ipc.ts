import { MAIN_ONLY, PET_ONLY, type GuardedIpc } from "../lib/ipc-guard";
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
  guard.handle("pet:getEnabled", MAIN_ONLY, () => isPetEnabled());
  guard.handle("pet:setEnabled", MAIN_ONLY, (_e, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("petEnabled 需为布尔值");
    return setPetEnabled(enabled);
  });
  guard.handle("pet:todaySpend", PET_ONLY, () => requestTodaySpend());
  guard.handle("pet:getActivity", PET_ONLY, () => getPetActivity());

  guard.on("pet:drag-start", PET_ONLY, () => handlePetDragStart());
  guard.on("pet:drag-move", PET_ONLY, () => handlePetDragMove());
  guard.on("pet:drag-end", PET_ONLY, () => handlePetDragEnd());
}

export type { PetActivity, PetSpendSummary };
