import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  listServices,
  getService,
  insertService,
  deleteServiceRow,
  setSecret,
  listBalanceSnapshots,
  listUsageRecords,
  listLocalDailyUsage,
  clearAllLocalDailyUsage,
  getSetting,
  setSetting,
  getLastBalances,
  upsertLocalDailyUsage,
  dataStats,
} from "./db";
import { isEncryptionAvailable } from "./secrets";
import { listDefinitions, getDefinition } from "./adapters";
import { getPricingTable, parseOverrides, pruneDefaultOverrides } from "./adapters/pricing";
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
  clearProxyAgentCache,
  DEFAULT_BYPASS_RULES,
  testNetworkConnectivity,
  type ProxyConfigOverride,
} from "./lib/http";
import { mapErrorToUserMessage } from "./lib/user-error";
import { monthStartKey, toDateKey } from "./local-usage/date";
import { parseMonthlyBudgetUsd } from "./lib/budget";
import { parseIdList } from "./lib/id-list";
import {
  backupPreviewStats,
  buildBackupPayload,
  parseBackupJson,
  saveDialogFilters,
  toLocalUsageRows,
  type BackupPayload,
} from "./lib/backup";
import {
  clearLogs,
  getLogPath,
  getRecentLogs,
  logError,
  write as writeLog,
} from "./lib/logger";
import { clearUsageScanCache } from "./local-usage/clear-cache";
import type { AppBootstrap, BalanceResult, BalanceSnapshot, ServiceRecord } from "./types";
import { registerPetIpc } from "./pet/ipc";
import { getAgentModelMonitorState } from "./agent-model-monitor";
import { launchCapturedCodex } from "./codex-capture";
import { enableOpenCodeCapture, enableClaudeCapture } from "./agent-response-capture";
import { singleFlight } from "./lib/inflight";
import { applyBackupImport } from "./backup-import";
import { splitFields, updateServiceFromInput } from "./service-update";

const captureLaunch = { current: null as ReturnType<typeof launchCapturedCodex> | null };



function parseBackupOrThrow(raw: unknown): BackupPayload {
  if (typeof raw !== "string") throw new Error("无效的备份内容");
  if (raw.length > 20_000_000) throw new Error("备份文件过大");
  const parsed = parseBackupJson(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.payload;
}

export function registerIpc(): void {
  ipcMain.handle("model-monitor:state", (_e, date?: unknown, source?: unknown) => getAgentModelMonitorState(date, source, app.getPath("userData")));
  ipcMain.handle("model-monitor:enable-opencode", () => enableOpenCodeCapture(path.join(app.getAppPath(), "electron", "agent-capture", "opencode.mjs"), app.getPath("userData")));
  ipcMain.handle("model-monitor:enable-claude", () => enableClaudeCapture(path.join(app.getAppPath(), "electron", "agent-capture"), app.getPath("userData")));
  ipcMain.handle("model-monitor:launch-codex", () => singleFlight(captureLaunch, () => launchCapturedCodex(path.join(app.getAppPath(), "electron", "codex-capture", "CodexCapture.cs"), app.getPath("userData"))));
  ipcMain.handle("app:ping", () => "pong");
  ipcMain.handle("encryption:available", () => isEncryptionAvailable());

  ipcMain.handle("app:bootstrap", (): AppBootstrap => {
    const today = toDateKey(Date.now());
    const monthStart = monthStartKey(today);
    return {
      definitions: listDefinitions(),
      services: listServices(),
      settings: {
        refreshInterval: getSetting("refreshInterval") ?? "5",
        proxyMode: getSetting("proxyMode") ?? "system",
        proxyCustomUrl: getSetting("proxyCustomUrl") ?? "",
        proxyBypassRules: getSetting("proxyBypassRules") ?? DEFAULT_BYPASS_RULES,
        requestTimeout: getSetting("requestTimeout") ?? "15",
        monthlyBudgetUsd: getSetting("monthlyBudgetUsd") ?? "",
        pinnedServiceIds: getSetting("pinnedServiceIds") ?? "[]",
        hiddenServiceIds: getSetting("hiddenServiceIds") ?? "[]",
      },
      lastBalances: getLastBalances(),
      petEnabled: getSetting("petEnabled") === "1",
      todayLocal: today ? listLocalDailyUsage(today, today) : [],
      monthLocal:
        today && monthStart ? listLocalDailyUsage(monthStart, today) : [],
    };
  });

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
  ipcMain.handle("services:update", (_e, id: string, input: unknown) =>
    updateServiceFromInput(id, input),
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
    if (validKey === "monthlyBudgetUsd") {
      const parsed = parseMonthlyBudgetUsd(value);
      if (value.trim() !== "" && parsed == null) {
        throw new Error("月度预算需为正数");
      }
      setSetting(validKey, parsed == null ? "" : String(parsed));
      return true;
    }
    if (
      validKey === "pinnedServiceIds" ||
      validKey === "hiddenServiceIds" ||
      validKey === "disabledLocalSources"
    ) {
      setSetting(validKey, JSON.stringify(parseIdList(value)));
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
    if (validKey === "requestTimeout") {
      // undici 的 connectTimeout 在 Agent 构造时就固定了，缓存里的 Agent 不重建
      // 就一直是旧值。而 connectTimeout 恰恰是国内端点握手最容易撞上的那道限制
      // （见 lib/http 的 MIN_CONNECT_TIMEOUT_MS：默认值会盖过用户配置）。
      // 不失效缓存的话，用户把超时从 15 秒调到 60 秒要等下次重启才生效。
      clearProxyAgentCache();
    }
    return true;
  });

  ipcMain.handle("proxy:test", async (_e, override?: ProxyConfigOverride) =>
    testNetworkConnectivity(override),
  );


  // 手动刷新失败要留痕：用户点了刷新看到报错，日志里得有对应记录，
  // 否则用户描述「刷新报错」时我们对不上任何上下文。
  // 抛出的错误照旧交给前端展示，只是顺带记一笔。
  ipcMain.handle("services:refresh", async (_e, id: string) => {
    try {
      return await refreshServiceInternal(id);
    } catch (e) {
      const record = getService(id);
      logError(`refresh:${record?.provider ?? "unknown"}`, e);
      throw new Error(mapErrorToUserMessage(e));
    }
  });

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
    // 存之前先剔掉与内置值相同的项：设置页会把整张表回传（它展示的是合并后的
    // 有效值），不剔就等于把内置价表冻在保存当天的数值上
    const overrides = pruneDefaultOverrides(validatePricingOverrides(value));
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

  // 日志：供「反馈问题」界面展示最近错误、打开日志文件夹、清空日志。
  // 不提供任何上传接口——文件发不发、发给谁，全由用户自己决定。
  ipcMain.handle("logs:recent", () => getRecentLogs());
  ipcMain.handle("logs:path", () => getLogPath());
  ipcMain.handle("logs:reveal", () => {
    // 定位到文件本身而非只打开目录，省得用户在一堆缓存文件夹里找
    shell.showItemInFolder(getLogPath());
    return true;
  });
  ipcMain.handle("app:reveal-user-data", () => {
    void shell.openPath(app.getPath("userData"));
    return true;
  });
  ipcMain.handle("app:backup-json", () => {
    const payload = buildBackupPayload({
      services: listServices(),
      usageRecords: listUsageRecords(),
      localDailyUsage: listLocalDailyUsage(),
      settings: {
        refreshInterval: getSetting("refreshInterval"),
        requestTimeout: getSetting("requestTimeout"),
        monthlyBudgetUsd: getSetting("monthlyBudgetUsd"),
        pricingOverrides: getSetting("pricingOverrides"),
        petEnabled: getSetting("petEnabled"),
        pinnedServiceIds: getSetting("pinnedServiceIds"),
        hiddenServiceIds: getSetting("hiddenServiceIds"),
      },
      exportedAt: new Date().toISOString(),
    });
    return JSON.stringify(payload, null, 2);
  });
  ipcMain.handle("app:preview-backup", (_e, raw: unknown) => {
    const payload = parseBackupOrThrow(raw);
    return backupPreviewStats(payload);
  });
  ipcMain.handle("app:import-backup", (_e, raw: unknown) =>
    applyBackupImport(
      parseBackupOrThrow(raw),
      (provider) => getDefinition(provider)?.kind,
    ),
  );
  ipcMain.handle("app:stats", () => dataStats());
  ipcMain.handle("local-usage:import-rows", (_e, rows: unknown) => {
    if (!Array.isArray(rows)) throw new Error("无效的导入数据");
    if (rows.length > 50_000) throw new Error("导入行数过多");
    const localRows = toLocalUsageRows(rows);
    upsertLocalDailyUsage(localRows);
    return { imported: localRows.length, skipped: rows.length - localRows.length };
  });
  ipcMain.handle(
    "app:save-text",
    async (_e, defaultName: unknown, content: unknown) => {
      if (typeof defaultName !== "string" || typeof content !== "string") {
        throw new Error("无效的导出内容");
      }
      if (content.length > 20_000_000) throw new Error("导出内容过大");
      const win = BrowserWindow.fromWebContents(_e.sender);
      const saveOpts = {
        defaultPath: defaultName.replace(/[/\\]/g, "_").slice(0, 120),
        filters: saveDialogFilters(defaultName),
      };
      const result = win
        ? await dialog.showSaveDialog(win, saveOpts)
        : await dialog.showSaveDialog(saveOpts);
      if (result.canceled || !result.filePath) return false;
      try {
        await fs.promises.writeFile(result.filePath, content, "utf8");
      } catch (e) {
        logError("export", e);
        throw new Error("写入文件失败");
      }
      return true;
    },
  );
  ipcMain.handle("logs:clear", () => {
    clearLogs();
    return true;
  });

  // 渲染进程的报错也收进同一份日志：此前前端异常只进 devtools 控制台，
  // 用户那边等于完全不可见。
  ipcMain.handle("logs:report-renderer-error", (_e, message: unknown) => {
    if (typeof message !== "string") return false;
    // 限长，避免超大堆栈把日志文件塞满
    writeLog("error", "renderer", message.slice(0, 4000));
    return true;
  });

  registerPetIpc();

  // 本地用量缓存清理（统计逻辑修复后需要重新统计）
  ipcMain.handle("local-usage:clear-cache", async () => {
    try {
      // 三件事缺一不可：丢内存缓存、删缓存文件、清历史桶。
      // 前两件在 clearUsageScanCache 里，第三件走 db 的内存状态——
      // 直接改写数据文件会与内存分叉，随后的 persist 会把清除结果盖回去。
      clearUsageScanCache();
      clearAllLocalDailyUsage();
      // 清除后立即重新扫描
      await scanAndPersistLocalUsage();
      return { success: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logError("ipc", `清除用量缓存失败: ${msg}`);
      return { success: false, error: msg };
    }
  });
}
