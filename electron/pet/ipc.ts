import { ipcMain } from "electron";
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

export function registerPetIpc(): void {
  ipcMain.handle("pet:getEnabled", () => isPetEnabled());
  ipcMain.handle("pet:setEnabled", (_e, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("petEnabled 需为布尔值");
    return setPetEnabled(enabled);
  });
  ipcMain.handle("pet:todaySpend", () => requestTodaySpend());
  ipcMain.handle("pet:getActivity", () => getPetActivity());

  ipcMain.on("pet:drag-start", () => handlePetDragStart());
  ipcMain.on("pet:drag-move", () => handlePetDragMove());
  ipcMain.on("pet:drag-end", () => handlePetDragEnd());
}

export type { PetActivity, PetSpendSummary };
