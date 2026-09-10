/**
 * 从各家接口的响应里取数。
 *
 * 存在的理由：这类接口返回的数字格式很不统一——有的是 number，有的是字符串，
 * 有的带千分位（阿里云返回 "1,234.56"），字段还可能整个缺失。此前项目里有四份
 * 各自实现的版本（bailian.parseAmount、zhipu-common.pickNumber、
 * kimi.pickNumber，以及若干直接 Number() 的内联写法），行为各不相同：
 * - 只有 zhipu 那份容忍千分位；
 * - kimi 那份不认千分位，"1,234.56" 会解析失败；
 * - deepseek / volcengine 直接 Number(x)，字段缺失时得到 NaN 并一路带进界面
 *   （卡片显示 "-"，副行却写着「该服务无余额查询 API」——而该服务是有余额接口的）。
 *
 * 四份实现并存意味着四种边界行为，谁也无法一眼说清某家服务在脏数据下的表现。
 * 合成一份之后，边界只需定义一次、测试一次。
 */

/**
 * 解析单个值为有限数。
 *
 * 容忍：number（须有限）、数字字符串（去空白与千分位逗号）。
 * 拒绝：null / undefined / 空串 / 纯空白 / 非数字字符串 / NaN / ±Infinity。
 *
 * 空串按「没给值」处理而不是 Number("") 的 0——余额接口返回空串是数据缺失，
 * 不是余额为零，把前者显示成 ¥0.00 是在替服务商编造一个它没说的数字。
 */
export function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 从对象中按 keys 的顺序取首个可解析为有限数的字段值。
 *
 * 按顺序而非取最大值/最小值：字段别名列表本身就表达了优先级
 * （如 availableBalance 比 balance 更贴近「可用」的语义）。
 */
export function pickNumber(
  obj: Record<string, unknown> | undefined,
  keys: string[],
): number | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const n = toFiniteNumber(obj[k]);
    if (n !== undefined) return n;
  }
  return undefined;
}
