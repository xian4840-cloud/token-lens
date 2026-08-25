import { contextBridge, ipcRenderer } from "electron";
import type {
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


/**
 * 渲染进程可用的 API。所有主进程能力通过此处暴露，前端经 window.tokenLens 调用。
 */
const api = {
  ping: () => ipcRenderer.invoke("app:ping") as Promise<string>,
  isEncryptionAvailable: () =>
    ipcRenderer.invoke("encryption:available") as Promise<boolean>,

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
};


contextBridge.exposeInMainWorld("tokenLens", api);

export type TokenLensApi = typeof api;
