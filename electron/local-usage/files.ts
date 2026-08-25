import fs from "node:fs";
import path from "node:path";

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
    } catch {
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
