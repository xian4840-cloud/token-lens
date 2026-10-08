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

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD → 当月 1 号。非法键返回 undefined，避免把垃圾字符串切片当日期。 */
export function monthStartKey(
  dateKey: string | undefined | null,
): string | undefined {
  if (!dateKey || !DATE_KEY.test(dateKey)) return undefined;
  return `${dateKey.slice(0, 7)}-01`;
}

/** YYYY-MM-DD → YYYY-MM。非法键返回 undefined。 */
export function monthKey(
  dateKey: string | undefined | null,
): string | undefined {
  if (!dateKey || !DATE_KEY.test(dateKey)) return undefined;
  return dateKey.slice(0, 7);
}

/** 总览「近 7 天 vs 前 7 天」对比需要的天数（含今天） */
export const LOCAL_COMPARE_DAYS = 14;

/**
 * 启动时随 bootstrap 下发的本地用量起点：当月 1 号与「今天往前 13 天」取较早者。
 *
 * 此前只给当月数据：月初几天打开应用时，「近 7 天 vs 前 7 天」两段都缺上个月的那几天，
 * 要等后台扫描完再 loadTodayLocal 才补齐，对比数字会先错一下再跳。
 * 渲染进程 loadTodayLocal 用的就是同一个起点，两边口径一致。
 */
export function localHistoryStartKey(
  today: string | undefined | null,
): string | undefined {
  const monthStart = monthStartKey(today);
  if (!monthStart || !today) return undefined;
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const d = Number(today.slice(8, 10));
  const back = toDateKey(new Date(y, m - 1, d - (LOCAL_COMPARE_DAYS - 1)).getTime());
  return back && back < monthStart ? back : monthStart;
}
