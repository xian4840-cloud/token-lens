import fs from "node:fs";
import path from "node:path";
import { logWarn } from "../lib/logger";
import { mapPool } from "../lib/concurrency";

export interface JsonlFileStat {
  path: string;
  mtimeMs: number;
  /** 文件字节数（增量读取 / 判断是否只追加时用） */
  size: number;
}

/** 同时在途的 readdir/stat 数量上限：既不阻塞主线程，也不把 libuv 线程池占满。 */
const STAT_CONCURRENCY = 16;

/**
 * 递归列出目录下所有 .jsonl 文件及其 mtime / size（目录不存在返回空）。
 *
 * 全程走 fs.promises：此前是 readdirSync + statSync，几千个会话文件时一次枚举就要
 * 在主进程里同步卡上百毫秒，期间窗口拖动、IPC 全部停住；模型监控每次轮询都要走一遍。
 * 结果按路径排序，保证调用方处理顺序稳定（跨文件去重依赖这一点）。
 */
export async function listJsonlFilesWithStat(dir: string): Promise<JsonlFileStat[]> {
  try {
    await fs.promises.access(dir);
  } catch {
    return [];
  }
  const out: JsonlFileStat[] = [];
  const walk = async (d: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true });
    } catch (e) {
      // 必须留痕：读不到目录与「目录里没有文件」返回的是同一个空数组，
      // 而前者会让该来源显示成「正常但零用量」——一个静默的错误答案。
      // 项目在别处已经点明过这个反模式（见 antigravity.ts 的「全部会话都打不开」
      // 分支），这里补上同等的处理。
      logWarn("local-usage", `读取目录失败，该目录下的用量将被跳过：${d}（${String(e)}）`);
      return;
    }
    const dirs: string[] = [];
    const files: string[] = [];
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) dirs.push(full);
      else if (e.isFile() && e.name.endsWith(".jsonl")) files.push(full);
    }
    await mapPool(files, STAT_CONCURRENCY, async (full) => {
      try {
        const st = await fs.promises.stat(full);
        out.push({ path: full, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        // 文件在枚举与 stat 之间被删，跳过
      }
    });
    await mapPool(dirs, 4, walk);
  };
  await walk(dir);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}
