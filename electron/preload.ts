import { contextBridge, ipcRenderer } from "electron";
import type { HighRiskResult } from "./lib/high-risk-confirm";
import type {
  AppBootstrap,
  BalanceResult,
  BalanceSnapshot,
  LocalDailyUsageRecord,
  ServiceDefinition,
  ServiceInput,
  ServiceRecord,
  UsageRecord,
  UsageResult,
  ProxyTestResult,
} from "./types";
import type { ModelPricing, PricingRowDisplay } from "./adapters/pricing";
import type { ScanLocalUsageResult } from "./local-usage/types";
import type { ProxyConfigOverride } from "./lib/http";
import type { LogEntry } from "./lib/logger";
import type { ModelMonitorState, ModelMonitorSource } from "./model-monitor";
import type { CaptureRemovalResult } from "./agent-response-capture";


/**
 * 渲染进程可用的 API。所有主进程能力通过此处暴露，前端经 window.tokenLens 调用。
 */
const api = {
  getModelMonitorState: (date?: string, source?: ModelMonitorSource) => ipcRenderer.invoke("model-monitor:state", date, source) as Promise<ModelMonitorState>,
  launchCapturedCodex: () => ipcRenderer.invoke("model-monitor:launch-codex") as Promise<HighRiskResult<ModelMonitorState["capture"]>>,
  enableOpenCodeCapture: () => ipcRenderer.invoke("model-monitor:enable-opencode") as Promise<HighRiskResult<void>>,
  enableClaudeCapture: () => ipcRenderer.invoke("model-monitor:enable-claude") as Promise<HighRiskResult<void>>,
  disableOpenCodeCapture: () => ipcRenderer.invoke("model-monitor:disable-opencode") as Promise<HighRiskResult<CaptureRemovalResult>>,
  disableClaudeCapture: () => ipcRenderer.invoke("model-monitor:disable-claude") as Promise<HighRiskResult<CaptureRemovalResult>>,
  ping: () => ipcRenderer.invoke("app:ping") as Promise<string>,
  isEncryptionAvailable: () =>
    ipcRenderer.invoke("encryption:available") as Promise<boolean>,
  bootstrap: () => ipcRenderer.invoke("app:bootstrap") as Promise<AppBootstrap>,
  revealUserData: () => ipcRenderer.invoke("app:reveal-user-data") as Promise<boolean>,
  backupJson: () => ipcRenderer.invoke("app:backup-json") as Promise<string>,
  previewBackup: (raw: string) =>
    ipcRenderer.invoke("app:preview-backup", raw) as Promise<{
      local: number;
      usage: number;
      services: number;
      exportedAt: string;
    }>,
  importBackup: (raw: string) =>
    ipcRenderer.invoke("app:import-backup", raw) as Promise<{
      local: number;
      usage: number;
      usageSkipped: number;
      services: number;
      servicesMatched: number;
      servicesSkipped: number;
    }>,
  dataStats: () =>
    ipcRenderer.invoke("app:stats") as Promise<{
      services: number;
      usageRecords: number;
      localDaily: number;
      snapshots: number;
      bytes: number;
    }>,
  importLocalRows: (rows: unknown[]) =>
    ipcRenderer.invoke("local-usage:import-rows", rows) as Promise<{
      imported: number;
      skipped: number;
    }>,
  saveText: (defaultName: string, content: string) =>
    ipcRenderer.invoke("app:save-text", defaultName, content) as Promise<boolean>,

  listDefinitions: () =>
    ipcRenderer.invoke("services:definitions") as Promise<ServiceDefinition[]>,
  listServices: () =>
    ipcRenderer.invoke("services:list") as Promise<ServiceRecord[]>,
  createService: (input: ServiceInput) =>
    ipcRenderer.invoke("services:create", input) as Promise<ServiceRecord>,
  updateService: (id: string, input: ServiceInput) =>
    ipcRenderer.invoke("services:update", id, input) as Promise<
      ServiceRecord | undefined
    >,
  deleteService: (id: string) =>
    ipcRenderer.invoke("services:delete", id) as Promise<boolean>,
  refreshService: (id: string) =>
    ipcRenderer.invoke("services:refresh", id) as Promise<BalanceResult>,
  listSnapshots: (serviceId?: string, since?: string) =>
    ipcRenderer.invoke("snapshots:list", serviceId, since) as Promise<
      BalanceSnapshot[]
    >,
  refreshUsage: (id: string, period: { start: string; end: string }) =>
    ipcRenderer.invoke("usage:refresh", id, period) as Promise<UsageResult>,
  listUsage: (serviceId?: string, since?: string) =>
    ipcRenderer.invoke("usage:list", serviceId, since) as Promise<
      UsageRecord[]
    >,
  onLocalUsageUpdated: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("local-usage:updated", handler);
    return () => ipcRenderer.removeListener("local-usage:updated", handler);
  },
  onBalanceUpdated: (
    cb: (payload: {
      id: string;
      balance?: BalanceResult;
      error?: string;
    }) => void,
  ) => {
    const handler = (
      _e: unknown,
      payload: { id: string; balance?: BalanceResult; error?: string },
    ) => cb(payload);
    ipcRenderer.on("balance:updated", handler);
    return () => ipcRenderer.removeListener("balance:updated", handler);
  },

  getSetting: (key: string) =>
    ipcRenderer.invoke("settings:get", key) as Promise<string | undefined>,
  setSetting: (key: string, value: string) =>
    ipcRenderer.invoke("settings:set", key, value) as Promise<boolean>,
  getPricingTable: () =>
    ipcRenderer.invoke("pricing:get") as Promise<PricingRowDisplay[]>,
  savePricingOverrides: (value: Record<string, Partial<ModelPricing>>) =>
    ipcRenderer.invoke("pricing:set", value) as Promise<boolean>,
  scanLocalUsage: (since?: string) =>
    ipcRenderer.invoke("local-usage:scan", since) as Promise<ScanLocalUsageResult>,
  listLocalDaily: (since?: string, until?: string) =>
    ipcRenderer.invoke("local-daily:list", since, until) as Promise<
      LocalDailyUsageRecord[]
    >,
  clearLocalUsageCache: () =>
    ipcRenderer.invoke("local-usage:clear-cache") as Promise<{
      success: boolean;
      error?: string;
    }>,
  loginVolcengine: () =>
    ipcRenderer.invoke("auth:volcengine-login") as Promise<{
      cookie: string;
      xWebId: string;
    } | null>,
  loginScnet: () =>
    ipcRenderer.invoke("auth:scnet-login") as Promise<{
      cookie: string;
    } | null>,
  testProxy: (override?: ProxyConfigOverride) =>
    ipcRenderer.invoke("proxy:test", override) as Promise<ProxyTestResult>,

  // 日志：只读 + 打开文件夹 + 清空。刻意不提供上传接口，
  // 日志发不发、发给谁由用户自己决定（见 README 隐私说明）。
  getRecentLogs: () => ipcRenderer.invoke("logs:recent") as Promise<LogEntry[]>,
  getLogPath: () => ipcRenderer.invoke("logs:path") as Promise<string>,
  revealLogFile: () => ipcRenderer.invoke("logs:reveal") as Promise<boolean>,
  clearLogs: () => ipcRenderer.invoke("logs:clear") as Promise<boolean>,
  reportRendererError: (message: string) =>
    ipcRenderer.invoke("logs:report-renderer-error", message) as Promise<boolean>,

  getPetEnabled: () => ipcRenderer.invoke("pet:getEnabled") as Promise<boolean>,
  setPetEnabled: (enabled: boolean) =>
    ipcRenderer.invoke("pet:setEnabled", enabled) as Promise<boolean>,
  // 桌宠窗口的 API（今日花费、活动、拖动）在 pet-preload.ts，主窗口不需要
};


contextBridge.exposeInMainWorld("tokenLens", api);

export type TokenLensApi = typeof api;
