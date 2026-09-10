import fs from "node:fs";
import path from "node:path";
import {
  ANTIGRAVITY_CONVERSATIONS_DIR,
  CLAUDE_CODE_DIR,
  CODEX_SESSIONS_DIR,
  findOpenCodeDb,
  GROK_SESSIONS_DIR,
} from "../local-usage/paths";
import type { LocalSource } from "../local-usage/types";
import { logError } from "../lib/logger";
import type { PetActivity } from "./types";

/** 会话文件停止写入后多久算空闲。秒级足够当桌宠，不是实时进度条。 */
const IDLE_AFTER_MS = 12_000;
const DEBOUNCE_MS = 250;

export type ActivityListener = (activity: PetActivity) => void;

let listener: ActivityListener | null = null;
let watchers: fs.FSWatcher[] = [];
let idleTimer: NodeJS.Timeout | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
let last: PetActivity = { status: "idle" };

/** 从会话文件路径判断是哪家 agent。路径统一成 / 再比，兼容 Windows。 */
export function inferSourceFromPath(filePath: string): LocalSource | undefined {
  const n = filePath.replace(/\\/g, "/").toLowerCase();
  if (n.includes("/.claude/")) return "claude-code";
  if (n.includes("/.codex/")) return "codex";
  if (n.includes("/.grok/")) return "grok-build";
  if (n.includes("/antigravity/")) return "antigravity";
  if (n.includes("/opencode/")) return "opencode";
  return undefined;
}

/** 只认会话/库文件，忽略编辑器临时文件。filename 为空时仍算一次活动。 */
export function isWatchableFile(name: string | null): boolean {
  if (!name) return true;
  const lower = name.toLowerCase();
  if (lower.endsWith(".tmp") || lower.endsWith(".swp") || lower.endsWith("~")) {
    return false;
  }
  return (
    lower.endsWith(".jsonl") ||
    lower.endsWith(".json") ||
    lower.endsWith(".db") ||
    lower.endsWith(".sqlite") ||
    lower.endsWith(".sqlite3")
  );
}

export function getLastActivity(): PetActivity {
  return last;
}

function emit(next: PetActivity): void {
  last = next;
  listener?.(next);
}

function markWorking(source: LocalSource | undefined): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    emit({ status: "working", source });
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      emit({ status: "idle" });
    }, IDLE_AFTER_MS);
  }, DEBOUNCE_MS);
}

function watchTargets(): { dir: string; source: LocalSource }[] {
  const targets: { dir: string; source: LocalSource }[] = [
    { dir: CLAUDE_CODE_DIR, source: "claude-code" },
    { dir: CODEX_SESSIONS_DIR, source: "codex" },
    { dir: GROK_SESSIONS_DIR, source: "grok-build" },
    { dir: ANTIGRAVITY_CONVERSATIONS_DIR, source: "antigravity" },
  ];
  const oc = findOpenCodeDb();
  if (oc) targets.push({ dir: path.dirname(oc), source: "opencode" });
  return targets;
}

/** 开始盯本地会话目录。目录不存在就跳过，不阻塞其它来源。 */
export function startActivityWatch(onChange: ActivityListener): void {
  stopActivityWatch();
  listener = onChange;
  last = { status: "idle" };

  for (const { dir, source } of watchTargets()) {
    if (!fs.existsSync(dir)) continue;
    try {
      const watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
        const name = filename == null ? null : String(filename);
        if (!isWatchableFile(name)) return;
        markWorking(source);
      });
      watcher.on("error", (err) => {
        logError("pet-watch", err);
      });
      watchers.push(watcher);
    } catch (e) {
      logError("pet-watch", e);
    }
  }
}

export function stopActivityWatch(): void {
  for (const w of watchers) {
    try {
      w.close();
    } catch {
      // 关闭失败不影响退出
    }
  }
  watchers = [];
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  listener = null;
  last = { status: "idle" };
}
