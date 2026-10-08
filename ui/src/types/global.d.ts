import type { TokenLensApi, TokenLensPetApi } from "@shared/ipc";

/**
 * window.tokenLens 由 preload 注入：主窗口是 TokenLensApi（electron/preload.ts），
 * 桌宠窗口是 TokenLensPetApi（electron/pet-preload.ts）。两者的定义都在 shared/ipc.ts。
 * 界面代码不区分窗口，按两者的并集声明；各页面只调用自己窗口有的方法。
 */
declare global {
  interface Window {
    tokenLens: TokenLensApi & TokenLensPetApi;
  }
}

export {};
