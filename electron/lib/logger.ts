import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { redactError, redactText } from "./redact";

/**
 * 落盘日志。
 *
 * 目的很具体：用户报「卡片一直转圈」或「点了没反应」时，我们要能知道
 * 是哪个服务、哪一步、什么错。在此之前这些信息只进 console，
 * 也就是只有开着 devtools 的开发者能看到，等于线上完全瞎。
 *
 * 三条硬约束：
 *
 * 1. **不联网**。只写本地文件，用户自己决定要不要把文件发出来。
 *    README 承诺了不内置遥测，这里不能破。
 * 2. **写入前必过脱敏**。日志文件会被用户直接发给我们，
 *    密钥一旦落盘就等于泄露，且用户无从察觉。见 redact.ts。
 * 3. **不能因为记日志把应用搞崩**。所有写盘异常一律吞掉——
 *    日志是辅助手段，它失败的严重性远低于它拖垮主流程。
 *
 * 轮转策略故意做得很笨：单文件超上限就改名成 .1 覆盖旧的，只留两代。
 * 个人工具没有必要引入 winston 之类，够用即可。
 */

/** 单个日志文件上限。超过即轮转，避免长年累月吃满磁盘。 */
const MAX_BYTES = 2 * 1024 * 1024;

/** 内存中保留的最近条目数，供界面直接展示，免得用户非得去翻文件 */
const MEMORY_LIMIT = 200;

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  time: string;
  level: LogLevel;
  /** 出错的模块，如 "refresh" / "adapter:gemini" / "local-usage" */
  scope: string;
  message: string;
}

const recent: LogEntry[] = [];
let logPath = "";
let initFailed = false;

/** 日志目录：userData/logs。与数据文件同级，卸载时不会被删。 */
export function getLogDir(): string {
  return path.join(app.getPath("userData"), "logs");
}

export function getLogPath(): string {
  return logPath || path.join(getLogDir(), "token-lens.log");
}

/**
 * 初始化日志：建目录、接管未捕获异常。
 * 必须在 app ready 之后调用（app.getPath 依赖之）。
 */
export function initLogger(): void {
  try {
    const dir = getLogDir();
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, "token-lens.log");
    const version = app.getVersion();
    write(
      "info",
      "app",
      `启动 Token Lens ${version} (${process.platform} ${process.arch}, Electron ${process.versions.electron})`,
    );
  } catch {
    // 目录建不出来（权限、磁盘满）就退化为只留内存日志，不影响应用运行
    initFailed = true;
  }

  // 主进程未捕获异常：此前会直接静默崩溃，用户只看到窗口消失
  process.on("uncaughtException", (e) => {
    write("error", "uncaught", redactError(e));
  });
  process.on("unhandledRejection", (reason) => {
    write("error", "unhandled-rejection", redactError(reason));
  });
}

/** 超过上限则轮转：当前文件改名为 .1（覆盖上一代），只保留两代 */
function rotateIfNeeded(): void {
  try {
    const stat = fs.statSync(logPath);
    if (stat.size < MAX_BYTES) return;
    const old = `${logPath}.1`;
    fs.rmSync(old, { force: true });
    fs.renameSync(logPath, old);
  } catch {
    // 文件不存在（首次写）或改名失败，都不该阻断本次写入
  }
}

/**
 * 写一条日志。message 会被强制脱敏——调用方不必自己记得处理，
 * 靠调用方自觉是迟早会漏的。
 */
export function write(level: LogLevel, scope: string, message: string): void {
  const entry: LogEntry = {
    time: new Date().toISOString(),
    level,
    scope,
    message: redactText(message),
  };

  recent.push(entry);
  if (recent.length > MEMORY_LIMIT) recent.shift();

  // 开发时仍打到控制台，方便边写边看
  if (process.env.VITE_DEV_SERVER_URL) {
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(`[${scope}] ${entry.message}`);
  }

  if (initFailed || !logPath) return;
  try {
    rotateIfNeeded();
    fs.appendFileSync(
      logPath,
      `${entry.time} [${level.toUpperCase()}] [${scope}] ${entry.message}\n`,
      "utf8",
    );
  } catch {
    // 磁盘满、文件被占用等：放弃本次写盘，内存日志仍在
  }
}

export function logInfo(scope: string, message: string): void {
  write("info", scope, message);
}

export function logWarn(scope: string, message: string): void {
  write("warn", scope, message);
}

/** 记录错误。传 unknown 即可，脱敏与类型判断都在内部完成。 */
export function logError(scope: string, e: unknown): void {
  write("error", scope, redactError(e));
}

/** 最近日志条目（新的在后）。供界面展示，不必让用户去翻文件。 */
export function getRecentLogs(): LogEntry[] {
  return [...recent];
}

/** 清空内存与磁盘日志。用户主动清理，或发文件前想先重现一遍问题时用。 */
export function clearLogs(): void {
  recent.length = 0;
  try {
    fs.rmSync(logPath, { force: true });
    fs.rmSync(`${logPath}.1`, { force: true });
  } catch {
    // 删不掉就算了，下次轮转会覆盖
  }
}
