/** 本地 agent 用量按天分桶的日期工具。
 *
 * 落桶日期按本地时区的年月日划分（Electron 主进程跟系统时区，中国 UTC+8），
 * 与用户直觉中的「今天」一致；不用 UTC 日期，避免深夜 23:00 的用量被归到次日。
 */

/**
 * 把 ISO 字符串或毫秒时间戳转为本地时区 YYYY-MM-DD 日期键。
 * 非法时间返回 undefined（调用方按需跳过该条）。
 */
export function toDateKey(
  ts: string | number | null | undefined,
): string | undefined {
  if (ts == null) return undefined;
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  const t = d.getTime();
  if (!Number.isFinite(t)) return undefined;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
