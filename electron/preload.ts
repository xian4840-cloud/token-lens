import { contextBridge, ipcRenderer } from "electron";
import type {
  EventChannel,
  EventPayload,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  TokenLensApi,
} from "../shared/ipc";

/**
 * 渲染进程可用的 API。所有主进程能力通过此处暴露，前端经 window.tokenLens 调用。
 *
 * 方法、通道名与参数 / 返回值类型都定义在 shared/ipc.ts。api 标注为 TokenLensApi，
 * 漏暴露、多暴露、通道名写错或参数 / 返回值与通道不符都编译不过。
 * 注意：preload 运行在沙箱里，只能 require("electron")，这里只允许 import type。
 * 桌宠窗口的 API（今日花费、活动、拖动）在 pet-preload.ts，主窗口不需要。
 */
function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeArgs<C>
): Promise<InvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args);
}

function subscribe<C extends EventChannel>(
  channel: C,
  cb: (payload: EventPayload<C>) => void,
): () => void {
  const handler = (_e: unknown, payload: EventPayload<C>) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: TokenLensApi = {
  getModelMonitorState: (date, source) => invoke("model-monitor:state", date, source),
  launchCapturedCodex: () => invoke("model-monitor:launch-codex"),
  enableOpenCodeCapture: () => invoke("model-monitor:enable-opencode"),
  enableClaudeCapture: () => invoke("model-monitor:enable-claude"),
  disableOpenCodeCapture: () => invoke("model-monitor:disable-opencode"),
  disableClaudeCapture: () => invoke("model-monitor:disable-claude"),

  ping: () => invoke("app:ping"),
  isEncryptionAvailable: () => invoke("encryption:available"),
  bootstrap: () => invoke("app:bootstrap"),
  revealUserData: () => invoke("app:reveal-user-data"),
  backupJson: () => invoke("app:backup-json"),
  previewBackup: (raw) => invoke("app:preview-backup", raw),
  importBackup: (raw) => invoke("app:import-backup", raw),
  dataStats: () => invoke("app:stats"),
  importLocalRows: (rows) => invoke("local-usage:import-rows", rows),
  saveText: (defaultName, content) => invoke("app:save-text", defaultName, content),

  listDefinitions: () => invoke("services:definitions"),
  listServices: () => invoke("services:list"),
  createService: (input) => invoke("services:create", input),
  updateService: (id, input) => invoke("services:update", id, input),
  deleteService: (id) => invoke("services:delete", id),
  refreshService: (id) => invoke("services:refresh", id),
  listSnapshots: (serviceId, since) => invoke("snapshots:list", serviceId, since),
  refreshUsage: (id, period) => invoke("usage:refresh", id, period),
  listUsage: (serviceId, since) => invoke("usage:list", serviceId, since),
  onLocalUsageUpdated: (cb) => subscribe("local-usage:updated", () => cb()),
  onBalanceUpdated: (cb) => subscribe("balance:updated", cb),

  getSetting: (key) => invoke("settings:get", key),
  setSetting: (key, value) => invoke("settings:set", key, value),
  getPricingTable: () => invoke("pricing:get"),
  savePricingOverrides: (value) => invoke("pricing:set", value),
  scanLocalUsage: (since) => invoke("local-usage:scan", since),
  listLocalDaily: (since, until) => invoke("local-daily:list", since, until),
  clearLocalUsageCache: () => invoke("local-usage:clear-cache"),
  loginVolcengine: () => invoke("auth:volcengine-login"),
  loginScnet: () => invoke("auth:scnet-login"),
  testProxy: (override) => invoke("proxy:test", override),

  // 日志：只读 + 打开文件夹 + 清空。刻意不提供上传接口，
  // 日志发不发、发给谁由用户自己决定（见 README 隐私说明）。
  getRecentLogs: () => invoke("logs:recent"),
  getLogPath: () => invoke("logs:path"),
  revealLogFile: () => invoke("logs:reveal"),
  clearLogs: () => invoke("logs:clear"),
  reportRendererError: (message) => invoke("logs:report-renderer-error", message),

  getPetEnabled: () => invoke("pet:getEnabled"),
  setPetEnabled: (enabled) => invoke("pet:setEnabled", enabled),
};

contextBridge.exposeInMainWorld("tokenLens", api);

export type { TokenLensApi };
