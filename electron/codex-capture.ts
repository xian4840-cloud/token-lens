import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export interface CodexCaptureState {
  supported: boolean;
  ready: boolean;
  active: boolean;
  responseCount: number;
  lastResponseAt?: string;
  error?: string;
}
export const codexRoot = () => process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
export const captureDirectory = (dataRoot: string) => path.join(dataRoot, "model-capture");

export function getCodexCaptureState(dataRoot: string): CodexCaptureState {
  const dir = captureDirectory(dataRoot);
  const state: CodexCaptureState = { supported: process.platform === "win32", ready: fs.existsSync(path.join(dir, "CodexCapture.exe")), active: false, responseCount: 0 };
  try {
    const status = JSON.parse(fs.readFileSync(path.join(dir, "collector.json"), "utf8"));
    if (Number.isInteger(status.collectorPid) && status.collectorPid > 0) {
      try { process.kill(status.collectorPid, 0); state.active = true; } catch { /* Last collector has exited. */ }
    }
    state.responseCount = Number.isSafeInteger(status.responseCount) && status.responseCount >= 0 ? status.responseCount : 0;
    if (typeof status.lastResponseAt === "string" && Number.isFinite(Date.parse(status.lastResponseAt))) state.lastResponseAt = status.lastResponseAt;
    if (typeof status.error === "string" && status.error.length <= 256) state.error = status.error;
  } catch { /* No collector yet, or status is being written. */ }
  return state;
}

/** Read only independently captured native response metadata. Session models never enter here. */
export function readCapturedModels(dataRoot: string): Map<string, Set<string>> {
  // ponytail: reread metadata per refresh; use incremental reads if large journals become slow.
  const dir = captureDirectory(dataRoot), models = new Map<string, Set<string>>();
  let files: string[];
  try { files = fs.readdirSync(dir).filter(f => /^responses-\d+\.jsonl$/.test(f)); } catch { return models; }
  for (const name of files) {
    try {
      for (const line of fs.readFileSync(path.join(dir, name), "utf8").split("\n")) {
        try {
          const row = JSON.parse(line);
          if (row.source !== "codex-native-trace-v1" || !["response.created", "response.completed", "response.failed", "response.incomplete"].includes(row.eventType)) continue;
          if (typeof row.responseId !== "string" || !row.responseId || row.responseId.length > 256 || typeof row.model !== "string" || !row.model || row.model.length > 256) continue;
          const values = models.get(row.responseId) ?? new Set<string>();
          values.add(row.model); models.set(row.responseId, values);
        } catch { /* Partial append or unsupported record. */ }
      }
    } catch { /* Retry locked/unreadable journals on the next refresh. */ }
  }
  return models;
}

export async function launchCapturedCodex(sourceFile: string, dataRoot: string, root = codexRoot()): Promise<CodexCaptureState> {
  if (process.platform !== "win32") throw new Error("桌面实时采集第一版支持 Windows");
  // Discovery is read-only; no global environment, certificates or Codex settings are changed.
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$p=Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1; if($p){ $exe=Join-Path $p.InstallLocation 'app\\ChatGPT.exe'; $running=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $exe}).Count -gt 0; @{path=$exe;running=$running}|ConvertTo-Json -Compress }"], { windowsHide: true, timeout: 15000 });
  let desktop: { path: string; running: boolean };
  try { desktop = JSON.parse(stdout.trim()); } catch { throw new Error("未找到官方 Codex 桌面版，请确认已安装 Windows 版 Codex"); }
  if (typeof desktop.path !== "string" || !fs.existsSync(desktop.path)) throw new Error("官方 Codex 桌面程序暂时不可用");
  const coreDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "OpenAI", "Codex", "bin");
  let binaries: string[] = [];
  try { binaries = fs.readdirSync(coreDir).map(name => path.join(coreDir, name, "codex.exe")).filter(f => fs.existsSync(f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs); } catch {}
  if (!binaries[0]) throw new Error("未找到官方 Codex 后端，请先正常打开一次 Codex");
  const dir = captureDirectory(dataRoot), collector = path.join(dir, "CodexCapture.exe");
  fs.mkdirSync(dir, { recursive: true });
  const source = fs.readFileSync(sourceFile, "utf8"), savedSource = path.join(dir, "CodexCapture.cs");
  if (!fs.existsSync(collector) || !fs.existsSync(savedSource) || fs.readFileSync(savedSource, "utf8") !== source) {
    if (getCodexCaptureState(dataRoot).active) throw new Error("采集器正在使用中，请先退出 Codex 再更新采集器");
    const nextSource = path.join(dir, "CodexCapture.next.cs");
    fs.writeFileSync(nextSource, source);
    const compiler = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    if (!fs.existsSync(compiler)) throw new Error("系统缺少 .NET Framework 编译工具，暂时无法准备桌面采集器");
    const next = path.join(dir, "CodexCapture.next.exe");
    try { await run(compiler, ["/nologo", "/target:exe", "/reference:System.Web.Extensions.dll", `/out:${next}`, nextSource], { windowsHide: true, timeout: 30000 }); }
    catch { throw new Error("桌面采集器准备失败，请检查系统 .NET Framework"); }
    fs.renameSync(next, collector);
    fs.renameSync(nextSource, savedSource);
  }
  if (desktop.running) throw new Error("采集器已准备好。请先退出 Codex，再点击“启动 Codex 并采集”；现有聊天不会被自动关闭。");
  const child = spawn(desktop.path, [], { detached: true, windowsHide: true, stdio: "ignore", env: { ...process.env,
    CODEX_HOME: root, CODEX_CLI_PATH: collector, CODEX_APP_SERVER_FORCE_CLI: "1",
    TOKEN_LENS_REAL_CODEX: binaries[0], TOKEN_LENS_CAPTURE_DIR: dir } });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", () => reject(new Error("启动 Codex 失败，请重新尝试"))); });
  child.unref();
  return getCodexCaptureState(dataRoot);
}
