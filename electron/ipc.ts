import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import {
  listServices,
  getService,
  insertService,
  updateServiceMeta,
  deleteServiceRow,
  setSecret,
  listBalanceSnapshots,
  listUsageRecords,
  listLocalDailyUsage,
  getSetting,
  setSetting,
} from "./db";
import { isEncryptionAvailable } from "./secrets";
import { listDefinitions, getDefinition } from "./adapters";
import { getPricingTable, parseOverrides } from "./adapters/pricing";
import { scanAndPersistLocalUsage } from "./local-usage";
import { openVolcengineLogin } from "./auth/volcengine-login";
import { openScnetLogin } from "./auth/scnet-login";
import { refreshServiceInternal } from "./refresh";
import { refreshUsageInternal } from "./usage";
import { restart as restartScheduler } from "./scheduler";
import {
  validateServiceInput,
  validateSettingKey,
  validatePeriod,
  validatePricingOverrides,
} from "./validation";
import {
  applySessionProxy,
  testNetworkConnectivity,
  type ProxyConfigOverride,
} from "./lib/http";
import type { BalanceResult, BalanceSnapshot, ServiceRecord } from "./types";


/** 按服务定义把表单字段拆分为非敏感 config 与敏感 secrets */
function splitFields(
  provider: string,
  fields: Record<string, string>,
): { config: Record<string, unknown>; secrets: Record<string, string> } {
  const def = getDefinition(provider);
  if (!def) throw new Error(`未知服务类型: ${provider}`);
  const secretKeys = new Set(
    def.configSchema
      .filter((f) => f.type === "password" || f.secret)
      .map((f) => f.key),
  );
  const config: Record<string, unknown> = {};
  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (secretKeys.has(k)) secrets[k] = v;
    else config[k] = v;
  }
  return { config, secrets };
}

export function registerIpc(): void {
  ipcMain.handle("app:ping", () => "pong");
  ipcMain.handle("encryption:available", () => isEncryptionAvailable());

  ipcMain.handle("services:definitions", () => listDefinitions());
  ipcMain.handle("services:list", () => listServices());

  ipcMain.handle("services:create", (_e, input: unknown) => {
    const valid = validateServiceInput(input);
    const def = getDefinition(valid.provider);
    if (!def) throw new Error(`未知服务类型: ${valid.provider}`);
    const { config, secrets } = splitFields(valid.provider, valid.fields);
    const id = randomUUID();
    const now = new Date().toISOString();
    const record: ServiceRecord = {
      id,
      name: valid.name,
      provider: valid.provider,
      kind: def.kind,
      config,
      createdAt: now,
      updatedAt: now,
    };
    insertService(record);
    for (const [k, v] of Object.entries(secrets)) setSecret(id, k, v);
    return record;
  });
  ipcMain.handle(
    "services:update",
    (_e, id: string, input: unknown) => {
      const existing = getService(id);
      if (!existing) throw new Error("服务不存在");
      const valid = validateServiceInput(input);
      const { config, secrets } = splitFields(valid.provider, valid.fields);
      updateServiceMeta(id, valid.name, config);
      // 密码字段非空才更新；留空表示保留旧值（便于编辑其他字段时不重填密码）
      for (const [k, v] of Object.entries(secrets)) {
        if (v) setSecret(id, k, v);
      }
      return getService(id);
    },
  );
  ipcMain.handle("services:delete", (_e, id: string) => {
    deleteServiceRow(id);
    return true;
  });

  ipcMain.handle("settings:get", (_e, key: string) => getSetting(key));
  ipcMain.handle("settings:set", (_e, key: unknown, value: unknown) => {
    const validKey = validateSettingKey(key);
    if (typeof value !== "string") throw new Error("设置值需为字符串");
    if (validKey === "refreshInterval") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error("刷新间隔需为非负数字");
      }
      setSetting(validKey, String(n));
      restartScheduler(n);
      return true;
    }
    setSetting(validKey, value);
    if (
      validKey === "proxyMode" ||
      validKey === "proxyCustomUrl" ||
      validKey === "proxyBypassRules"
    ) {
      void applySessionProxy();
    }
    return true;
  });

  ipcMain.handle("proxy:test", async (_e, override?: ProxyConfigOverride) =>
    testNetworkConnectivity(override),
  );


  ipcMain.handle("services:refresh", async (_e, id: string) =>
    refreshServiceInternal(id),
  );

  ipcMain.handle(
    "snapshots:list",
    (_e, serviceId?: string, since?: string) =>
      listBalanceSnapshots(serviceId, since),
  );

  ipcMain.handle(
    "usage:refresh",
    async (_e, id: string, period: unknown) =>
      refreshUsageInternal(id, validatePeriod(period)),
  );

  ipcMain.handle(
    "usage:list",
    (_e, serviceId?: string, since?: string) =>
      listUsageRecords(serviceId, since),
  );

  ipcMain.handle("pricing:get", () => {
    const overrides = parseOverrides(getSetting("pricingOverrides"));
    return getPricingTable(overrides);
  });

  ipcMain.handle("pricing:set", (_e, value: unknown) => {
    const overrides = validatePricingOverrides(value);
    setSetting("pricingOverrides", JSON.stringify(overrides));
    return true;
  });

  ipcMain.handle("local-usage:scan", async (_e, since?: string) =>
    scanAndPersistLocalUsage(since),
  );
  ipcMain.handle(
    "local-daily:list",
    (_e, since?: string, until?: string) =>
      listLocalDailyUsage(since, until),
  );

  ipcMain.handle("auth:volcengine-login", () => openVolcengineLogin());
  ipcMain.handle("auth:scnet-login", () => openScnetLogin());
}
