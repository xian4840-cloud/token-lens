import type { LocalSource } from "@/types";

/** 本地 agent 来源的展示元数据（图表系列顺序与配色、页面共用） */
export const LOCAL_SOURCES: { value: LocalSource; label: string }[] = [
  { value: "claude-code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
  { value: "antigravity", label: "Antigravity" },
];

export const LOCAL_SOURCE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
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
  /** 当日全部来源合计 input */
  input?: number;
  /** 当日全部来源合计 output（含推理） */
  output?: number;
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
