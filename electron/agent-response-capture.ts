import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFileSync } from "node:child_process";
import type { ModelMonitorRecord } from "./model-monitor";

/**
 * 由 Token Lens 写出的文件都以固定的首行标记开头，关闭采集 / 卸载时只删首行匹配的文件：
 * 同名但不是我们写的（用户自己的插件、别的工具）一律不动。
 * 首行改动时，build/installer.nsh 里的同名常量必须同步修改（有测试盯着）。
 */
export const OPENCODE_PLUGIN_MARKER = "// Token Lens response monitor\n";
export const CLAUDE_PRELOAD_MARKER = "// Token Lens Claude monitor\n";
/** agent-capture/_token-lens-fetch-models.cjs 原样复制，它的首行就是标记 */
export const FETCH_HELPER_MARKER = "// Shared in-process observer: metadata only, bounded frames, unchanged response bytes.\n";
export const FETCH_HELPER_NAME = "_token-lens-fetch-models.cjs";
export const BUN_OPTIONS = "BUN_OPTIONS";

export function openCodeCapturePaths(dataRoot: string, configRoot = process.env.OPENCODE_CONFIG_DIR ?? path.join(os.homedir(), ".config", "opencode")) {
  const plugins = path.join(configRoot, "plugins");
  return { plugin: path.join(plugins, "token-lens-response-monitor.js"), helper: path.join(plugins, FETCH_HELPER_NAME), journal: path.join(dataRoot, "model-responses", "opencode.jsonl") };
}
export function enableOpenCodeCapture(asset: string, dataRoot: string, configRoot?: string): void {
  const paths = openCodeCapturePaths(dataRoot, configRoot);
  if (fs.existsSync(paths.plugin) && !fs.readFileSync(paths.plugin, "utf8").startsWith(OPENCODE_PLUGIN_MARKER)) throw new Error("同名插件不是 Token Lens 创建的，无法覆盖");
  const source = fs.readFileSync(asset, "utf8");
  fs.mkdirSync(path.dirname(paths.plugin), { recursive: true });
  fs.copyFileSync(path.join(path.dirname(asset), FETCH_HELPER_NAME), paths.helper);
  fs.writeFileSync(paths.plugin, OPENCODE_PLUGIN_MARKER + `const TOKEN_LENS_JOURNAL = ${JSON.stringify(paths.journal)};\n// Capture version 2\n` + source, { mode: 0o600 });
}

export function isOpenCodeCaptureEnabled(dataRoot: string): boolean {
  const paths = openCodeCapturePaths(dataRoot);
  try { return fs.existsSync(paths.helper) && fs.readFileSync(paths.plugin, "utf8").startsWith(`${OPENCODE_PLUGIN_MARKER}const TOKEN_LENS_JOURNAL = ${JSON.stringify(paths.journal)};\n// Capture version 2\n`); } catch { return false; }
}

export function claudeCapturePaths(dataRoot: string, home = os.homedir()) {
  const directory = path.join(home, ".claude", "token-lens-monitor");
  return { directory, preload: path.join(directory, "claude.cjs"), helper: path.join(directory, FETCH_HELPER_NAME), journalPointer: path.join(directory, "claude-journal.json"), journal: path.join(dataRoot, "model-responses", "claude-code.jsonl") };
}
/** 写进 BUN_OPTIONS 的那一段：`--preload=C:/Users/me/.claude/token-lens-monitor/claude.cjs` */
export function claudePreloadFlag(preloadPath: string): string {
  return `--preload=${preloadPath.replaceAll("\\", "/")}`;
}

function powershell(script: string): string {
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from('$ProgressPreference="SilentlyContinue"\n$ErrorActionPreference="Stop"\n' + script, "utf16le").toString("base64")], { windowsHide: true, encoding: "utf8", timeout: 10_000 }).trim();
  } catch { throw new Error("无法读取或保存 Claude 核验的用户启动设置"); }
}

/** 用户级环境变量 BUN_OPTIONS 的读写（HKCU\Environment）。抽成接口便于测试注入。 */
export interface UserEnvStore {
  get(): string;
  set(value: string): void;
  remove(): void;
}
const BROADCAST_ENV_CHANGE = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class TokenLensEnvironment { [DllImport("user32.dll")] public static extern IntPtr GetShellWindow(); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, string l, uint f, uint t, out UIntPtr r); }'
$taskResult=[UIntPtr]::Zero
[void][TokenLensEnvironment]::SendMessageTimeout([TokenLensEnvironment]::GetShellWindow(), 26, [UIntPtr]::Zero, "Environment", 2, 1000, [ref]$taskResult)`;
export const windowsBunOptionsStore: UserEnvStore = {
  get: () => powershell(`[Environment]::GetEnvironmentVariable("${BUN_OPTIONS}", "User")`),
  set: (value) => {
    const quoted = `'${value.replaceAll("'", "''")}'`;
    powershell(`$taskEnvironment=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Environment")
$taskEnvironment.SetValue("${BUN_OPTIONS}", ${quoted}, [Microsoft.Win32.RegistryValueKind]::String)
$taskEnvironment.Close()
${BROADCAST_ENV_CHANGE}`);
  },
  remove: () => {
    powershell(`$taskEnvironment=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
if ($taskEnvironment) { $taskEnvironment.DeleteValue("${BUN_OPTIONS}", $false); $taskEnvironment.Close() }
${BROADCAST_ENV_CHANGE}`);
  },
};

let bunOptions: string | undefined;
function userBunOptions(): string {
  if (bunOptions === undefined) bunOptions = process.platform === "win32" ? windowsBunOptionsStore.get() : process.env.BUN_OPTIONS ?? "";
  return bunOptions;
}

/**
 * 从 BUN_OPTIONS 里去掉我们那一段，其余原样保留（包括用户自己的空白格式）。
 * 只去掉前后都是空格（或开头/结尾）的完整一段，不会误伤 `--preload=…/claude.cjs.bak` 这类相似值。
 * build/installer.nsh 的卸载逻辑用的是同一算法：两边补空格 -> 反复把 " 标记 " 换成 " " -> 去掉补的空格。
 */
export function stripBunPreloadFlag(value: string, flag: string): string {
  const needle = ` ${flag} `;
  let padded = ` ${value} `;
  while (padded.includes(needle)) padded = padded.replace(needle, " ");
  return padded.slice(1, -1);
}

export function enableClaudeCapture(assetDirectory: string, dataRoot: string): void {
  if (process.platform !== "win32") throw new Error("当前 Claude 进程内核验支持 Windows 原生版");
  const paths = claudeCapturePaths(dataRoot);
  // Bun's BUN_OPTIONS parser does not accept quoted whitespace in preload paths.
  if (/\s/.test(paths.preload)) throw new Error("当前用户目录含空格，暂时无法安装原生 Claude 预加载脚本");
  if (fs.existsSync(paths.preload) && !fs.readFileSync(paths.preload, "utf8").startsWith(CLAUDE_PRELOAD_MARKER)) throw new Error("同名脚本不是 Token Lens 创建的，无法覆盖");
  fs.mkdirSync(paths.directory, { recursive: true });
  fs.copyFileSync(path.join(assetDirectory, FETCH_HELPER_NAME), paths.helper);
  fs.writeFileSync(paths.preload, CLAUDE_PRELOAD_MARKER + fs.readFileSync(path.join(assetDirectory, "claude.cjs"), "utf8"), { mode: 0o600 });
  fs.writeFileSync(paths.journalPointer, JSON.stringify(paths.journal), { mode: 0o600 });
  const flag = claudePreloadFlag(paths.preload);
  const previous = userBunOptions();
  const next = previous.split(/\s+/).includes(flag) ? previous : `${previous} ${flag}`.trim();
  windowsBunOptionsStore.set(next);
  bunOptions = next;
  process.env.BUN_OPTIONS = next;
}
export function isClaudeCaptureEnabled(dataRoot: string): boolean {
  const paths = claudeCapturePaths(dataRoot);
  try {
    return fs.existsSync(paths.helper) && fs.readFileSync(paths.preload, "utf8").startsWith(CLAUDE_PRELOAD_MARKER) && JSON.parse(fs.readFileSync(paths.journalPointer, "utf8")) === paths.journal && userBunOptions().split(/\s+/).includes(claudePreloadFlag(paths.preload));
  } catch { return false; }
}

/* ───────────── 关闭采集：逐项撤销 enable 写下的东西 ───────────── */

export interface CaptureRemovalResult {
  /** 已删除 / 已还原的项 */
  removed: string[];
  /** 存在但判断不是我们写的、或目录里还有别的文件，因而保留的项 */
  kept: string[];
}

/** 只读文件开头一小段，避免把大文件整个读进来 */
function readHead(file: string, bytes = 4096): string | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function removeIfOurs(file: string, isOurs: (head: string) => boolean, result: CaptureRemovalResult): void {
  let st: fs.Stats;
  try { st = fs.lstatSync(file); } catch { return; }
  // 只处理普通文件：同名的目录 / 符号链接都不是我们创建的
  if (!st.isFile()) { result.kept.push(file); return; }
  const head = readHead(file);
  if (head === undefined || !isOurs(head)) { result.kept.push(file); return; }
  fs.unlinkSync(file);
  result.removed.push(file);
}

const isClaudePreload = (head: string) => head.startsWith(CLAUDE_PRELOAD_MARKER);
const isOpenCodePlugin = (head: string) => head.startsWith(OPENCODE_PLUGIN_MARKER);
const isFetchHelper = (head: string) => head.startsWith(FETCH_HELPER_MARKER);
/** claude-journal.json 的内容是一个 JSON 字符串：指向 .../model-responses/claude-code.jsonl */
const isJournalPointer = (head: string) => {
  try {
    const v: unknown = JSON.parse(head);
    return typeof v === "string" && /[\\/]model-responses[\\/]claude-code\.jsonl$/.test(v);
  } catch { return false; }
};

/**
 * 关闭 OpenCode 采集：删除 enable 写进 OpenCode 插件目录的两个文件。
 * 插件目录本身不删（里面可能有用户的其他插件）；采集日志在应用数据目录里，保留。
 */
export function disableOpenCodeCapture(dataRoot: string, configRoot?: string): CaptureRemovalResult {
  const paths = openCodeCapturePaths(dataRoot, configRoot);
  const result: CaptureRemovalResult = { removed: [], kept: [] };
  removeIfOurs(paths.plugin, isOpenCodePlugin, result);
  removeIfOurs(paths.helper, isFetchHelper, result);
  return result;
}

export function isOpenCodeCaptureInstalled(dataRoot: string, configRoot?: string): boolean {
  const paths = openCodeCapturePaths(dataRoot, configRoot);
  return isOpenCodePlugin(readHead(paths.plugin) ?? "") || isFetchHelper(readHead(paths.helper) ?? "");
}

export interface DisableClaudeOptions {
  home?: string;
  /** 注入用户环境变量存储；默认 Windows 下用注册表，其他平台不碰（enable 本就只支持 Windows） */
  envStore?: UserEnvStore | null;
}

/**
 * 关闭 Claude Code 采集：
 * 1. 从用户环境变量 BUN_OPTIONS 去掉我们追加的 `--preload=…claude.cjs` 一段；
 *    去掉后为空就删除该值，否则写回剩余部分（用户自己的选项原样保留）；
 * 2. 删除 ~/.claude/token-lens-monitor 下我们写的三个文件（逐个核对首行标记）；
 * 3. 目录空了才删目录，绝不递归删除。
 * 采集日志在应用数据目录里，保留。
 */
export function disableClaudeCapture(dataRoot: string, options: DisableClaudeOptions = {}): CaptureRemovalResult {
  const paths = claudeCapturePaths(dataRoot, options.home);
  const result: CaptureRemovalResult = { removed: [], kept: [] };
  const store = options.envStore !== undefined ? options.envStore : process.platform === "win32" ? windowsBunOptionsStore : null;
  const flag = claudePreloadFlag(paths.preload);
  if (store) {
    const current = store.get();
    const next = stripBunPreloadFlag(current, flag);
    if (next !== current) {
      if (next === "") store.remove();
      else store.set(next);
      result.removed.push(`HKCU\\Environment\\${BUN_OPTIONS}: ${flag}`);
    }
    bunOptions = next;
  }
  if (process.env.BUN_OPTIONS !== undefined) {
    const next = stripBunPreloadFlag(process.env.BUN_OPTIONS, flag);
    if (next === "") delete process.env.BUN_OPTIONS;
    else process.env.BUN_OPTIONS = next;
  }
  removeIfOurs(paths.preload, isClaudePreload, result);
  removeIfOurs(paths.helper, isFetchHelper, result);
  removeIfOurs(paths.journalPointer, isJournalPointer, result);
  try {
    if (fs.lstatSync(paths.directory).isDirectory()) {
      if (fs.readdirSync(paths.directory).length === 0) {
        fs.rmdirSync(paths.directory);
        result.removed.push(paths.directory);
      } else {
        result.kept.push(paths.directory);
      }
    }
  } catch { /* 目录不存在 */ }
  return result;
}

export function isClaudeCaptureInstalled(dataRoot: string, home?: string): boolean {
  const paths = claudeCapturePaths(dataRoot, home);
  if (isClaudePreload(readHead(paths.preload) ?? "") || isFetchHelper(readHead(paths.helper) ?? "") || isJournalPointer(readHead(paths.journalPointer) ?? "")) return true;
  try { return ` ${userBunOptions()} `.includes(` ${claudePreloadFlag(paths.preload)} `); } catch { return false; }
}

/** 测试用：清掉 BUN_OPTIONS 缓存 */
export function resetBunOptionsCacheForTest(): void {
  bunOptions = undefined;
}

const small = (v: unknown): string | undefined => typeof v === "string" && v.length > 0 && v.length <= 256 ? v : undefined;
const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0;
const cache = new Map<string, { stamp: string; records: (ModelMonitorRecord & { assistantId?: string })[] }>();
export async function readOpenCodeCaptures(dataRoot: string): Promise<(ModelMonitorRecord & { assistantId?: string })[]> {
  return readCaptures(openCodeCapturePaths(dataRoot).journal, true);
}
export async function readClaudeCaptures(dataRoot: string): Promise<ModelMonitorRecord[]> {
  return readCaptures(claudeCapturePaths(dataRoot).journal, false);
}
async function readCaptures(journal: string, requireSession: boolean): Promise<(ModelMonitorRecord & { assistantId?: string })[]> {
  let stat: fs.Stats;
  try { stat = fs.statSync(journal); } catch { return []; }
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  const hit = cache.get(journal);
  if (hit?.stamp === stamp) return hit.records;
  const records = new Map<string, ModelMonitorRecord & { assistantId?: string }>();
  const stream = fs.createReadStream(journal, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.length > 8192) continue;
      let r: any;
      try { r = JSON.parse(line); } catch { continue; }
      const id = small(r.id), sessionId = small(r.sessionId), requestedModel = small(r.requestedModel);
      if (!id || (requireSession && !sessionId) || typeof r.startedAt !== "string" || !Number.isFinite(Date.parse(r.startedAt))) continue;
      const responseModel = small(r.responseModel);
      records.set(id, { id, sessionId, assistantId: small(r.assistantId), startedAt: new Date(r.startedAt).toISOString(), requestedModel, sentModel: small(r.sentModel), responseModel, responseId: small(r.responseId), evidence: "response", status: requestedModel && responseModel ? requestedModel === responseModel ? "match" : "mismatch" : "unknown", inputTokens: count(r.inputTokens), outputTokens: count(r.outputTokens), totalTokens: count(r.inputTokens) + count(r.outputTokens) });
    }
  } finally { lines.close(); stream.destroy(); }
  const result = [...records.values()];
  cache.set(journal, { stamp, records: result });
  return result;
}
