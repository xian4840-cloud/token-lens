/**
 * 敏感信息脱敏。
 *
 * 存在的理由：日志会落盘、也会被用户直接发给我们排查问题，所以密钥绝不能
 * 出现在日志文本里。脱敏必须做在**写入层**——靠事后打码等于赌没漏。
 *
 * 已知的两条泄露路径（都真实存在过）：
 * 1. Gemini 把 key 拼在 URL 查询串（?key=AIza...），而非放 Authorization 头；
 * 2. fetchWithTimeout 超时错误消息里带完整 url。
 * 两者一叠加，Gemini 请求超时的错误消息里就是明文 key。
 *
 * 原则是**宁可多打码**：日志的用途是定位「哪个服务、哪一步、什么错」，
 * 密钥本身对排查毫无价值，打掉不损失任何信息。
 */

/** 打码后的占位符，统一成一个便于在日志里搜索 */
const MASK = "[已隐去]";

/**
 * URL 查询参数里的密钥类字段。
 * 命中即整值打码，不保留前后缀——前缀（如 AIza / sk-）本身就能指认平台。
 */
const SENSITIVE_QUERY_KEYS = new Set([
  "key",
  "apikey",
  "api_key",
  "access_token",
  "accesstoken",
  "token",
  "secret",
  "password",
  "signature",
  "authorization",
]);

/**
 * 各家密钥的字面量特征。用于兜住不在 URL 查询串、也不在 Authorization 头，
 * 而是被拼进自由文本的情况（例如某个适配器把响应体原样塞进错误消息）。
 *
 * 长度下界给得比真实密钥略短，宁可误伤普通字符串也不能漏。
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI / DeepSeek / 硅基流动 / Kimi / Anthropic
  /\bgsk_[A-Za-z0-9]{16,}/g, // Groq
  /\bAIza[A-Za-z0-9_-]{16,}/g, // Google
  /\bLTAI[A-Za-z0-9]{12,}/g, // 阿里云 AccessKeyId
  /\bAKLT[A-Za-z0-9_-]{12,}/g, // 火山引擎 AccessKeyId
  /\bghp_[A-Za-z0-9]{16,}/g, // GitHub
  /\bgho_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bxoxb-[A-Za-z0-9-]{16,}/g, // Slack（用户可能贴第三方日志进来）
];

/** HTTP 头里需要打码的名字（大小写不敏感） */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "proxy-authorization",
]);

/**
 * 脱敏 URL：打掉查询串里的密钥参数，其余原样保留（路径与主机名是排查所需）。
 *
 * 解析失败时不返回原串——那正是最危险的情况（畸形 URL 里照样可能带 key），
 * 退化为按文本规则脱敏。
 */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    let touched = false;
    for (const name of Array.from(u.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.has(name.toLowerCase())) {
        u.searchParams.set(name, MASK);
        touched = true;
      }
    }
    // URL 里的 user:password@host 形式同样要打掉
    if (u.password) {
      u.password = MASK;
      touched = true;
    }
    const out = touched ? u.toString() : url;
    // searchParams.set 会把 MASK 的方括号百分号编码，还原成可读形式
    return redactText(out.replace(/%5B%E5%B7%B2%E9%9A%90%E5%8E%BB%5D/g, MASK));
  } catch {
    return redactText(url);
  }
}

/**
 * 脱敏任意文本：先打掉 URL 查询串里的密钥参数，再套用密钥字面量规则。
 *
 * 顺序要紧：先处理 ?key= 形式，避免值被字面量规则切成半截后
 * 反而留下可辨识的片段。
 */
export function redactText(text: string): string {
  let out = text;
  // 文本里内嵌的 URL 查询参数（可能并非完整合法 URL，故用正则而非 URL 解析）
  out = out.replace(
    /([?&])([A-Za-z_][A-Za-z0-9_-]*)=([^&\s"'\\]+)/g,
    (whole, sep: string, name: string, value: string) =>
      SENSITIVE_QUERY_KEYS.has(name.toLowerCase())
        ? `${sep}${name}=${MASK}`
        : whole,
  );
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, MASK);
  }
  // Bearer / Basic 之后的凭据整体打掉（不限定字符集，兜住非常规 token）
  out = out.replace(/\b(Bearer|Basic)\s+[^\s"',}]+/gi, `$1 ${MASK}`);
  return out;
}

/**
 * 脱敏错误对象。
 *
 * 会一并展开 cause 链：undici（Node 内置 fetch）把网络层故障统一包成
 * `TypeError: fetch failed`，真正的原因（ECONNREFUSED / ENOTFOUND /
 * 证书错误 / 代理拒绝）全在 cause 里。只取 message 的话日志上只剩一句
 * 「fetch failed」，等于什么都没记。
 *
 * cause 深度设了上限，防御自引用的 cause 造成死循环。
 */
export function redactError(e: unknown, depth = 0): string {
  const MAX_CAUSE_DEPTH = 4;
  if (e instanceof Error) {
    const name = e.name && e.name !== "Error" ? `${e.name}: ` : "";
    let out = `${name}${redactText(e.message)}`;
    // Node 的网络错误把 code/errno 挂在错误对象上，对定位极有用
    const withCode = e as Error & { code?: unknown; errno?: unknown };
    if (typeof withCode.code === "string") out += ` [${withCode.code}]`;
    const cause = (e as Error & { cause?: unknown }).cause;
    if (cause != null && depth < MAX_CAUSE_DEPTH) {
      out += ` ← ${redactError(cause, depth + 1)}`;
    }
    return out;
  }
  return redactText(String(e));
}

/**
 * 脱敏请求头对象，用于记录请求上下文。
 * 白名单式思路不可行（头名字五花八门），故按敏感名单打码。
 */
export function redactHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? MASK : redactText(v);
  }
  return out;
}

export { MASK as REDACTION_MASK };
