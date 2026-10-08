import { app, BrowserWindow, Menu, screen, session } from "electron";
import path from "node:path";
import { initDb, flushDb, getSetting, setSetting } from "./db";
import { registerAllAdapters } from "./adapters";
import { registerIpc } from "./ipc";
import { setMainWindow, startScheduler } from "./scheduler";
import { setRendererNotify } from "./lib/renderer-notify";
import { buildCsp, safeOpenExternal, applySessionProxy } from "./lib/http";
import { initLogger, logError, logWarn } from "./lib/logger";
import { redactUrl } from "./lib/redact";
import { closePetWindow, openPetIfEnabled, preparePetQuit } from "./pet/window";
import {
  clampWindowBounds,
  DEFAULT_WINDOW,
  parseWindowBounds,
} from "./lib/window-bounds";

let win: BrowserWindow | null = null;

function restoreWindowBounds() {
  const parsed = parseWindowBounds({
    windowX: getSetting("windowX"),
    windowY: getSetting("windowY"),
    windowWidth: getSetting("windowWidth"),
    windowHeight: getSetting("windowHeight"),
  });
  const workAreas = screen.getAllDisplays().map((d) => d.workArea);
  if (!parsed) return { width: DEFAULT_WINDOW.width, height: DEFAULT_WINDOW.height };
  return clampWindowBounds(parsed, workAreas);
}

function persistWindowBounds(): void {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  setSetting("windowX", String(b.x));
  setSetting("windowY", String(b.y));
  setSetting("windowWidth", String(b.width));
  setSetting("windowHeight", String(b.height));
}

function createWindow() {
  const bounds = restoreWindowBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 620,
    title: "Token Lens",
    backgroundColor: "#f6f1e3",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  setMainWindow(win);
  setRendererNotify((channel, payload) => {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });

  // 捕获页面加载异常
  win.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    logError(
      "page-load",
      `加载失败 ${errorCode} ${errorDescription}: ${redactUrl(validatedURL)}`,
    );
  });

  // 渲染进程崩溃：此前完全静默，用户只看到窗口变白或直接消失
  win.webContents.on("render-process-gone", (_e, details) => {
    logError("renderer-gone", `渲染进程退出: ${details.reason} (exitCode=${details.exitCode})`);
  });
  win.on("unresponsive", () => {
    logWarn("window", "窗口无响应");
  });

  // 新窗口一律拒绝；安全的外部链接（http/https）交给系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url);
    return { action: "deny" };
  });

  // 限制主窗口导航：dev 允许 localhost 与 127.0.0.1，生产仅同源；外部链接转系统浏览器
  win.webContents.on("will-navigate", (e, url) => {
    if (process.env.VITE_DEV_SERVER_URL) {
      try {
        const u = new URL(url);
        if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return;
      } catch {
        // 非法 URL 落到下方 prevent
      }
    }
    e.preventDefault();
    safeOpenExternal(url);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "..", "ui", "dist", "index.html"));
  }

  win.on("ready-to-show", () => {
    win?.show();
    win?.focus();
  });
  let boundsTimer: NodeJS.Timeout | null = null;
  const schedulePersistBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      boundsTimer = null;
      persistWindowBounds();
    }, 250);
  };
  win.on("moved", schedulePersistBounds);
  win.on("resized", schedulePersistBounds);
  win.on("close", persistWindowBounds);
  win.on("closed", () => {
    if (boundsTimer) {
      clearTimeout(boundsTimer);
      boundsTimer = null;
    }
    preparePetQuit();
    closePetWindow();
    win = null;
    setMainWindow(null);
    setRendererNotify(null);
  });

}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    // 日志要最先初始化：initDb 等后续步骤自身也可能抛异常，
    // 那些异常同样需要被记下来
    initLogger();

    // 注入 CSP：主窗口 default session 所有响应补 Content-Security-Policy 头，
    // 限制脚本来源与外联目标（见 lib/http 的域名白名单）
    const dev = !!process.env.VITE_DEV_SERVER_URL;
    const csp = buildCsp(dev);
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      const headers = { ...details.responseHeaders };
      headers["Content-Security-Policy"] = [csp];
      cb({ responseHeaders: headers });
    });

    // 权限请求：桌面工具无需媒体/通知/定位等，默认拒绝，仅放行剪贴板
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
      const allowed = new Set(["clipboard-read", "clipboard-sanitized-write"]);
      cb(allowed.has(permission));
    });

    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "编辑",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
      ]),
    );
    initDb();
    void applySessionProxy();
    registerAllAdapters();
    registerIpc();
    createWindow();
    startScheduler();
    openPetIfEnabled();

  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  // 防抖持久化的数据在退出前落盘，避免丢最后一笔快照/设置
  app.on("before-quit", () => {
    preparePetQuit();
    closePetWindow();
    flushDb();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      openPetIfEnabled();
    }
  });
}
