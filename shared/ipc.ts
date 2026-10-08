/**
 * IPC 契约：通道名 + 参数 / 返回值类型的唯一定义处。
 *
 * 主进程（electron/ipc.ts、electron/pet/ipc.ts 注册处理函数）、两个 preload
 * （electron/preload.ts、electron/pet-preload.ts 暴露 window.tokenLens）和界面
 * （ui/src/lib/ipc.ts、ui/src/types/global.d.ts）都从这里取类型，不再各写一份。
 *
 * 两个 preload 跑在沙箱里，只能 require("electron")，不能加载 shared/ 下的运行时代码，
 * 所以 preload 与主进程都直接写通道名字面量，由 InvokeChannel 等类型在编译期校验；
 * 通道表 INVOKE_CHANNELS 等是唯一的名单，测试据此核对 preload 的方法与通道一一对应。
 *
 * 新增 / 修改一个通道：
 * 1. 在 InvokeApi（或 EventPayloads / SendApi）里加方法签名，在对应的通道表里加通道名；
 * 2. 编译器会要求 preload 暴露它（类型为 TokenLensApi / TokenLensPetApi），
 *    并检查主进程处理函数的返回值与签名一致；界面侧不用改。
 *
 * 主进程收到的参数一律视为 unknown 自行校验（渲染进程不可信），所以处理函数只对返回值做类型约束。
 * 本文件只放类型和常量，不 import electron / DOM / node 模块。
 */
import type {
  AppBootstrap,
  BackupImportResult,
  BackupPreview,
  BalanceResult,
  BalanceSnapshot,
  BalanceUpdatedPayload,
  CaptureRemovalResult,
  ClearLocalUsageCacheResult,
  CodexCaptureState,
  DataStats,
  HighRiskResult,
  ImportLocalRowsResult,
  LocalDailyUsageRecord,
  LogEntry,
  ModelMonitorSource,
  ModelMonitorState,
  ModelPricing,
  PetActivity,
  PetSpendSummary,
  PricingRowDisplay,
  ProxyConfigOverride,
  ProxyTestResult,
  ScanLocalUsageResult,
  ScnetLoginResult,
  ServiceDefinition,
  ServiceInput,
  ServiceRecord,
  UsageRecord,
  UsageResult,
  VolcengineLoginResult,
} from "./types";

/** 渲染进程 invoke、主进程 handle 的请求：方法名 -> 签名（返回值是主进程处理函数的结果） */
export interface InvokeApi {
  // 模型监测；后五个是高危操作，主进程先弹系统确认框
  getModelMonitorState(date?: string, source?: ModelMonitorSource): ModelMonitorState;
  launchCapturedCodex(): HighRiskResult<CodexCaptureState>;
  enableOpenCodeCapture(): HighRiskResult<void>;
  enableClaudeCapture(): HighRiskResult<void>;
  disableOpenCodeCapture(): HighRiskResult<CaptureRemovalResult>;
  disableClaudeCapture(): HighRiskResult<CaptureRemovalResult>;

  // 应用 / 数据
  ping(): string;
  isEncryptionAvailable(): boolean;
  bootstrap(): AppBootstrap;
  revealUserData(): boolean;
  backupJson(): string;
  previewBackup(raw: string): BackupPreview;
  importBackup(raw: string): BackupImportResult;
  dataStats(): DataStats;
  importLocalRows(rows: unknown[]): ImportLocalRowsResult;
  saveText(defaultName: string, content: string): boolean;

  // 服务与余额 / 用量
  listDefinitions(): ServiceDefinition[];
  listServices(): ServiceRecord[];
  createService(input: ServiceInput): ServiceRecord;
  updateService(id: string, input: ServiceInput): ServiceRecord | undefined;
  deleteService(id: string): boolean;
  refreshService(id: string): BalanceResult;
  listSnapshots(serviceId?: string, since?: string): BalanceSnapshot[];
  refreshUsage(id: string, period: { start: string; end: string }): UsageResult;
  listUsage(serviceId?: string, since?: string): UsageRecord[];

  // 设置 / 价格 / 本地用量 / 登录 / 代理
  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string): boolean;
  getPricingTable(): PricingRowDisplay[];
  savePricingOverrides(value: Record<string, Partial<ModelPricing>>): boolean;
  scanLocalUsage(since?: string): ScanLocalUsageResult;
  listLocalDaily(since?: string, until?: string): LocalDailyUsageRecord[];
  clearLocalUsageCache(): ClearLocalUsageCacheResult;
  loginVolcengine(): VolcengineLoginResult | null;
  loginScnet(): ScnetLoginResult | null;
  testProxy(override?: ProxyConfigOverride): ProxyTestResult;

  // 日志：只读 + 打开文件夹 + 清空。刻意不提供上传接口，
  // 日志发不发、发给谁由用户自己决定（见 README 隐私说明）。
  getRecentLogs(): LogEntry[];
  getLogPath(): string;
  revealLogFile(): boolean;
  clearLogs(): boolean;
  reportRendererError(message: string): boolean;

  // 桌宠：开关由主窗口设置页调用，其余只对桌宠窗口开放
  getPetEnabled(): boolean;
  setPetEnabled(enabled: boolean): boolean;
  petTodaySpend(): PetSpendSummary;
  getPetActivity(): PetActivity;
}

/** invoke 通道名。satisfies 保证与 InvokeApi 一一对应（漏写 / 多写都编译不过） */
export const INVOKE_CHANNELS = {
  getModelMonitorState: "model-monitor:state",
  launchCapturedCodex: "model-monitor:launch-codex",
  enableOpenCodeCapture: "model-monitor:enable-opencode",
  enableClaudeCapture: "model-monitor:enable-claude",
  disableOpenCodeCapture: "model-monitor:disable-opencode",
  disableClaudeCapture: "model-monitor:disable-claude",

  ping: "app:ping",
  isEncryptionAvailable: "encryption:available",
  bootstrap: "app:bootstrap",
  revealUserData: "app:reveal-user-data",
  backupJson: "app:backup-json",
  previewBackup: "app:preview-backup",
  importBackup: "app:import-backup",
  dataStats: "app:stats",
  importLocalRows: "local-usage:import-rows",
  saveText: "app:save-text",

  listDefinitions: "services:definitions",
  listServices: "services:list",
  createService: "services:create",
  updateService: "services:update",
  deleteService: "services:delete",
  refreshService: "services:refresh",
  listSnapshots: "snapshots:list",
  refreshUsage: "usage:refresh",
  listUsage: "usage:list",

  getSetting: "settings:get",
  setSetting: "settings:set",
  getPricingTable: "pricing:get",
  savePricingOverrides: "pricing:set",
  scanLocalUsage: "local-usage:scan",
  listLocalDaily: "local-daily:list",
  clearLocalUsageCache: "local-usage:clear-cache",
  loginVolcengine: "auth:volcengine-login",
  loginScnet: "auth:scnet-login",
  testProxy: "proxy:test",

  getRecentLogs: "logs:recent",
  getLogPath: "logs:path",
  revealLogFile: "logs:reveal",
  clearLogs: "logs:clear",
  reportRendererError: "logs:report-renderer-error",

  getPetEnabled: "pet:getEnabled",
  setPetEnabled: "pet:setEnabled",
  petTodaySpend: "pet:todaySpend",
  getPetActivity: "pet:getActivity",
} as const satisfies Record<keyof InvokeApi, string>;

/** 主进程推给渲染进程的事件：事件名 -> 负载 */
export interface EventPayloads {
  localUsageUpdated: void;
  balanceUpdated: BalanceUpdatedPayload;
  petActivity: PetActivity;
  petSpendUpdated: PetSpendSummary;
}

export const EVENT_CHANNELS = {
  localUsageUpdated: "local-usage:updated",
  balanceUpdated: "balance:updated",
  petActivity: "pet:activity",
  petSpendUpdated: "pet:spend-updated",
} as const satisfies Record<keyof EventPayloads, string>;

/** 渲染进程 send（不等返回）的消息：桌宠拖动 */
export interface SendApi {
  petDragStart(): void;
  petDragMove(): void;
  petDragEnd(): void;
}

export const SEND_CHANNELS = {
  petDragStart: "pet:drag-start",
  petDragMove: "pet:drag-move",
  petDragEnd: "pet:drag-end",
} as const satisfies Record<keyof SendApi, string>;

/* ───────────── 由上面推导出的类型 ───────────── */

export type InvokeMethod = keyof InvokeApi;
export type InvokeChannel = (typeof INVOKE_CHANNELS)[InvokeMethod];
export type EventName = keyof EventPayloads;
export type EventChannel = (typeof EVENT_CHANNELS)[EventName];
export type SendChannel = (typeof SEND_CHANNELS)[keyof SendApi];

type InvokeMethodOf<C extends InvokeChannel> = {
  [M in InvokeMethod]: (typeof INVOKE_CHANNELS)[M] extends C ? M : never;
}[InvokeMethod];
type EventNameOf<C extends EventChannel> = {
  [E in EventName]: (typeof EVENT_CHANNELS)[E] extends C ? E : never;
}[EventName];

/** 某 invoke 通道的参数（渲染进程侧） */
export type InvokeArgs<C extends InvokeChannel> = Parameters<InvokeApi[InvokeMethodOf<C>]>;
/** 某 invoke 通道的处理函数应返回的值（可以是 Promise） */
export type InvokeResult<C extends InvokeChannel> = ReturnType<InvokeApi[InvokeMethodOf<C>]>;
/** 某事件通道的负载 */
export type EventPayload<C extends EventChannel> = EventPayloads[EventNameOf<C>];

/** 渲染进程看到的 invoke 方法：同签名，返回 Promise */
type Invoker<M extends InvokeMethod> = (...args: Parameters<InvokeApi[M]>) => Promise<ReturnType<InvokeApi[M]>>;
type Invokers<M extends InvokeMethod> = { [K in M]: Invoker<K> };
/** 订阅事件，返回取消订阅函数 */
type Subscriber<E extends EventName> = (
  cb: EventPayloads[E] extends void ? () => void : (payload: EventPayloads[E]) => void,
) => () => void;

/** 只对桌宠窗口开放的 invoke 方法 */
export type PetOnlyInvokeMethod = "petTodaySpend" | "getPetActivity";

/** 主窗口 window.tokenLens（electron/preload.ts） */
export type TokenLensApi = Invokers<Exclude<InvokeMethod, PetOnlyInvokeMethod>> & {
  onLocalUsageUpdated: Subscriber<"localUsageUpdated">;
  onBalanceUpdated: Subscriber<"balanceUpdated">;
};

/** 桌宠窗口 window.tokenLens（electron/pet-preload.ts）：只有它真正用到的几项 */
export type TokenLensPetApi = Invokers<PetOnlyInvokeMethod | "reportRendererError"> &
  SendApi & {
    onPetActivity: Subscriber<"petActivity">;
    onPetSpendUpdated: Subscriber<"petSpendUpdated">;
  };
