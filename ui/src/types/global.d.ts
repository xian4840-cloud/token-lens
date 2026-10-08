import type {
  ModelMonitorState,
  AppBootstrap,
  BalanceResult,
  BalanceSnapshot,
  LocalDailyUsageRecord,
  LogEntry,
  ModelPricing,
  PetActivity,
  PetSpendSummary,
  PricingRowDisplay,
  ScanLocalUsageResult,
  ServiceDefinition,
  ServiceInput,
  ServiceRecord,
  UsageRecord,
  UsageResult,
  ProxyTestResult,
} from "@/types";
import type { BackupImportResult, BackupPreview } from "@/lib/backup-preview";


declare global {
  interface Window {
    tokenLens: {
      getModelMonitorState: (date?: string, source?: import("@/types").ModelMonitorSource) => Promise<ModelMonitorState>;
      launchCapturedCodex: () => Promise<ModelMonitorState["capture"]>;
      enableOpenCodeCapture: () => Promise<void>;
      enableClaudeCapture: () => Promise<void>;
      disableOpenCodeCapture: () => Promise<import("@/lib/capture-removal").CaptureRemovalResult>;
      disableClaudeCapture: () => Promise<import("@/lib/capture-removal").CaptureRemovalResult>;
      ping: () => Promise<string>;
      isEncryptionAvailable: () => Promise<boolean>;
      bootstrap: () => Promise<AppBootstrap>;
      revealUserData: () => Promise<boolean>;
      backupJson: () => Promise<string>;
      previewBackup: (raw: string) => Promise<BackupPreview>;
      importBackup: (raw: string) => Promise<BackupImportResult>;
      dataStats: () => Promise<{
        services: number;
        usageRecords: number;
        localDaily: number;
        snapshots: number;
        bytes: number;
      }>;
      importLocalRows: (
        rows: unknown[],
      ) => Promise<{ imported: number; skipped: number }>;
      saveText: (defaultName: string, content: string) => Promise<boolean>;
      listDefinitions: () => Promise<ServiceDefinition[]>;
      listServices: () => Promise<ServiceRecord[]>;
      createService: (input: ServiceInput) => Promise<ServiceRecord>;
      updateService: (
        id: string,
        input: ServiceInput,
      ) => Promise<ServiceRecord | undefined>;
      deleteService: (id: string) => Promise<boolean>;
      refreshService: (id: string) => Promise<BalanceResult>;
      listSnapshots: (
        serviceId?: string,
        since?: string,
      ) => Promise<BalanceSnapshot[]>;
      refreshUsage: (
        id: string,
        period: { start: string; end: string },
      ) => Promise<UsageResult>;
      listUsage: (
        serviceId?: string,
        since?: string,
      ) => Promise<UsageRecord[]>;
      onLocalUsageUpdated: (cb: () => void) => () => void;
      onBalanceUpdated: (
        cb: (payload: {
          id: string;
          balance?: BalanceResult;
          error?: string;
        }) => void,
      ) => () => void;
      getSetting: (key: string) => Promise<string | undefined>;
      setSetting: (key: string, value: string) => Promise<boolean>;
      getPricingTable: () => Promise<PricingRowDisplay[]>;
      savePricingOverrides: (
        value: Record<string, Partial<ModelPricing>>,
      ) => Promise<boolean>;
      scanLocalUsage: (since?: string) => Promise<ScanLocalUsageResult>;
      listLocalDaily: (
        since?: string,
        until?: string,
      ) => Promise<LocalDailyUsageRecord[]>;
      clearLocalUsageCache: () => Promise<{
        success: boolean;
        error?: string;
      }>;
      loginVolcengine: () => Promise<{
        cookie: string;
        xWebId: string;
      } | null>;
      loginScnet: () => Promise<{
        cookie: string;
      } | null>;
      testProxy: (override?: {
        mode?: string;
        customUrl?: string;
        bypassRules?: string;
      }) => Promise<ProxyTestResult>;
      getRecentLogs: () => Promise<LogEntry[]>;
      getLogPath: () => Promise<string>;
      revealLogFile: () => Promise<boolean>;
      clearLogs: () => Promise<boolean>;
      reportRendererError: (message: string) => Promise<boolean>;
      getPetEnabled: () => Promise<boolean>;
      setPetEnabled: (enabled: boolean) => Promise<boolean>;
      petTodaySpend: () => Promise<PetSpendSummary>;
      getPetActivity: () => Promise<PetActivity>;
      petDragStart: () => void;
      petDragMove: () => void;
      petDragEnd: () => void;
      onPetActivity: (cb: (activity: PetActivity) => void) => () => void;
      onPetSpendUpdated: (cb: (summary: PetSpendSummary) => void) => () => void;
    };

  }
}

export {};
