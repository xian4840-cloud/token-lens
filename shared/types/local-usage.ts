/** 本地 agent 用量（Claude Code / Codex / OpenCode / Antigravity / Grok Build） */

/** 数据来源。新增成员时记得同步 electron/local-usage/types.ts 的 SOURCE_TABLE（有编译期检查） */
export type LocalSource = "claude-code" | "codex" | "opencode" | "antigravity" | "grok-build";

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

/** 持久化的本地 agent 每日用量（每条对应某 source+model+date） */
export interface LocalDailyUsageRecord {
  id: number;
  source: LocalSource;
  model: string;
  /** 日期键 YYYY-MM-DD（本地时区） */
  date: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  cost: number | null;
  currency: string | null;
  /** 当日该桶最早 / 最晚记录时间（ISO） */
  firstAt: string | null;
  lastAt: string | null;
  /** 该日数据最后被扫描确认的时间 */
  scannedAt: string;
}
