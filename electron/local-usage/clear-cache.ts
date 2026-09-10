import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { resetScanCache } from "./cache";

/**
 * 清除本地用量扫描缓存，强制下次全量重扫。
 * 用于统计逻辑修复后，确保历史数据按新逻辑重新计算。
 *
 * 历史用量桶的清除在 db 模块（clearAllLocalDailyUsage）：那份数据由 db 的
 * 内存状态决定，不经它直接改写文件会与内存分叉。这里只负责缓存文件本身。
 */
export function clearUsageScanCache(): void {
  // 顺序要紧：先丢内存再删文件。
  //
  // 缓存模块把整份缓存常驻内存，只删文件的话，本次会话内 getScanCache 仍返回
  // 旧对象，扫描会把所有会话文件按旧口径算出的聚合原样写回——用户点了
  // 「清除缓存并重新扫描」，看到成功提示，数字却一个没变，要重启才生效。
  resetScanCache();

  const cachePath = path.join(app.getPath("userData"), "usage-scan-cache.json");
  try {
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`清除缓存失败：${msg}`);
  }
}
