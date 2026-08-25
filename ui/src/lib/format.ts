/** 金额格式化：根据币种加符号，保留两位小数 */
export function formatMoney(n: number | undefined, currency = "USD"): string {
  if (n == null || Number.isNaN(n)) return "—";
  const symbol = currency === "USD" ? "$" : currency === "CNY" ? "¥" : "";
  return `${symbol}${n.toFixed(2)}`;
}

/** 余额数值格式化：金额用货币符号，tokens/Credits 等计量单位用简写加单位 */
export function formatBalance(n: number | undefined, currency: string): string {
  if (n == null || Number.isNaN(n)) return "-";
  if (currency === "tokens") return `${formatTokens(n)} tokens`;
  if (currency === "%") return `${n.toFixed(1)}%`;
  if (currency === "USD" || currency === "CNY") return formatMoney(n, currency);
  // 其余为计量单位（如 Credits）：大数简写并带单位，避免显示成无单位裸数字
  return `${formatTokens(n)} ${currency}`;
}

/**
 * 进度条已用占比（0-100）。
 * total 缺失或非正数时返回 0，避免除零产生 NaN 宽度。
 * 注意：须传 total 一起算，不可直接把 used 当百分比——只有 total 恰为 100
 * 的服务（如火山方舟按 Percent 计）才碰巧成立。
 */
export function usedPercent(
  used: number | undefined,
  total: number | undefined,
): number {
  if (used == null || total == null) return 0;
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

/** token 数量简写：1.2K / 3.4M / 5.6B */
export function formatTokens(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

/** token 数量中文简写：1.2万 / 3.4亿（满 1 亿转亿，均留 1 位小数） */
export function formatTokensCn(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "-";
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (abs >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return String(n);
}

/** 时间格式化（中文，月日时分） */
export function formatTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
