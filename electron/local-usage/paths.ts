import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const home = os.homedir();

/** Claude Code：~/.claude/projects 下递归的 .jsonl */
export const CLAUDE_CODE_DIR = path.join(home, ".claude", "projects");

/** Codex：~/.codex/sessions 下递归的 .jsonl */
export const CODEX_SESSIONS_DIR = path.join(home, ".codex", "sessions");

/** Codex：~/.codex/config.toml（读 model / default_subagent_model） */
export const CODEX_CONFIG = path.join(home, ".codex", "config.toml");

/** OpenCode 数据库候选路径（跨平台），首个存在即用。 */
export function findOpenCodeDb(): string | undefined {
  const candidates = [
    path.join(home, ".local", "share", "opencode", "opencode.db"),
    path.join(home, ".opencode", "opencode.db"),
  ];
  const local = process.env.LOCALAPPDATA;
  if (local) candidates.push(path.join(local, "opencode", "opencode.db"));
  return candidates.find((p) => fs.existsSync(p));
}

/** Gemini Antigravity：~/.gemini/antigravity/conversations 下的会话 SQLite。
 * （~/.gemini/antigravity-ide 与 antigravity-backup 仅为骨架目录，无会话数据，不扫） */
export const ANTIGRAVITY_CONVERSATIONS_DIR = path.join(
  home,
  ".gemini",
  "antigravity",
  "conversations",
);

/** Grok Build：~/.grok/sessions/<编码工作目录>/<session-id>/updates.jsonl */
export const GROK_SESSIONS_DIR = path.join(home, ".grok", "sessions");
