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
const { version } = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
) as { version: string };

export default defineConfig({
  root: "ui",
  base: "./",
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: { "@": path.resolve(__dirname, "ui/src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },

});
