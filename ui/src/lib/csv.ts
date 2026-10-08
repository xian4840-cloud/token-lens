import type { LocalSource, PricingRowDisplay } from "@/types";
import { LOCAL_SOURCES } from "./local-sources";

/** 把表格编成 CSV 文本（含 BOM，Excel 打开中文不乱码） */
export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const esc = (v: string | number | null | undefined): string => {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))];
  return `\uFEFF${lines.join("\r\n")}`;
}

export type ParsedCsv = { ok: true; rows: string[][] } | { ok: false; error: string };

/**
 * 解析 CSV（含 BOM、引号转义、CRLF）。
 * 引号未闭合直接失败，不把半截字段当成功。
 */
export function parseCsv(text: string): ParsedCsv {
  const src = text.replace(/^\uFEFF/, "");
  if (src.trim() === "") return { ok: false, error: "文件为空" };

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\n" || c === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (c === "\r" && src[i + 1] === "\n") i += 1;
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }

  if (inQuotes) return { ok: false, error: "CSV 引号未闭合" };
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { ok: true, rows };
}

const PRICE_FIELDS = ["inputPerM", "outputPerM", "cacheReadPerM", "cacheWritePerM"] as const;

type PriceField = (typeof PRICE_FIELDS)[number];

export type PricingCsvApplyResult =
  | {
      ok: true;
      rows: PricingRowDisplay[];
      applied: number;
      unknownKeys: string[];
      invalid: string[];
    }
  | { ok: false; error: string };

function colIndex(headers: string[], name: string): number {
  const want = name.trim().toLowerCase();
  return headers.findIndex((h) => h.trim().toLowerCase() === want);
}

function parsePriceCell(
  raw: string | undefined,
): { ok: true; value: number | undefined } | { ok: false } {
  if (raw == null) return { ok: true, value: undefined };
  const s = raw.trim();
  if (s === "") return { ok: true, value: undefined };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

function rowOverridden(row: PricingRowDisplay): boolean {
  if (!row.defaults) return true;
  return (
    row.inputPerM !== row.defaults.inputPerM ||
    row.outputPerM !== row.defaults.outputPerM ||
    row.cacheReadPerM !== row.defaults.cacheReadPerM ||
    row.cacheWritePerM !== row.defaults.cacheWritePerM
  );
}

/**
 * 把价格表 CSV 套到当前草稿。
 *
 * - 按 `key` 匹配已有行，不认识的 key 不新增（避免未知模型被写成 $0）
 * - 空单元格保持原值，不把空白当成 0
 * - 非法数字记进 invalid，不静默丢掉
 */
export function applyPricingCsv(
  current: PricingRowDisplay[],
  csvText: string,
): PricingCsvApplyResult {
  const parsed = parseCsv(csvText);
  if (!parsed.ok) return parsed;
  if (parsed.rows.length < 2) return { ok: false, error: "没有数据行" };

  const headers = parsed.rows[0] ?? [];
  const keyCol = colIndex(headers, "key");
  if (keyCol < 0) return { ok: false, error: "缺少 key 列" };

  const priceCols: Partial<Record<PriceField, number>> = {};
  for (const f of PRICE_FIELDS) {
    const i = colIndex(headers, f);
    if (i >= 0) priceCols[f] = i;
  }
  if (Object.keys(priceCols).length === 0) {
    return { ok: false, error: "缺少价格列" };
  }

  const byKey = new Map(current.map((r) => [r.key, { ...r }]));
  const unknownKeys: string[] = [];
  const invalid: string[] = [];
  let applied = 0;
  const seenUnknown = new Set<string>();

  for (let r = 1; r < parsed.rows.length; r++) {
    const cells = parsed.rows[r] ?? [];
    if (cells.every((c) => c.trim() === "")) continue;
    const key = (cells[keyCol] ?? "").trim();
    if (!key) {
      invalid.push(`第 ${r + 1} 行缺少 key`);
      continue;
    }
    const row = byKey.get(key);
    if (!row) {
      if (!seenUnknown.has(key)) {
        seenUnknown.add(key);
        unknownKeys.push(key);
      }
      continue;
    }

    const patch: Partial<Record<PriceField, number>> = {};
    let bad = false;
    for (const f of PRICE_FIELDS) {
      const ci = priceCols[f];
      if (ci == null) continue;
      const parsedCell = parsePriceCell(cells[ci]);
      if (!parsedCell.ok) {
        invalid.push(`第 ${r + 1} 行 ${f} 不是有效价格`);
        bad = true;
        break;
      }
      if (parsedCell.value !== undefined) patch[f] = parsedCell.value;
    }
    if (bad) continue;
    if (Object.keys(patch).length === 0) continue;

    const next: PricingRowDisplay = { ...row, ...patch };
    next.overridden = rowOverridden(next);
    byKey.set(key, next);
    applied += 1;
  }

  return {
    ok: true,
    rows: current.map((r) => byKey.get(r.key) ?? r),
    applied,
    unknownKeys,
    invalid,
  };
}

export interface LocalCsvRow {
  source: LocalSource;
  model: string;
  date: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  cost?: number;
  currency?: string;
}

export type LocalCsvApplyResult =
  | {
      ok: true;
      rows: LocalCsvRow[];
      unknownSources: string[];
      invalid: string[];
    }
  | { ok: false; error: string };

const LOCAL_HEADER_ALIASES: Record<string, string[]> = {
  date: ["日期", "date"],
  source: ["来源", "source"],
  model: ["模型", "model"],
  sessions: ["会话", "sessions"],
  inputTokens: ["输入", "input", "inputtokens"],
  outputTokens: ["输出", "output", "outputtokens"],
  cacheCreationTokens: ["缓存写", "cachecreation", "cachecreationtokens"],
  cacheReadTokens: ["缓存读", "cacheread", "cachereadtokens"],
  reasoningTokens: ["推理", "reasoning", "reasoningtokens"],
  cost: ["费用", "cost"],
  currency: ["币种", "currency"],
};

function findCol(headers: string[], aliases: string[]): number {
  const lowered = headers.map((h) => h.trim().toLowerCase());
  for (const a of aliases) {
    const i = lowered.indexOf(a.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

function parseCountCell(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return 0;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

const KNOWN_SOURCES = new Set(LOCAL_SOURCES.map((s) => s.value));

/**
 * 解析用量页导出的本地 CSV。未知来源不写入（避免脏 source 污染图表），
 * 空费用保持缺省而不是 $0。
 */
export function applyLocalUsageCsv(csvText: string): LocalCsvApplyResult {
  const parsed = parseCsv(csvText);
  if (!parsed.ok) return parsed;
  if (parsed.rows.length < 2) return { ok: false, error: "没有数据行" };

  const headers = parsed.rows[0] ?? [];
  const cols = {
    date: findCol(headers, LOCAL_HEADER_ALIASES.date ?? []),
    source: findCol(headers, LOCAL_HEADER_ALIASES.source ?? []),
    model: findCol(headers, LOCAL_HEADER_ALIASES.model ?? []),
    sessions: findCol(headers, LOCAL_HEADER_ALIASES.sessions ?? []),
    inputTokens: findCol(headers, LOCAL_HEADER_ALIASES.inputTokens ?? []),
    outputTokens: findCol(headers, LOCAL_HEADER_ALIASES.outputTokens ?? []),
    cacheCreationTokens: findCol(headers, LOCAL_HEADER_ALIASES.cacheCreationTokens ?? []),
    cacheReadTokens: findCol(headers, LOCAL_HEADER_ALIASES.cacheReadTokens ?? []),
    reasoningTokens: findCol(headers, LOCAL_HEADER_ALIASES.reasoningTokens ?? []),
    cost: findCol(headers, LOCAL_HEADER_ALIASES.cost ?? []),
    currency: findCol(headers, LOCAL_HEADER_ALIASES.currency ?? []),
  };
  if (cols.date < 0 || cols.source < 0 || cols.model < 0) {
    return { ok: false, error: "缺少日期/来源/模型列" };
  }

  const rows: LocalCsvRow[] = [];
  const unknownSources: string[] = [];
  const invalid: string[] = [];
  const seenUnknown = new Set<string>();

  for (let r = 1; r < parsed.rows.length; r++) {
    const cells = parsed.rows[r] ?? [];
    if (cells.every((c) => c.trim() === "")) continue;
    const date = (cells[cols.date] ?? "").trim();
    const source = (cells[cols.source] ?? "").trim();
    const model = (cells[cols.model] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !model) {
      invalid.push(`第 ${r + 1} 行日期或模型无效`);
      continue;
    }
    if (!KNOWN_SOURCES.has(source as LocalSource)) {
      if (!seenUnknown.has(source)) {
        seenUnknown.add(source);
        unknownSources.push(source || "(空)");
      }
      continue;
    }
    const sessions = parseCountCell(cells[cols.sessions]);
    const inputTokens = parseCountCell(cells[cols.inputTokens]);
    const outputTokens = parseCountCell(cells[cols.outputTokens]);
    const cacheCreationTokens = parseCountCell(cells[cols.cacheCreationTokens]);
    const cacheReadTokens = parseCountCell(cells[cols.cacheReadTokens]);
    const reasoningTokens = parseCountCell(cells[cols.reasoningTokens]);
    if (
      sessions == null ||
      inputTokens == null ||
      outputTokens == null ||
      cacheCreationTokens == null ||
      cacheReadTokens == null ||
      reasoningTokens == null
    ) {
      invalid.push(`第 ${r + 1} 行 token 数非法`);
      continue;
    }
    let cost: number | undefined;
    if (cols.cost >= 0) {
      const raw = (cells[cols.cost] ?? "").trim();
      if (raw !== "") {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          invalid.push(`第 ${r + 1} 行费用非法`);
          continue;
        }
        cost = n;
      }
    }
    const currencyRaw = cols.currency >= 0 ? (cells[cols.currency] ?? "").trim() : "";
    rows.push({
      source: source as LocalSource,
      model,
      date,
      sessions,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      reasoningTokens,
      cost,
      currency: currencyRaw || undefined,
    });
  }

  return { ok: true, rows, unknownSources, invalid };
}
