import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

/**
 * 界面左下角显示的版本号取自 package.json，构建期注入。
 * 此前是硬编码字符串，发版时忘了同步就会长期停在旧版本（实际停在 v0.1.7，
 * 而 package.json 已经 0.1.10）。
 */
const { version } = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as {
  version: string;
};

export default defineConfig({
  root: "ui",
  base: "./",
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    // @shared：与主进程共用的类型与 IPC 契约（仓库根的 shared/），改动需同步 vitest.config.mts
    alias: {
      "@": path.resolve(__dirname, "ui/src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Electron 全是本地文件，预加载懒路由只会让总览顺带把宠物图打进来
    modulePreload: false,
    // 不再配 manualChunks。此前把 recharts 手动归到 "charts" 块，打包器会把它的
    // 依赖（react / react-dom / scheduler 等）一并拉进去，结果入口要静态 import
    // 整个 charts 块（约 398 kB），趋势/用量页的懒加载形同虚设，总览和桌宠窗口
    // 启动也得先解析图表库。路由本身已是懒加载，交给默认拆分即可：recharts 只落在
    // 趋势/用量页共用的异步块里。
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
