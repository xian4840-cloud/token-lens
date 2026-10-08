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

export async function getCodexCaptureState(dataRoot: string): Promise<CodexCaptureState> {
  const dir = captureDirectory(dataRoot);
  const ready = await fs.promises.access(path.join(dir, "CodexCapture.exe")).then(() => true, () => false);
  const state: CodexCaptureState = { supported: process.platform === "win32", ready, active: false, responseCount: 0 };
  try {
    const status = JSON.parse(await fs.promises.readFile(path.join(dir, "collector.json"), "utf8"));
    if (Number.isInteger(status.collectorPid) && status.collectorPid > 0) {
      try { process.kill(status.collectorPid, 0); state.active = true; } catch { /* Last collector has exited. */ }
    }
    state.responseCount = Number.isSafeInteger(status.responseCount) && status.responseCount >= 0 ? status.responseCount : 0;
    if (typeof status.lastResponseAt === "string" && Number.isFinite(Date.parse(status.lastResponseAt))) state.lastResponseAt = status.lastResponseAt;
    if (typeof status.error === "string" && status.error.length <= 256) state.error = status.error;
  } catch { /* No collector yet, or status is being written. */ }
  return state;
}

const JOURNAL = /^responses-(\d+)\.jsonl$/;
/** 已退出后端的采集日志合并到这里（同样的行格式，按 responseId+model 去重） */
export const ARCHIVE_JOURNAL = "responses-archive.jsonl";
const CAPTURE_EVENTS = new Set(["response.created", "response.completed", "response.failed", "response.incomplete"]);
/** 日志最后一次写入距今超过这么久、且对应后端进程已退出，才允许合并 */
const COMPACT_IDLE_MS = 10 * 60_000;
/** 两次合并检查的最小间隔 */
const COMPACT_INTERVAL_MS = 60 * 60_000;

/** 大段日志逐行处理时每这么多行让出一次主线程（合并 / 首次读 archive 时可能有几十万行） */
const LINES_PER_YIELD = 5000;
async function eachLine(text: string, fn: (line: string) => void): Promise<string> {
  const lines = text.split("\n");
  const tail = lines.pop() ?? "";
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && i % LINES_PER_YIELD === 0) await new Promise<void>(r => setImmediate(r));
    fn(lines[i]);
  }
  return tail;
}

/**
 * offset 只推进到最后一个换行之后：末尾没写完的半行（可能截断在多字节 UTF-8 字符中间）
 * 不落进游标，下次连同新内容按字节重新读、再整体解码。size/mtimeMs 是上次看到的文件状态。
 */
interface JournalCursor { offset: number; size: number; mtimeMs: number }
interface CaptureReader { models: Map<string, Set<string>>; files: Map<string, JournalCursor>; lastCompactAt: number }
const readers = new Map<string, CaptureReader>();

function acceptRow(models: Map<string, Set<string>>, line: string): void {
  if (!line) return;
  try {
    const row = JSON.parse(line);
    if (row.source !== "codex-native-trace-v1" || !CAPTURE_EVENTS.has(row.eventType)) return;
    if (typeof row.responseId !== "string" || !row.responseId || row.responseId.length > 256 || typeof row.model !== "string" || !row.model || row.model.length > 256) return;
    const values = models.get(row.responseId) ?? new Set<string>();
    values.add(row.model); models.set(row.responseId, values);
  } catch { /* Partial append or unsupported record. */ }
}

async function readRange(file: string, start: number, end: number): Promise<Buffer> {
  const handle = await fs.promises.open(file, "r");
  try {
    const buf = Buffer.alloc(end - start);
    let read = 0;
    while (read < buf.length) {
      const { bytesRead } = await handle.read(buf, read, buf.length - read, start + read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return buf.subarray(0, read);
  } finally { await handle.close(); }
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException)?.code === "EPERM"; }
}

/**
 * 把已退出后端的 responses-<pid>.jsonl 合并进 responses-archive.jsonl。
 *
 * CodexCapture 每个后端进程一份日志、每条响应 created/completed 各一行，此前文件只增不减，
 * 模型监控每 3 秒把所有日志从头读一遍。合并后同一 (responseId, model) 只留一行，
 * 合并完的源文件删除。先写临时文件再 rename，删除失败（文件被占用）就留着：
 * 读取端按集合去重，重复行无害，下一轮再删。
 */
export async function compactCaptureJournals(dataRoot: string, now = Date.now()): Promise<number> {
  const dir = captureDirectory(dataRoot);
  let names: string[];
  try { names = await fs.promises.readdir(dir); } catch { return 0; }
  const victims: string[] = [];
  for (const name of names) {
    const m = JOURNAL.exec(name);
    if (!m) continue;
    try {
      const st = await fs.promises.stat(path.join(dir, name));
      if (now - st.mtimeMs < COMPACT_IDLE_MS || pidAlive(Number(m[1]))) continue;
      victims.push(name);
    } catch { /* Disappeared meanwhile. */ }
  }
  if (!victims.length) return 0;
  const seen = new Set<string>(), lines: string[] = [];
  const keep = (line: string) => {
    const row = (() => { try { return JSON.parse(line); } catch { return undefined; } })();
    if (!row || row.source !== "codex-native-trace-v1" || !CAPTURE_EVENTS.has(row.eventType) || typeof row.responseId !== "string" || typeof row.model !== "string") return;
    const key = `${row.responseId}\u0000${row.model}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(JSON.stringify({ source: row.source, responseId: row.responseId, model: row.model, observedAt: row.observedAt, eventType: row.eventType }));
  };
  const archive = path.join(dir, ARCHIVE_JOURNAL);
  try {
    keep(await eachLine(await fs.promises.readFile(archive, "utf8"), keep));
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") return 0;
  }
  for (const name of victims) {
    try { keep(await eachLine(await fs.promises.readFile(path.join(dir, name), "utf8"), keep)); }
    catch { return 0; }
  }
  const tmp = archive + ".tmp";
  try {
    await fs.promises.writeFile(tmp, lines.length ? lines.join("\n") + "\n" : "", "utf8");
    await fs.promises.rename(tmp, archive);
  } catch { await fs.promises.rm(tmp, { force: true }).catch(() => undefined); return 0; }
  let removed = 0;
  for (const name of victims) {
    try { await fs.promises.unlink(path.join(dir, name)); removed++; } catch { /* Locked: harmless duplicate, retry next time. */ }
  }
  return removed;
}

/**
 * Read only independently captured native response metadata. Session models never enter here.
 *
 * 增量读取：每个日志记住已读到的字节偏移，只读新追加的部分（末尾半行留到下次）。
 * 文件变短、消失（被合并或清理）时整体重建，保证不残留已删除的证据。
 * 返回的 Map 由读取器持有，调用方只读。
 */
const pendingReads = new Map<string, Promise<ReadonlyMap<string, ReadonlySet<string>>>>();
export function readCapturedModels(dataRoot: string): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  // 同一目录同一时刻只有一次读取（增量游标与合并都不能并发），后来者复用结果
  const dir = captureDirectory(dataRoot);
  const pending = pendingReads.get(dir);
  if (pending) return pending;
  const p = readCapturedModelsOnce(dataRoot).finally(() => pendingReads.delete(dir));
  pendingReads.set(dir, p);
  return p;
}
async function readCapturedModelsOnce(dataRoot: string): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const dir = captureDirectory(dataRoot);
  let reader = readers.get(dir);
  if (!reader) { reader = { models: new Map(), files: new Map(), lastCompactAt: 0 }; readers.set(dir, reader); }
  const now = Date.now();
  if (now - reader.lastCompactAt >= COMPACT_INTERVAL_MS) {
    reader.lastCompactAt = now;
    await compactCaptureJournals(dataRoot, now).catch(() => 0);
  }
  let names: string[];
  try { names = (await fs.promises.readdir(dir)).filter(f => JOURNAL.test(f) || f === ARCHIVE_JOURNAL).sort(); }
  catch { reader.models = new Map(); reader.files.clear(); return reader.models; }
  const stats = new Map<string, fs.Stats>();
  for (const name of names) {
    try { stats.set(name, await fs.promises.stat(path.join(dir, name))); } catch { /* Disappeared meanwhile. */ }
  }
  const rebuild = [...reader.files.keys()].some(name => !stats.has(name)) ||
    [...stats].some(([name, st]) => st.size < (reader!.files.get(name)?.offset ?? 0));
  if (rebuild) { reader.models = new Map(); reader.files.clear(); }
  for (const [name, st] of stats) {
    const cursor = reader.files.get(name) ?? { offset: 0, size: 0, mtimeMs: 0 };
    if (st.size === cursor.size && st.mtimeMs === cursor.mtimeMs) { reader.files.set(name, cursor); continue; }
    try {
      const bytes = await readRange(path.join(dir, name), cursor.offset, st.size);
      const models = reader.models;
      // 按字节找最后一个换行：之前是完整行，整体解码不会切坏多字节字符
      const end = bytes.lastIndexOf(0x0a) + 1;
      await eachLine(bytes.subarray(0, end).toString("utf8"), line => acceptRow(models, line.trim()));
      // 半行若已是完整 JSON（写入方漏了换行）先收下；下次补全后重复收录无害（集合去重）
      if (end < bytes.length) acceptRow(models, bytes.subarray(end).toString("utf8").trim());
      reader.files.set(name, { offset: cursor.offset + end, size: cursor.offset + bytes.length, mtimeMs: st.mtimeMs });
    } catch { /* Retry locked/unreadable journals on the next refresh. */ }
  }
  return reader.models;
}

/** 测试用：丢弃增量读取状态 */
export function resetCaptureReaders(): void { readers.clear(); }

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
    if ((await getCodexCaptureState(dataRoot)).active) throw new Error("采集器正在使用中，请先退出 Codex 再更新采集器");
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
