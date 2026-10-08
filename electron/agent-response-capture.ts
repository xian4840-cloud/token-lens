import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFileSync } from "node:child_process";
import type { ModelMonitorRecord } from "./model-monitor";

export function openCodeCapturePaths(dataRoot: string, configRoot = process.env.OPENCODE_CONFIG_DIR ?? path.join(os.homedir(), ".config", "opencode")) {
  return { plugin: path.join(configRoot, "plugins", "token-lens-response-monitor.js"), journal: path.join(dataRoot, "model-responses", "opencode.jsonl") };
}
export function enableOpenCodeCapture(asset: string, dataRoot: string, configRoot?: string): void {
  const paths = openCodeCapturePaths(dataRoot, configRoot);
  const marker = "// Token Lens response monitor\n";
  if (fs.existsSync(paths.plugin) && !fs.readFileSync(paths.plugin, "utf8").startsWith(marker)) throw new Error("同名插件不是 Token Lens 创建的，无法覆盖");
  const source = fs.readFileSync(asset, "utf8");
  fs.mkdirSync(path.dirname(paths.plugin), { recursive: true });
  fs.copyFileSync(path.join(path.dirname(asset), "_token-lens-fetch-models.cjs"), path.join(path.dirname(paths.plugin), "_token-lens-fetch-models.cjs"));
  fs.writeFileSync(paths.plugin, marker + `const TOKEN_LENS_JOURNAL = ${JSON.stringify(paths.journal)};\n// Capture version 2\n` + source, { mode: 0o600 });
}

export function isOpenCodeCaptureEnabled(dataRoot: string): boolean {
  const paths = openCodeCapturePaths(dataRoot);
  try { return fs.existsSync(path.join(path.dirname(paths.plugin), "_token-lens-fetch-models.cjs")) && fs.readFileSync(paths.plugin, "utf8").startsWith(`// Token Lens response monitor\nconst TOKEN_LENS_JOURNAL = ${JSON.stringify(paths.journal)};\n// Capture version 2\n`); } catch { return false; }
}

export function claudeCapturePaths(dataRoot: string, home = os.homedir()) {
  const directory = path.join(home, ".claude", "token-lens-monitor");
  return { directory, preload: path.join(directory, "claude.cjs"), journal: path.join(dataRoot, "model-responses", "claude-code.jsonl") };
}
function powershell(script: string): string {
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from('$ProgressPreference="SilentlyContinue"\n$ErrorActionPreference="Stop"\n' + script, "utf16le").toString("base64")], { windowsHide: true, encoding: "utf8", timeout: 10_000 }).trim();
  } catch { throw new Error("无法读取或保存 Claude 核验的用户启动设置"); }
}
let bunOptions: string | undefined;
function userBunOptions(): string {
  if (bunOptions === undefined) bunOptions = process.platform === "win32" ? powershell('[Environment]::GetEnvironmentVariable("BUN_OPTIONS", "User")') : process.env.BUN_OPTIONS ?? "";
  return bunOptions;
}
export function enableClaudeCapture(assetDirectory: string, dataRoot: string): void {
  if (process.platform !== "win32") throw new Error("当前 Claude 进程内核验支持 Windows 原生版");
  const paths = claudeCapturePaths(dataRoot);
  // Bun's BUN_OPTIONS parser does not accept quoted whitespace in preload paths.
  if (/\s/.test(paths.preload)) throw new Error("当前用户目录含空格，暂时无法安装原生 Claude 预加载脚本");
  const marker = "// Token Lens Claude monitor\n";
  if (fs.existsSync(paths.preload) && !fs.readFileSync(paths.preload, "utf8").startsWith(marker)) throw new Error("同名脚本不是 Token Lens 创建的，无法覆盖");
  fs.mkdirSync(paths.directory, { recursive: true });
  fs.copyFileSync(path.join(assetDirectory, "_token-lens-fetch-models.cjs"), path.join(paths.directory, "_token-lens-fetch-models.cjs"));
  fs.writeFileSync(paths.preload, marker + fs.readFileSync(path.join(assetDirectory, "claude.cjs"), "utf8"), { mode: 0o600 });
  fs.writeFileSync(path.join(paths.directory, "claude-journal.json"), JSON.stringify(paths.journal), { mode: 0o600 });
  const flag = `--preload=${paths.preload.replaceAll("\\", "/")}`;
  const previous = userBunOptions();
  const next = previous.split(/\s+/).includes(flag) ? previous : `${previous} ${flag}`.trim();
  const quoted = `'${next.replaceAll("'", "''")}'`;
  powershell(`$taskEnvironment=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Environment")
$taskEnvironment.SetValue("BUN_OPTIONS", ${quoted}, [Microsoft.Win32.RegistryValueKind]::String)
$taskEnvironment.Close()
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class TokenLensEnvironment { [DllImport("user32.dll")] public static extern IntPtr GetShellWindow(); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, string l, uint f, uint t, out UIntPtr r); }'
$taskResult=[UIntPtr]::Zero
[void][TokenLensEnvironment]::SendMessageTimeout([TokenLensEnvironment]::GetShellWindow(), 26, [UIntPtr]::Zero, "Environment", 2, 1000, [ref]$taskResult)`);
  bunOptions = next;
  process.env.BUN_OPTIONS = next;
}
export function isClaudeCaptureEnabled(dataRoot: string): boolean {
  const paths = claudeCapturePaths(dataRoot);
  try {
    return fs.existsSync(path.join(paths.directory, "_token-lens-fetch-models.cjs")) && fs.readFileSync(paths.preload, "utf8").startsWith("// Token Lens Claude monitor\n") && JSON.parse(fs.readFileSync(path.join(paths.directory, "claude-journal.json"), "utf8")) === paths.journal && userBunOptions().split(/\s+/).includes(`--preload=${paths.preload.replaceAll("\\", "/")}`);
  } catch { return false; }
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
