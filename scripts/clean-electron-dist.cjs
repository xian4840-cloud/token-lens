/**
 * 构建主进程前清空 electron-dist。
 * tsc 不会删除过期产物：目录结构调整（如 shared/ 加入后产物移到 electron-dist/electron/）
 * 或删掉源文件后，旧的 .js 会留在 electron-dist 里，被 electron-builder 一并打进安装包。
 */
const fs = require("node:fs");
const path = require("node:path");

fs.rmSync(path.join(__dirname, "..", "electron-dist"), { recursive: true, force: true });
