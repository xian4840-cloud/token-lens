/** 模型监测（请求模型 vs 实际响应模型）与采集开关 */

export type ModelMonitorSource =
  "codex" | "claude-code" | "opencode" | "grok-build" | "antigravity";

export interface ModelMonitorSession {
  id: string;
  name: string;
  modifiedAt: string;
  archived: boolean;
}

export interface ModelMonitorRecord {
  id: string;
  startedAt: string;
  requestedModel?: string;
  responseModel?: string;
  sentModel?: string;
  matchedCalls?: number;
  mismatchedCalls?: number;
  unverifiedCalls?: number;
  responseCalls?: number;
  responseId?: string;
  reportedModel?: string;
  evidence?: "response" | "assistant-message" | "generation-response" | "usage" | "selection";
  modelCalls?: number;
  status: "match" | "mismatch" | "unknown";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  sessionId?: string;
  sessionName?: string;
  archived?: boolean;
}

export interface ModelMonitorDay {
  date: string;
  sessionCount: number;
  callCount: number;
  totalTokens: number;
  verifiedCount: number;
  mismatchCount: number;
  unknownCount: number;
  responseCount: number;
  models: string[];
}

export interface ModelMonitorSessionDay {
  sessionId: string;
  name: string;
  model?: string;
  modelBasis?: "request" | "response" | "unknown";
  callCount: number;
  matchedCount: number;
  mismatchedCount: number;
  unknownCount: number;
  totalTokens: number;
}

/** Codex 桌面版实时采集的状态 */
export interface CodexCaptureState {
  supported: boolean;
  ready: boolean;
  active: boolean;
  responseCount: number;
  lastResponseAt?: string;
  error?: string;
}

export interface ModelMonitorState {
  source: ModelMonitorSource;
  description?: string;
  root: string;
  scannedAt: string;
  sessions: ModelMonitorSession[];
  days: ModelMonitorDay[];
  selectedDate?: string;
  callCount: number;
  records: ModelMonitorRecord[];
  sessionDays?: ModelMonitorSessionDay[];
  agentCapture?: {
    enabled: boolean;
    /** 本机还留有任何一项我们写下的采集文件 / 环境变量（可「关闭采集」） */
    installed?: boolean;
    requestCount: number;
    responseCount: number;
  };
  capture: CodexCaptureState;
  unavailable?: string;
}

/**
 * 高危操作（启用 / 关闭采集、启动 Codex 并采集）的返回值。主进程先弹系统确认框：
 * - ok：用户点了「继续」，操作已执行，value 是原来的返回值；
 * - cancelled：用户取消，什么都没做；
 * - confirm-pending：已有一个确认框开着，本次请求被直接拒绝（不排队）。
 */
export type HighRiskResult<T> =
  { status: "ok"; value: T } | { status: "cancelled" } | { status: "confirm-pending" };

/** 「关闭采集」的结果 */
export interface CaptureRemovalResult {
  /** 已删除 / 已还原的项 */
  removed: string[];
  /** 存在但判断不是我们写的、或目录里还有别的文件，因而保留的项 */
  kept: string[];
}
