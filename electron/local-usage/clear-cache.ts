import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

/**
 * 清除本地用量扫描缓存，强制下次全量重扫。
 * 用于统计逻辑修复后，确保历史数据按新逻辑重新计算。
 */
export function clearUsageScanCache(): void {
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

/**
 * 清除本地每日用量快照（持久化的历史统计数据）。
 * 清除后需重新扫描才能看到趋势图。
 */
export function clearLocalDailyUsage(): void {
  const dbPath = path.join(app.getPath("userData"), "token-lens-data.json");
  try {
    if (!fs.existsSync(dbPath)) return;
    const data = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    // 清空 localDailyUsage 字段，保留其他设置
    if (data && typeof data === "object") {
      data.localDailyUsage = [];
      fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), "utf8");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`清除历史用量失败：${msg}`);
  }
}
