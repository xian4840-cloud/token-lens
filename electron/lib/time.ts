/**
 * 时间戳换算。
 *
 * 存在的理由很具体：`new Date(越界值)` 得到的是 Invalid Date，紧接着的
 * `toISOString()` 会抛 `RangeError: Invalid time value`。而越界值全部来自外部
 * 数据——各家接口的时间字段、第三方会话库里的整数列——完全不受我们控制：
 * 纳秒级时间戳、单位写错的值、损坏的整数，随便一个都能越界。
 *
 * Date 的合法范围是 ±8.64e15 毫秒（±1 亿天）。项目里此前有 5 处各自
 * `new Date(...).toISOString()`，只有 antigravity 一处做了上界检查（且注释里
 * 写明过这个坑）。漏掉的地方一旦踩中，症状是用户看到一句英文报错，
 * 连已经解析成功的金额一起丢掉。
 *
 * 因此统一到这里：越界返回 undefined，绝不抛。
 */

/** Date 的合法上界：±8.64e15 毫秒（±1 亿天） */
export const MAX_DATE_MS = 8.64e15;

/** 毫秒时间戳 -> ISO。非有限、非正、超界一律返回 undefined。 */
export function msToIso(ms: number | null | undefined): string | undefined {
  if (ms == null || !Number.isFinite(ms) || ms <= 0 || ms > MAX_DATE_MS) {
    return undefined;
  }
  return new Date(ms).toISOString();
}

/** 秒级时间戳 -> ISO。先乘 1000，溢出为 Infinity 时由 msToIso 挡下。 */
export function secToIso(sec: number | null | undefined): string | undefined {
  if (sec == null) return undefined;
  return msToIso(sec * 1000);
}

/**
 * 秒或毫秒时间戳 -> ISO，按量级自动判断。
 *
 * 1e12 毫秒是 2001 年，而 1e12 秒是公元 33658 年——真实时间戳不可能落在两者
 * 之间，所以用它分界是安全的。
 */
export function epochToIso(v: number | null | undefined): string | undefined {
  if (v == null) return undefined;
  return msToIso(v > 1e12 ? v : v * 1000);
}
