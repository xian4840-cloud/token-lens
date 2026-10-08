// ESLint（flat config）。刻意保持克制：只开推荐规则里能抓真问题的部分，
// 格式交给 Prettier（eslint-config-prettier 关掉与之冲突的规则），
// 已有代码里大量出现、改动收益低的规则降为 warn，不强迫为了过 lint 改逻辑。
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "electron-dist/",
      "dist-electron/",
      "ui/dist/",
      "coverage/",
      // 注入到第三方程序的采集脚本，按原样分发
      "electron/agent-capture/",
      "electron/codex-capture/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 主进程收到的参数、第三方接口的响应形状不定，any 在边界处有其用途
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // 空 catch 在本项目里多是「读失败就当没有」，按需写注释说明即可
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // 清洗日志 / 文件内容时要匹配控制字符，属于有意为之
      "no-control-regex": "off",
    },
  },
  {
    files: ["electron/**/*.ts", "shared/**/*.ts", "scripts/**/*.{cjs,mjs,js}", "*.{ts,mts,mjs}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // node:sqlite 等可选 / 实验模块按需 require，加载失败时降级，不能写成顶层 import
    files: ["electron/**/*.ts"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["scripts/**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      // Windows 手工验收脚本：finally 里清理失败时有意抛出
      "no-unsafe-finally": "warn",
    },
  },
  {
    files: ["ui/**/*.{ts,tsx,js}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  prettier,
);
