import { app, BrowserWindow, Menu, shell, session } from "electron";
import path from "node:path";
import { initDb, flushDb } from "./db";
import { registerAllAdapters } from "./adapters";
import { registerIpc } from "./ipc";
import { setMainWindow, startScheduler } from "./scheduler";
import { buildCsp, safeOpenExternal, applySessionProxy } from "./lib/http";

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
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

  // 捕获页面加载异常
  win.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    console.error("页面加载失败:", errorCode, errorDescription, validatedURL);
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
  win.on("closed", () => {
    win = null;
    setMainWindow(null);
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

  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  // 防抖持久化的数据在退出前落盘，避免丢最后一笔快照/设置
  app.on("before-quit", () => flushDb());
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
