/** 本地 agent 用量采集（阶段 10）。
 *
 * 扫描本地 AI coding agent（Claude Code / Codex / OpenCode / Antigravity / Grok Build）
 * 的使用记录，按模型聚合 token，用价格表换算费用。数据全在本地文件，无需 API key / 代理 / 抓包。
 */

/** 数据来源 */
export type LocalSource =
  | "claude-code"
  | "codex"
  | "opencode"
  | "antigravity"
  | "grok-build";

/**
 * 全部来源，顺序即界面展示顺序。
 *
 * 写成 satisfies Record<LocalSource, true> 而不是裸数组，是为了拿到编译期的
 * 穷尽性检查：将来给 LocalSource 加成员却忘了加到这里，tsc 会直接报错。
 * 裸数组做不到这一点——漏一个成员，类型层面完全看不出来，而后果是静默的：
 * 该来源的用量永远不会落盘，趋势图上凭空少一块，也没有任何报错。
 */
const SOURCE_TABLE = {
  "claude-code": true,
  codex: true,
  opencode: true,
  antigravity: true,
  "grok-build": true,
} satisfies Record<LocalSource, true>;

export const ALL_LOCAL_SOURCES = Object.keys(SOURCE_TABLE) as LocalSource[];

/** 单行聚合：某来源某模型的用量汇总 */
export interface LocalUsageRow {
  source: LocalSource;
  model: string;
  /** 日期键 YYYY-MM-DD（本地时区当日），按天分桶 */
  date: string;
  /** 会话数（文件数 / session 数） */
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** 推理 token（Codex/OpenCode 有，Claude Code 无） */
  reasoningTokens: number;
  /** 换算费用；价格表匹配不到时为 undefined */
  cost?: number;
  currency?: string;
  /** 当日该桶最早 / 最晚记录时间（ISO） */
  firstAt?: string;
  lastAt?: string;
}

/** scanLocalUsage 返回：可用来源的聚合行 + 不可用来源的提示 */
export interface ScanLocalUsageResult {
  rows: LocalUsageRow[];
  unavailable: { source: LocalSource; reason: string }[];
}
