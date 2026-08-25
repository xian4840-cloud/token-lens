#!/usr/bin/env node
/**
 * 把 package-lock.json 里的 registry.npmmirror.com 改回 registry.npmjs.org。
 *
 * 为什么需要：本机 .npmrc 指向 npmmirror（国内装包快），但 .npmrc 已被 gitignore，
 * lockfile 却会被提交。若 resolved 域名留着镜像地址，等于把本机环境带进公开仓库，
 * 且他人 / CI 装包会去访问一个与自己配置无关的镜像。
 *
 * 只改 URL 的主机名，不动版本号与 integrity 校验值——integrity 是内容哈希，
 * 与来源域名无关，npm 装包时仍会校验，所以改域名不影响完整性验证。
 *
 * 每次 npm install / npm update 之后都应重跑一次。
 */
const fs = require("node:fs");
const path = require("node:path");

const FROM = "https://registry.npmmirror.com/";
const TO = "https://registry.npmjs.org/";
const lockPath = path.join(__dirname, "..", "package-lock.json");

const before = fs.readFileSync(lockPath, "utf8");
const hits = before.split(FROM).length - 1;

if (hits === 0) {
  console.log("lockfile 已干净，无 npmmirror 地址。");
  process.exit(0);
}

const after = before.split(FROM).join(TO);

// 改写前后行数必须一致，否则说明动到了结构而非单纯替换
const lineDelta = after.split("\n").length - before.split("\n").length;
if (lineDelta !== 0) {
  console.error(`行数发生变化（${lineDelta}），已中止，未写入。`);
  process.exit(1);
}

// integrity 值必须一字不变
const integrityOf = (s) => (s.match(/"integrity": "[^"]+"/g) || []).join("\n");
if (integrityOf(before) !== integrityOf(after)) {
  console.error("integrity 校验值发生变化，已中止，未写入。");
  process.exit(1);
}

// 解析成 JSON 确认没写坏
try {
  JSON.parse(after);
} catch (e) {
  console.error(`改写后不是合法 JSON，已中止，未写入：${e.message}`);
  process.exit(1);
}

fs.writeFileSync(lockPath, after, "utf8");

const remaining = after.split("registry.npmmirror.com").length - 1;
console.log(`已替换 ${hits} 处 npmmirror -> npmjs.org`);
console.log(`剩余 npmmirror 出现次数: ${remaining}`);
console.log(`npmjs.org 出现次数: ${after.split("registry.npmjs.org").length - 1}`);
if (remaining !== 0) {
  console.error("仍有残留，请检查。");
  process.exit(1);
}
