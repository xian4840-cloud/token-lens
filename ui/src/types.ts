/** 服务与适配器的共享类型定义（前端） */

export type ServiceKind = "api" | "plan";

export type LogLevel = "info" | "warn" | "error";

/**
 * 一条日志。与 electron/lib/logger.ts 的 LogEntry 保持一致，改动需同步两处。
 * 前端不能直接从主进程导入类型（构建目标不同），故此处重复声明。
 */
export interface LogEntry {
  time: string;
  level: LogLevel;
  scope: string;
  message: string;
}

export type ConfigFieldType = "string" | "password" | "select" | "number";

export interface ConfigField {
  key: string;
  label: string;
  type: ConfigFieldType;
  placeholder?: string;
  options?: { label: string; value: string }[];
  required?: boolean;
  help?: string;
  secret?: boolean;
}

export interface ServiceDefinition {
  provider: string;
  label: string;
  kind: ServiceKind;
  configSchema: ConfigField[];
  official: boolean;
  description?: string;
  /** 是否支持用量明细查询（实现了 fetchUsage） */
  supportsUsage?: boolean;
}

export interface ServiceRecord {
  id: string;
  name: string;
  provider: string;
  kind: ServiceKind;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BreakdownItem {
  label: string;
  used?: number;
  total?: number;
  remaining?: number;
  unit?: string;
  resetAt?: string;
}

export interface BalanceSnapshot {
  id: number;
  serviceId: string;
  balance: number | null;
  currency: string;
  recordedAt: string;
}

export interface BalanceResult {
  total?: number;
  used?: number;
  remaining?: number;
  currency: string;
  expiresAt?: string;
  fetchedAt: string;
  raw?: unknown;
  breakdown?: BreakdownItem[];
  /**
   * 无数字可展示时（total / used / remaining 全缺）卡片主位显示的文案。
   * 供仅能校验 Key 有效性的适配器说明「查不到数字」的原因，
   * 不要在此断言服务是否免费——多数服务同时有免费与付费档。
   */
  statusLabel?: string;
}

export interface UsageItem {
  model: string;
  normalizedModel?: string;
  cost?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface UsageResult {
  items: UsageItem[];
  periodStart?: string;
  periodEnd?: string;
  currency?: string;
  fetchedAt: string;
}

/** 持久化的用量记录（每条对应某服务某周期某模型） */
export interface UsageRecord {
  id: number;
  serviceId: string;
  model: string | null;
  normalizedModel: string | null;
  cost: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  period: string | null;
  currency: string | null;
  recordedAt: string;
}

export interface ServiceInput {
  name: string;
  provider: string;
  fields: Record<string, string>;
}

export interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM?: number;
  cacheWritePerM?: number;
  currency?: string;
}

export interface PricingRowDisplay {
  key: string;
  label: string;
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;
  currency: string;
}

/** 本地 agent 用量采集（阶段 10），镜像主进程 electron/local-usage/types */
export type LocalSource = "claude-code" | "codex" | "opencode" | "antigravity";

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
  reasoningTokens: number;
  /** 换算费用；价格表匹配不到时为 undefined */
  cost?: number;
  currency?: string;
  /** 当日该桶最早 / 最晚记录时间（ISO） */
  firstAt?: string;
  lastAt?: string;
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

export interface ScanLocalUsageResult {
  rows: LocalUsageRow[];
  unavailable: { source: LocalSource; reason: string }[];
}

export type ProxyMode = "system" | "custom" | "direct";

export interface ProxyTestTargetResult {
  name: string;
  url: string;
  ok: boolean;
  latencyMs: number;
  statusText?: string;
  error?: string;
}

export interface ProxyTestResult {
  targets: ProxyTestTargetResult[];
}

