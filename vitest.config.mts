import path from "node:path";
import { defineConfig } from "vitest/config";

// 用 import.meta.dirname（Node 20.11+）而非 __dirname：
// .mts 是 ESM，__dirname 仅靠打包器 shim 才存在，Vite 切到 native
// config loader 后会直接报错。

/**
 * 测试专用配置，独立于 vite.config.ts。
 *
 * 必须独立的原因：vite.config.ts 里 `root: "ui"` 是给前端构建用的，
 * vitest 若继承它，则 electron/ 下的测试文件永远扫不到——
 * 测试静默不执行、npm test 依旧报绿，是最坏的一种失败。
 * 此处把 root 放回仓库根，两侧都纳入 include。
 *
 * 用 .mts 扩展名：仓库没有 "type": "module"（electron 主进程需 CommonJS 产物），
 * .ts 配置会触发 Vite 的 CJS/ESM 警告。
 */
export default defineConfig({
  resolve: {
    // 与 vite.config.ts 保持一致，改动需同步两处
    alias: { "@": path.resolve(import.meta.dirname, "ui/src") },
  },
  test: {
    include: [
      "ui/src/**/*.{test,spec}.{ts,tsx}",
      "electron/**/*.{test,spec}.ts",
      "scripts/**/*.{test,spec}.{ts,mts}",
    ],
  },
});
