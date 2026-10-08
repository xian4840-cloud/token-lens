/**
 * IPC 参数的运行时校验。
 *
 * TypeScript 的参数类型在 IPC 边界上不存在：渲染进程传来的可以是任意结构化克隆值。
 * 这些小函数把「看起来是 string」变成真的校验，失败统一抛出可读错误。
 */

const MAX_ID_LEN = 200;
const MAX_TIME_LEN = 64;

/** 服务 id 等标识：非空字符串，限长 */
export function requireId(v: unknown, what = "服务 id"): string {
  if (typeof v !== "string" || !v || v.length > MAX_ID_LEN) throw new Error(`无效的${what}`);
  return v;
}

/** 可选标识：undefined / null 视为未传 */
export function optionalId(v: unknown, what = "服务 id"): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return requireId(v, what);
}

/** 可选时间 / 日期字符串（ISO 时间或 YYYY-MM-DD），必须能被 Date.parse 解析 */
export function optionalTime(v: unknown, what = "时间"): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || v.length > MAX_TIME_LEN || !Number.isFinite(Date.parse(v))) {
    throw new Error(`无效的${what}`);
  }
  return v;
}

/** 设置项 key（读取用；写入另有白名单校验） */
export function requireSettingKey(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v)) {
    throw new Error("无效的设置项");
  }
  return v;
}

/** 代理测试的临时配置：只取认识的三个字符串字段 */
export function optionalProxyOverride(
  v: unknown,
): { mode?: string; customUrl?: string; bypassRules?: string } | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error("无效的代理配置");
  const o = v as Record<string, unknown>;
  const out: { mode?: string; customUrl?: string; bypassRules?: string } = {};
  for (const [key, max] of [
    ["mode", 32],
    ["customUrl", 2048],
    ["bypassRules", 8192],
  ] as const) {
    const val = o[key];
    if (val === undefined || val === null) continue;
    if (typeof val !== "string" || val.length > max) throw new Error("无效的代理配置");
    out[key] = val;
  }
  return out;
}
