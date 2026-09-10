import fs from "node:fs";
import path from "node:path";
import { logWarn } from "../lib/logger";

export interface JsonlFileStat {
  path: string;
  mtimeMs: number;
}

/** 递归列出目录下所有 .jsonl 文件及其 mtime（目录不存在返回空）。 */
export function listJsonlFilesWithStat(dir: string): JsonlFileStat[] {
  if (!fs.existsSync(dir)) return [];
  const out: JsonlFileStat[] = [];
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      // 必须留痕：读不到目录与「目录里没有文件」返回的是同一个空数组，
      // 而前者会让该来源显示成「正常但零用量」——一个静默的错误答案。
      // 项目在别处已经点明过这个反模式（见 antigravity.ts 的「全部会话都打不开」
      // 分支），这里补上同等的处理。
      logWarn("local-usage", `读取目录失败，该目录下的用量将被跳过：${d}（${String(e)}）`);
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && e.name.endsWith(".jsonl")) {
        try {
          out.push({ path: full, mtimeMs: fs.statSync(full).mtimeMs });
        } catch {
          // 文件在枚举与 stat 之间被删，跳过
        }
      }
    }
  };
  walk(dir);
  return out;
}
