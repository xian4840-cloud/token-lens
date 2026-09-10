import type { LocalDailyUsageRecord, LocalSource } from "@/types";
import { formatDateKey, visibleTokens } from "./format";

/**
 * 来源展示名。写成 satisfies Record<LocalSource, string> 而非裸数组，
 * 是为了拿到编译期穷尽性检查：将来给 LocalSource 加成员却忘了加到这里，
 * tsc 会直接报错。裸数组漏一个成员的后果是静默的——趋势图上少一条系列，
 * 没有任何报错。
 */
const SOURCE_LABELS = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  "grok-build": "Grok Build",
} satisfies Record<LocalSource, string>;

/** 本地 agent 来源的展示元数据（图表系列顺序与配色、页面共用） */
export const LOCAL_SOURCES: { value: LocalSource; label: string }[] = (
  Object.keys(SOURCE_LABELS) as LocalSource[]
).map((value) => ({ value, label: SOURCE_LABELS[value] }));

export const LOCAL_SOURCE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export const LOCAL_SOURCE_LABEL: Record<LocalSource, string> =
  Object.fromEntries(LOCAL_SOURCES.map((s) => [s.value, s.label])) as Record<
    LocalSource,
    string
  >;

/** 某来源某天使用的单个模型用量 */
export type DailyModelUsage = { model: string; tokens: number };

/** 本地 agent 每日柱状图的宽表行（Recharts data 用） */
export interface DailyUsageRow {
  date: string;
  /** 当日全部来源合计 input（不含缓存） */
  input?: number;
  /** 当日全部来源合计 output（含推理） */
  output?: number;
  /** 当日全部来源合计缓存读取 */
  cacheRead?: number;
  /** 当日全部来源合计缓存写入 */
  cacheCreation?: number;
  /** 当日全部来源合计总 tokens */
  total?: number;
  /** 各来源当日按模型分项（按用量降序） */
  models?: Record<string, DailyModelUsage[]>;
  [key: string]:
    | number
    | string
    | undefined
    | Record<string, DailyModelUsage[]>;
}

/** 本地用量的图表指标：token 数或费用 */
export type LocalMetric = "tokens" | "cost";

/**
 * 把本地每日用量记录透视为图表宽表（按 date 分组，按 source 堆叠）。
 *
 * 用量页与趋势页原本各写了一份几乎逐行相同的实现。同一个日聚合抄两遍，
 * 改一处漏一处只是时间问题——本项目已经因为「同一份数据的两个口径」出过
 * 三次 bug，合成一份之后「各分项之和等于合计」这类不变量才有一处可测。
 *
 * metric="cost" 时只填各来源的金额列，不填 input/output/total——
 * 那些是 token 维度的量，与金额混在一行里没有意义。
 */
export function pivotDailyUsage(
  records: LocalDailyUsageRecord[],
  metric: LocalMetric = "tokens",
): DailyUsageRow[] {
  const byDate = new Map<string, DailyUsageRow>();
  for (const r of records) {
    const total = visibleTokens(r);
    const val = metric === "tokens" ? total : (r.cost ?? 0);
    const row = byDate.get(r.date) ?? { date: formatDateKey(r.date) };
    row[r.source] = ((row[r.source] as number | undefined) ?? 0) + val;
    if (metric === "tokens") {
      row.input = (row.input ?? 0) + r.inputTokens;
      row.output = (row.output ?? 0) + r.outputTokens + r.reasoningTokens;
      row.cacheRead = (row.cacheRead ?? 0) + r.cacheReadTokens;
      row.cacheCreation = (row.cacheCreation ?? 0) + r.cacheCreationTokens;
      row.total = (row.total ?? 0) + total;
      const models = row.models ?? {};
      const list = models[r.source] ?? [];
      const found = list.find((m) => m.model === r.model);
      if (found) found.tokens += total;
      else list.push({ model: r.model, tokens: total });
      models[r.source] = list;
      row.models = models;
    }
    byDate.set(r.date, row);
  }
  // 模型分项按用量降序，最常用的排前面
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => ({
      ...v,
      models: Object.fromEntries(
        Object.entries(v.models ?? {}).map(([source, list]) => [
          source,
          [...list].sort((a, b) => b.tokens - a.tokens),
        ]),
      ),
    }));
}
