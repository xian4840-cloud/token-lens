import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

/** 我们写进 BUN_OPTIONS 的预加载脚本路径的固定结尾（统一成小写、正斜杠后比较） */
export const PRELOAD_PATH_SUFFIX = "/.claude/token-lens-monitor/claude.cjs";
/** 关闭后复查用：剩余的 BUN_OPTIONS 里只要还出现这一串，就说明仍有东西指向我们的预加载脚本 */
export const PRELOAD_REFERENCE = "token-lens-monitor/claude.cjs";

const normalizePath = (v: string) => v.replaceAll("\\", "/").toLowerCase();

/**
 * 是否是我们追加的那一段：`--preload=<任意路径>`，路径（不区分大小写、正反斜杠都认）
 * 以 /.claude/token-lens-monitor/claude.cjs 结尾。
 *
 * 不要求与当前 os.homedir() 逐字相同：启用时与卸载时拿到的用户目录可能大小写或写法不同
 * （NSIS 的 $PROFILE vs Node 的 USERPROFILE、短文件名等）。token-lens-monitor 目录只有
 * Token Lens 会写，按结尾识别不会误伤用户自己的选项。
 */
export function isTokenLensPreloadToken(token: string): boolean {
  if (token.slice(0, 10).toLowerCase() !== "--preload=") return false;
  return normalizePath(token.slice(10)).endsWith(PRELOAD_PATH_SUFFIX);
}

/** 剩余值里是否还以任何形式引用着我们的预加载脚本（不区分大小写、正反斜杠） */
export function referencesTokenLensPreload(value: string): boolean {
  return normalizePath(value).includes(PRELOAD_REFERENCE);
}

/**
 * 从 BUN_OPTIONS 里去掉我们追加的段（isTokenLensPreloadToken），其余尽量原样保留。
 * 空格、制表符、回车、换行都算分隔符。去掉一段时连同它前面的空白一起去掉；
 * 它若是第一段，则去掉它后面的空白（保留原有的行首空白）。一段都不剩时返回 ""（调用方删除该值）。
 * build/installer.nsh 的 un.TLStripBunOptions 逐字符实现同一算法，两边由测试对齐。
 */
export function stripTokenLensPreload(value: string): string {
  // 拆成 (前置空白, 段) 序列 + 末尾空白
  const pairs: [string, string][] = [];
  // 只认空格、制表符、回车、换行（与 NSIS 实现一致），不认其他 Unicode 空白
  const re = /([ \t\r\n]*)([^ \t\r\n]+)/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(value))) {
    pairs.push([m[1], m[2]]);
    last = re.lastIndex;
  }
  const trailing = value.slice(last);
  let out = "";
  let anyKept = false;
  let carry: string | null = null;
  for (const [sep, token] of pairs) {
    if (isTokenLensPreloadToken(token)) {
      if (!anyKept && carry === null) carry = sep;
      continue;
    }
    out += (!anyKept && carry !== null ? carry : sep) + token;
    anyKept = true;
    carry = null;
  }
  return anyKept ? out + trailing : "";
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
 * 1. 从用户环境变量 BUN_OPTIONS 去掉我们追加的 `--preload=…/token-lens-monitor/claude.cjs`
 *    （stripTokenLensPreload：不区分大小写、正反斜杠、任意空白分隔）；一段不剩就删除该值；
 * 2. 复查：剩余值里仍引用 token-lens-monitor/claude.cjs，或注册表读写失败，则三个文件和目录
 *    全部保留并记入 kept——否则 Bun 找不到预加载脚本会直接退出，Claude Code 将无法启动；
 * 3. 否则删除 ~/.claude/token-lens-monitor 下我们写的三个文件（逐个核对首行标记），
 *    目录空了才删目录，绝不递归删除。
 * 采集日志在应用数据目录里，保留。
 */
export function disableClaudeCapture(dataRoot: string, options: DisableClaudeOptions = {}): CaptureRemovalResult {
  const paths = claudeCapturePaths(dataRoot, options.home);
  const result: CaptureRemovalResult = { removed: [], kept: [] };
  const store = options.envStore !== undefined ? options.envStore : process.platform === "win32" ? windowsBunOptionsStore : null;
  // 去掉 BUN_OPTIONS 里我们那一段之后，若仍有东西指向 claude.cjs，就绝不能删脚本：
  // Bun 找不到 --preload 指向的文件会直接退出，Claude Code 将无法启动。
  let stillReferenced = false;
  if (store) {
    try {
      const current = store.get();
      const next = stripTokenLensPreload(current);
      if (next !== current) {
        if (next === "") store.remove();
        else store.set(next);
        const removedSegments = current.split(/[ \t\r\n]+/).filter(isTokenLensPreloadToken);
        result.removed.push(`HKCU\\Environment\\${BUN_OPTIONS}: ${removedSegments.join(" ")}`);
      }
      bunOptions = next;
      if (referencesTokenLensPreload(next)) {
        stillReferenced = true;
        result.kept.push(`HKCU\\Environment\\${BUN_OPTIONS}：剩余的值仍引用 ${PRELOAD_REFERENCE}（写法无法自动识别），请手动删除该项`);
      }
    } catch (e) {
      stillReferenced = true;
      bunOptions = undefined;
      result.kept.push(`HKCU\\Environment\\${BUN_OPTIONS}：读取或写入失败（${e instanceof Error ? e.message : String(e)}）`);
    }
  }
  if (process.env.BUN_OPTIONS !== undefined) {
    const next = stripTokenLensPreload(process.env.BUN_OPTIONS);
    if (next === "") delete process.env.BUN_OPTIONS;
    else process.env.BUN_OPTIONS = next;
    // 没有注册表可改的平台（enable 本就只支持 Windows）以本进程环境为准
    if (!store && referencesTokenLensPreload(next)) {
      stillReferenced = true;
      result.kept.push(`${BUN_OPTIONS}（当前进程环境）：剩余的值仍引用 ${PRELOAD_REFERENCE}，请手动删除该项`);
    }
  }
  if (stillReferenced) {
    // claude.cjs 还会 require 同目录的 _token-lens-fetch-models.cjs，整套保留，目录也保留
    const reason = `（${BUN_OPTIONS} 仍引用它，删除会导致 Claude Code 无法启动）`;
    for (const file of [paths.preload, paths.helper, paths.journalPointer, paths.directory]) {
      if (fs.existsSync(file)) result.kept.push(file + reason);
    }
    return result;
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
  try { return referencesTokenLensPreload(userBunOptions()); } catch { return false; }
}

/** 测试用：清掉 BUN_OPTIONS 缓存 */
export function resetBunOptionsCacheForTest(): void {
  bunOptions = undefined;
}

const small = (v: unknown): string | undefined => typeof v === "string" && v.length > 0 && v.length <= 256 ? v : undefined;
const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0;
type CaptureRecord = ModelMonitorRecord & { assistantId?: string };
/**
 * 采集日志增量读取状态：记住读到的字节偏移，日志只追加时只读新增部分。
 * 文件变短、换了 inode（被重写/替换）或 mtime 回退时整份重读。
 */
const cache = new Map<string, { ino: number; mtimeMs: number; offset: number; partial: string; byId: Map<string, CaptureRecord>; records: CaptureRecord[] }>();
export async function readOpenCodeCaptures(dataRoot: string): Promise<(ModelMonitorRecord & { assistantId?: string })[]> {
  return readCaptures(openCodeCapturePaths(dataRoot).journal, true);
}
export async function readClaudeCaptures(dataRoot: string): Promise<ModelMonitorRecord[]> {
  return readCaptures(claudeCapturePaths(dataRoot).journal, false);
}
function parseCaptureLine(line: string, requireSession: boolean): CaptureRecord | undefined {
  if (!line || line.length > 8192) return undefined;
  let r: any;
  try { r = JSON.parse(line); } catch { return undefined; }
  if (!r || typeof r !== "object") return undefined;
  const id = small(r.id), sessionId = small(r.sessionId), requestedModel = small(r.requestedModel);
  if (!id || (requireSession && !sessionId) || typeof r.startedAt !== "string" || !Number.isFinite(Date.parse(r.startedAt))) return undefined;
  const responseModel = small(r.responseModel);
  return { id, sessionId, assistantId: small(r.assistantId), startedAt: new Date(r.startedAt).toISOString(), requestedModel, sentModel: small(r.sentModel), responseModel, responseId: small(r.responseId), evidence: "response", status: requestedModel && responseModel ? requestedModel === responseModel ? "match" : "mismatch" : "unknown", inputTokens: count(r.inputTokens), outputTokens: count(r.outputTokens), totalTokens: count(r.inputTokens) + count(r.outputTokens) };
}
const pendingCaptureReads = new Map<string, Promise<CaptureRecord[]>>();
function readCaptures(journal: string, requireSession: boolean): Promise<CaptureRecord[]> {
  // 增量游标不能并发推进：同一日志同一时刻只读一次，后来者复用结果
  const pending = pendingCaptureReads.get(journal);
  if (pending) return pending;
  const p = readCapturesOnce(journal, requireSession).finally(() => pendingCaptureReads.delete(journal));
  pendingCaptureReads.set(journal, p);
  return p;
}
async function readCapturesOnce(journal: string, requireSession: boolean): Promise<CaptureRecord[]> {
  let stat: fs.Stats;
  try { stat = await fs.promises.stat(journal); } catch { cache.delete(journal); return []; }
  let hit = cache.get(journal);
  if (hit && hit.ino === stat.ino && hit.offset === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.records;
  if (!hit || hit.ino !== stat.ino || stat.size < hit.offset || stat.mtimeMs < hit.mtimeMs) {
    hit = { ino: stat.ino, mtimeMs: 0, offset: 0, partial: "", byId: new Map(), records: [] };
  }
  let chunk: string;
  try {
    const handle = await fs.promises.open(journal, "r");
    try {
      const buf = Buffer.alloc(stat.size - hit.offset);
      let read = 0;
      while (read < buf.length) {
        const { bytesRead } = await handle.read(buf, read, buf.length - read, hit.offset + read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      chunk = hit.partial + buf.subarray(0, read).toString("utf8");
      hit.offset += read;
    } finally { await handle.close(); }
  } catch { return hit.records; }
  const lines = chunk.split("\n");
  hit.partial = lines.pop() ?? "";
  for (const raw of lines) {
    const record = parseCaptureLine(raw.replace(/\r$/, ""), requireSession);
    if (record) hit.byId.set(record.id, record);
  }
  // 末尾半行若已是完整记录（写入方漏了换行）也先收下；补全后会被同 id 覆盖
  const tail = parseCaptureLine(hit.partial.replace(/\r$/, ""), requireSession);
  const byId = tail ? new Map(hit.byId).set(tail.id, tail) : hit.byId;
  hit.mtimeMs = stat.mtimeMs;
  hit.records = [...byId.values()];
  cache.set(journal, hit);
  return hit.records;
}
