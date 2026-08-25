import type {
  BalanceResult,
  BalanceSnapshot,
  LocalDailyUsageRecord,
  ModelPricing,
  PricingRowDisplay,
  ScanLocalUsageResult,
  ServiceDefinition,
  ServiceInput,
  ServiceRecord,
  UsageRecord,
  UsageResult,
  ProxyTestResult,
} from "@/types";


declare global {
  interface Window {
    tokenLens: {
      ping: () => Promise<string>;
      isEncryptionAvailable: () => Promise<boolean>;
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
    };

  }
}

export {};
