import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { getSetting, listLocalDailyUsage, setSetting } from "../db";
import { logError } from "../lib/logger";
import { scanAndPersistLocalUsage } from "../local-usage";
import { toDateKey } from "../local-usage/date";
import {
  getLastActivity,
  startActivityWatch,
  stopActivityWatch,
} from "./activity";
import { summarizeLocalSpend } from "./spend";
import type { PetActivity, PetSpendSummary } from "./types";

const PET_WIDTH = 180;
const PET_HEIGHT = 250;

let petWin: BrowserWindow | null = null;
let allowClose = false;
let dragOffset = { x: 0, y: 0 };
let lastSpendScanAt = 0;

function preloadPath(): string {
  return path.join(__dirname, "..", "preload.js");
}

function uiIndexPath(): string {
  return path.join(__dirname, "..", "..", "ui", "dist", "index.html");
}

export function isPetOpen(): boolean {
  return petWin != null && !petWin.isDestroyed();
}

export function sendToPet(channel: string, payload: unknown): void {
  if (!petWin || petWin.isDestroyed() || petWin.webContents.isDestroyed()) return;
  petWin.webContents.send(channel, payload);
}

export function currentSpendSummary(): PetSpendSummary {
  const date = toDateKey(Date.now()) ?? "";
  // 只查当天：不带范围会把 365 天的桶全读出来再在内存里筛掉，
  // 而点击气泡、15 秒节流刷新都会走到这里
  return summarizeLocalSpend(listLocalDailyUsage(date, date), date);
}

async function refreshSpendAndPush(): Promise<void> {
  const now = Date.now();
  if (now - lastSpendScanAt < 15_000) {
    sendToPet("pet:spend-updated", currentSpendSummary());
    return;
  }
  lastSpendScanAt = now;
  try {
    await scanAndPersistLocalUsage();
    sendToPet("pet:spend-updated", currentSpendSummary());
  } catch (e) {
    logError("pet-spend", e);
  }
}

function defaultPosition(): { x: number; y: number } {
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(wa.x + wa.width - PET_WIDTH - 20),
    y: Math.round(wa.y + wa.height - PET_HEIGHT - 20),
  };
}

function restorePosition(): { x: number; y: number } {
  const x = Number(getSetting("petX"));
  const y = Number(getSetting("petY"));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return defaultPosition();
  const visible = screen.getAllDisplays().some((d) => {
    const { x: dx, y: dy, width, height } = d.workArea;
    return x + PET_WIDTH > dx && x < dx + width && y + PET_HEIGHT > dy && y < dy + height;
  });
  return visible ? { x: Math.round(x), y: Math.round(y) } : defaultPosition();
}

export function preparePetQuit(): void {
  allowClose = true;
}

export function closePetWindow(): void {
  stopActivityWatch();
  if (petWin && !petWin.isDestroyed()) {
    allowClose = true;
    petWin.destroy();
  }
  petWin = null;
}

export function openPetWindow(): void {
  if (isPetOpen()) {
    petWin?.show();
    return;
  }

  const pos = restorePosition();
  allowClose = false;
  petWin = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  petWin.setAlwaysOnTop(true, "floating");
  petWin.setMenu(null);

  petWin.on("close", (e) => {
    if (!allowClose) {
      e.preventDefault();
    }
  });
  petWin.on("closed", () => {
    stopActivityWatch();
    petWin = null;
  });
  petWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  petWin.webContents.on("will-navigate", (e, url) => {
    if (process.env.VITE_DEV_SERVER_URL) {
      try {
        const u = new URL(url);
        if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return;
      } catch {
        // 非法 URL 落到下方 prevent
      }
    }
    e.preventDefault();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void petWin.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/pet`);
  } else {
    void petWin.loadFile(uiIndexPath(), { hash: "/pet" });
  }

  petWin.once("ready-to-show", () => {
    petWin?.show();
    sendToPet("pet:spend-updated", currentSpendSummary());
  });

  startActivityWatch((activity: PetActivity) => {
    sendToPet("pet:activity", activity);
  });
}

export function openPetIfEnabled(): void {
  if (getSetting("petEnabled") === "1") {
    try {
      openPetWindow();
    } catch (e) {
      logError("pet-window", e);
    }
  }
}

export function setPetEnabled(enabled: boolean): boolean {
  setSetting("petEnabled", enabled ? "1" : "0");
  try {
    if (enabled) openPetWindow();
    else closePetWindow();
  } catch (e) {
    logError("pet-window", e);
  }
  return enabled;
}

export function isPetEnabled(): boolean {
  return getSetting("petEnabled") === "1";
}

export function handlePetDragStart(): void {
  if (!isPetOpen() || !petWin) return;
  const cursor = screen.getCursorScreenPoint();
  const [wx, wy] = petWin.getPosition();
  dragOffset = { x: cursor.x - wx, y: cursor.y - wy };
}

export function handlePetDragMove(): void {
  if (!isPetOpen() || !petWin) return;
  const cursor = screen.getCursorScreenPoint();
  petWin.setPosition(cursor.x - dragOffset.x, cursor.y - dragOffset.y, false);
}

export function handlePetDragEnd(): void {
  if (!isPetOpen() || !petWin) return;
  const [x, y] = petWin.getPosition();
  setSetting("petX", String(x));
  setSetting("petY", String(y));
}

export function getPetActivity(): PetActivity {
  return getLastActivity();
}

export function requestTodaySpend(): PetSpendSummary {
  const summary = currentSpendSummary();
  // 点击时再扫：走 scanInFlight，调度器正在扫就复用，不会叠第二份
  void refreshSpendAndPush();
  return summary;
}
