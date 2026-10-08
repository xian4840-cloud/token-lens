import path from "node:path";
import { app } from "electron";

/**
 * 开发服务器地址：只在未打包时认 VITE_DEV_SERVER_URL。
 * 打包后的应用若仍读这个环境变量，任何能设置环境变量的人都能让主窗口加载
 * 外部页面并拿到完整的 preload API；IPC 发送方校验也会把它当成「本应用页面」。
 */
export function devServerUrl(): string | undefined {
  if (app?.isPackaged) return undefined;
  return process.env.VITE_DEV_SERVER_URL || undefined;
}

/** 打包内界面入口 ui/dist/index.html 的绝对路径（本文件编译后位于 electron-dist/lib） */
export function appIndexHtmlPath(): string {
  return path.join(__dirname, "..", "..", "ui", "dist", "index.html");
}
