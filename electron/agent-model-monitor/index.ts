import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  CLAUDE_CODE_DIR,
  GROK_SESSIONS_DIR,
  ANTIGRAVITY_CONVERSATIONS_DIR,
  findOpenCodeDb,
} from "../local-usage/paths";
import { readAntigravityModelSession } from "../antigravity-model-monitor";
import {
  isOpenCodeCaptureEnabled,
  isOpenCodeCaptureInstalled,
  readOpenCodeCaptures,
  isClaudeCaptureEnabled,
  isClaudeCaptureInstalled,
  readClaudeCaptures,
} from "../agent-response-capture";
import { listJsonlFilesWithStat } from "../local-usage/files";
import { mapPool } from "../lib/concurrency";
import { secToIso } from "../lib/time";
import {
  getModelMonitorState,
  summarizeModelMonitor,
  validateModelMonitorDate,
  type ModelMonitorState,
  type ModelMonitorRecord,
} from "../model-monitor";
import { readClaude } from "./claude";
import { readOpenCodeCached } from "./opencode";
import { exists, lines, stamp, text, tokens, type Group } from "./shared";

const descriptions = {
  "claude-code":
    "在 Claude Code 原生进程内核对实际请求与服务器响应模型，只保存模型元数据，无额外后台进程。",
  opencode: "本地插件核对该次所选模型与服务器返回的模型，无额外后台进程。",
  "grok-build":
    "读取本机会话与压缩归档中的响应模型，按天、模型和会话汇总核验结果。无需额外采集器。",
  antigravity:
    "读取 Antigravity 生成记录中的 response_model，并按明确的步骤编号关联。所选模型来自独立的会话配置；名称后缀或别名差异不等于模型错配。此读取方式已在本机 2.19.1 验证。",
};
const cache = new Map<string, { stamp: string; group: Group }>();
async function grokArchives(dir: string): Promise<string[]> {
  const lists = await Promise.all(
    ["compaction_requests", "recap_requests"].map(async (name) => {
      try {
        return (await fs.promises.readdir(path.join(dir, name)))
          .filter((f) => f.endsWith(".json"))
          .map((f) => path.join(dir, name, f));
      } catch {
        return [];
      }
    }),
  );
  return lists.flat().sort();
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
async function readGrok(file: string, modifiedAt: string): Promise<Group> {
  const dir = path.dirname(file),
    session = { id: dir, name: path.basename(dir), modifiedAt, archived: false };
  try {
    session.name =
      text(
        JSON.parse(await fs.promises.readFile(path.join(dir, "summary.json"), "utf8"))
          .generated_title,
      ) ?? session.name;
  } catch {
    /* Optional title. */
  }
  const turns: { start: number; end?: number; model?: string }[] = [];
  const events = path.join(dir, "events.jsonl");
  if (await exists(events))
    await lines(events, (row) => {
      const time = typeof row.ts === "string" ? Date.parse(row.ts) : NaN;
      if (!Number.isFinite(time)) return;
      if (row.type === "turn_started") {
        // An interrupted turn ends at the next start; retain ambiguity at second boundaries.
        if (turns.length && turns[turns.length - 1].end === undefined)
          turns[turns.length - 1].end = time;
        turns.push({ start: time, model: text(row.model_id) });
      } else if (row.type === "turn_ended" && turns.length) turns[turns.length - 1].end = time;
    });
  const records = new Map<string, ModelMonitorRecord>();
  // Rewinds can reuse an index after deleting the old history. Reject that index for every old/new round.
  const bindings = new Map<number, Set<string>>();
  const prompts = new Map<string, Set<number>>();
  let bindingIndex: number | undefined;
  await lines(file, (row) => {
    const u = row.params?.update;
    if (
      u?.sessionUpdate === "user_message_chunk" &&
      Number.isSafeInteger(u._meta?.promptIndex) &&
      u._meta.promptIndex >= 0
    ) {
      bindingIndex = u._meta.promptIndex;
      if (u.content?.type === "text" && typeof u.content.text === "string") {
        const key = digest(u.content.text),
          indices = prompts.get(key) ?? new Set<number>();
        indices.add(u._meta.promptIndex);
        prompts.set(key, indices);
      }
    } else if (u?.sessionUpdate === "turn_completed") {
      const id = text(u.prompt_id);
      if (bindingIndex !== undefined && id) {
        const ids = bindings.get(bindingIndex) ?? new Set<string>();
        ids.add(id);
        bindings.set(bindingIndex, ids);
      }
      bindingIndex = undefined;
    }
  });
  const history = new Map<number, (string | undefined)[]>(),
    repeated = new Set<number>();
  const snapshots = new Map<number, { hash: string; model?: string }[]>();
  const conflicted = new Set<number>();
  function merge(rows: Map<number, { hash: string; model?: string }[]>) {
    for (const [index, items] of rows) {
      const previous = snapshots.get(index);
      if (!previous) {
        snapshots.set(index, items);
        continue;
      }
      // Repeated snapshots must be identical prefixes, never unions of potentially different branches.
      if (
        !previous
          .slice(0, Math.min(previous.length, items.length))
          .every((r, i) => r.hash === items[i].hash)
      )
        conflicted.add(index);
      else if (items.length > previous.length) snapshots.set(index, items);
    }
  }
  const liveRows = new Map<number, { hash: string; model?: string }[]>();
  function promptIndex(row: any): number | undefined {
    if (Number.isSafeInteger(row.prompt_index) && row.prompt_index >= 0) return row.prompt_index;
    const parts = row.content;
    const content =
      typeof parts === "string"
        ? parts
        : Array.isArray(parts) &&
            parts.every((p) => p.type === "text" && typeof p.text === "string")
          ? parts.map((p) => p.text).join("")
          : undefined;
    const unwrapped =
      typeof content === "string"
        ? (/^<user_query>\n([\s\S]*)\n<\/user_query>$/.exec(content)?.[1] ?? content)
        : undefined;
    const candidates = unwrapped === undefined ? undefined : prompts.get(digest(unwrapped));
    return candidates?.size === 1 ? [...candidates][0] : undefined;
  }
  let historyIndex: number | undefined;
  const historyFile = path.join(dir, "chat_history.jsonl");
  if (await exists(historyFile))
    await lines(historyFile, (row) => {
      if (
        row.type === "user" &&
        (Number.isSafeInteger(row.prompt_index) ||
          !row.synthetic_reason ||
          row.synthetic_reason === "human")
      ) {
        historyIndex = promptIndex(row);
        if (historyIndex === undefined) return;
        if (history.has(historyIndex!)) repeated.add(historyIndex!);
        else {
          history.set(historyIndex!, []);
          liveRows.set(historyIndex!, []);
        }
      } else if (row.type === "assistant" && historyIndex !== undefined)
        liveRows
          .get(historyIndex)!
          .push({ hash: digest(JSON.stringify(row)), model: text(row.model_id) });
    });
  merge(liveRows);
  for (const archive of await grokArchives(dir)) {
    try {
      // ponytail: one native archive at a time, discard bodies after extracting hashes/model names.
      if ((await fs.promises.stat(archive)).size > 16 * 1024 * 1024) continue;
      const rows = JSON.parse(await fs.promises.readFile(archive, "utf8")).chat_history;
      if (!Array.isArray(rows)) continue;
      const archived = new Map<number, { hash: string; model?: string }[]>();
      let index: number | undefined;
      for (const row of rows) {
        if (row.type === "user" && (!row.synthetic_reason || row.synthetic_reason === "human")) {
          index = promptIndex(row);
          if (index !== undefined) {
            if (archived.has(index)) {
              conflicted.add(index);
              index = undefined;
            } else archived.set(index, []);
          }
        } else if (
          row.type === "user" &&
          ![
            "system_reminder",
            "length_continue",
            "project_instructions",
            "compaction_meta",
            "auto_continue",
            "auto_recovery",
            "interjection",
            "stop_hook_feedback",
          ].includes(row.synthetic_reason)
        )
          index = undefined;
        else if (row.type === "assistant" && index !== undefined)
          archived
            .get(index)!
            .push({ hash: digest(JSON.stringify(row)), model: text(row.model_id) });
      }
      merge(archived);
    } catch {
      /* In-progress/malformed archive cannot supply evidence. */
    }
  }
  for (const [index, rows] of snapshots)
    if (!conflicted.has(index))
      history.set(
        index,
        rows.map((r) => r.model),
      );
  let pending: { index: number; model?: string } | undefined,
    ambiguous = false;
  const completedIndices = new Set<number>();
  await lines(file, (row) => {
    const u = row.params?.update;
    if (
      u?.sessionUpdate === "user_message_chunk" &&
      Number.isSafeInteger(u._meta?.promptIndex) &&
      u._meta.promptIndex >= 0
    ) {
      const index = u._meta.promptIndex,
        model = text(u._meta.modelId);
      if (pending && (pending.index !== index || pending.model !== model)) ambiguous = true;
      pending = { index, model };
      return;
    }
    if (u?.sessionUpdate !== "turn_completed" || !u.usage) return;
    const id = text(u.prompt_id);
    if (id && records.has(id)) return; // replayed terminal does not consume a different prompt's binding
    const selected = pending;
    pending = undefined;
    const reliable =
      selected &&
      !ambiguous &&
      bindings.get(selected.index)?.size === 1 &&
      !repeated.has(selected.index) &&
      !conflicted.has(selected.index) &&
      !completedIndices.has(selected.index);
    ambiguous = false;
    if (selected) completedIndices.add(selected.index);
    const startedAt = secToIso(typeof row.timestamp === "number" ? row.timestamp : undefined);
    if (!startedAt || !id) return;
    const second = Math.floor(Date.parse(startedAt) / 1000);
    // ponytail: linear interval lookup per turn; binary search if large Grok histories become slow.
    const candidates = turns.filter(
      (t) =>
        Math.floor(t.start / 1000) <= second &&
        (t.end === undefined || Math.floor(t.end / 1000) >= second),
    );
    const inputTokens = tokens(u.usage.inputTokens),
      outputTokens = tokens(u.usage.outputTokens);
    const models =
      u.usage.modelUsage && typeof u.usage.modelUsage === "object"
        ? Object.keys(u.usage.modelUsage).filter((m) => text(m) && m !== "unknown")
        : [];
    // modelUsage falls back to the configured model when response.model_id is absent.
    // Do not promote this mixed provenance to independently recorded response evidence.
    const requestedModel = selected
      ? selected.model
      : candidates.length === 1
        ? candidates[0].model
        : undefined;
    const responses = reliable ? (history.get(selected.index) ?? []) : [];
    const modelCalls = tokens(u.usage.modelCalls);
    // A compressed/replayed history must never verify more calls than the authoritative usage ledger.
    const usable = responses.length <= modelCalls ? responses : [];
    const matchedCalls = requestedModel ? usable.filter((m) => m === requestedModel).length : 0;
    const mismatchedCalls = requestedModel
      ? usable.filter((m) => m && m !== requestedModel).length
      : 0;
    const responseModels = [...new Set(usable.filter((m): m is string => !!m))];
    const unverifiedCalls = modelCalls - matchedCalls - mismatchedCalls;
    records.set(id, {
      id,
      startedAt,
      requestedModel,
      responseModel: responseModels.length ? responseModels.join("、") : undefined,
      reportedModel: models.length ? models.join("、") : undefined,
      evidence: responseModels.length ? "assistant-message" : "usage",
      modelCalls,
      matchedCalls,
      mismatchedCalls,
      unverifiedCalls,
      responseCalls: usable.filter((m) => !!m).length,
      status: mismatchedCalls
        ? "mismatch"
        : matchedCalls === modelCalls && modelCalls > 0
          ? "match"
          : "unknown",
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    });
  });
  return { session, records: [...records.values()] };
}

export async function getAgentModelMonitorState(
  date?: unknown,
  source: unknown = "codex",
  dataRoot?: string,
  rootOverride?: string,
): Promise<ModelMonitorState> {
  validateModelMonitorDate(date);
  if (
    source !== "codex" &&
    source !== "claude-code" &&
    source !== "opencode" &&
    source !== "grok-build" &&
    source !== "antigravity"
  )
    throw new Error("监测来源无效");
  if (source === "codex") return getModelMonitorState(date, rootOverride, dataRoot);
  const root =
    rootOverride ??
    (source === "claude-code"
      ? CLAUDE_CODE_DIR
      : source === "grok-build"
        ? GROK_SESSIONS_DIR
        : source === "antigravity"
          ? ANTIGRAVITY_CONVERSATIONS_DIR
          : findOpenCodeDb()) ??
    "";
  const state: ModelMonitorState = {
    source,
    description: descriptions[source],
    root,
    scannedAt: new Date().toISOString(),
    sessions: [],
    days: [],
    selectedDate: date,
    callCount: 0,
    records: [],
    capture: { supported: false, ready: false, active: false, responseCount: 0 },
  };
  let groups: Group[] = [];
  if (source === "opencode") {
    // 找不到数据库（例如已卸载 OpenCode）时也要带上采集安装状态，好让用户还能「关闭采集」清理插件
    if (!root)
      return {
        ...state,
        unavailable: "未找到本地 OpenCode 数据库",
        ...(dataRoot
          ? {
              agentCapture: {
                enabled: false,
                installed: isOpenCodeCaptureInstalled(dataRoot),
                requestCount: 0,
                responseCount: 0,
              },
            }
          : {}),
      };
    // ponytail: query metadata per refresh; incremental SQL if very large histories become slow.
    try {
      groups = await readOpenCodeCached(root);
    } catch {
      return { ...state, unavailable: "OpenCode 数据库暂时无法读取或版本结构不兼容" };
    }
    if (dataRoot) {
      const captures = await readOpenCodeCaptures(dataRoot);
      state.agentCapture = {
        enabled: isOpenCodeCaptureEnabled(dataRoot),
        installed: isOpenCodeCaptureInstalled(dataRoot),
        requestCount: captures.length,
        responseCount: captures.filter((c) => c.responseModel).length,
      };
      for (const group of groups) {
        const byAssistant = new Map<string, typeof captures>();
        for (const c of captures)
          if (c.sessionId === group.session.id && c.assistantId) {
            const rows = byAssistant.get(c.assistantId) ?? [];
            rows.push(c);
            byAssistant.set(c.assistantId, rows);
          }
        group.records = group.records.flatMap((r) => {
          const rows = byAssistant.get(r.id);
          if (!rows?.length) return [r];
          // Keep authoritative database usage once, even when a request was retried.
          return rows.map((c, index) => ({
            ...c,
            inputTokens: index === rows.length - 1 ? r.inputTokens : 0,
            outputTokens: index === rows.length - 1 ? r.outputTokens : 0,
            totalTokens: index === rows.length - 1 ? r.totalTokens : 0,
          }));
        });
      }
      // A real request may finish before its assistant database row, or be an auxiliary call.
      const attached = new Set(groups.flatMap((g) => g.records.map((r) => r.id)));
      for (const c of captures)
        if (!attached.has(c.id)) {
          let group = groups.find((g) => g.session.id === c.sessionId);
          if (!group) {
            group = {
              session: {
                id: c.sessionId!,
                name: c.sessionId!,
                modifiedAt: c.startedAt,
                archived: false,
              },
              records: [],
            };
            groups.push(group);
          }
          group.records.push(c);
        }
    }
  } else if (source === "antigravity") {
    let files: string[];
    try {
      files = (await fs.promises.readdir(root))
        .filter((f) => f.endsWith(".db"))
        .map((f) => path.join(root, f));
    } catch {
      return { ...state, unavailable: "未找到或无法读取 Antigravity 本地会话目录" };
    }
    const live = new Set(files.map((f) => `${source}:${f}`));
    for (const key of cache.keys())
      if (key.startsWith(`${source}:`) && !live.has(key)) cache.delete(key);
    let failed = 0;
    for (const file of files) {
      const key = `${source}:${file}`,
        current = (await Promise.all([file, file + "-wal"].map(stamp))).join("|");
      try {
        const hit = cache.get(key),
          group = hit?.stamp === current ? hit.group : readAntigravityModelSession(file);
        cache.set(key, { stamp: current, group });
        groups.push(group);
      } catch {
        failed++;
      }
    }
    if (failed) state.unavailable = `${failed} 个 Antigravity 会话库无法读取或版本结构不兼容`;
    else if (files.length && groups.every((g) => !g.records.length))
      state.unavailable = "会话中未找到可关联的响应模型，当前版本或历史记录可能未保存该字段";
  } else {
    const files = (await listJsonlFilesWithStat(root))
      .filter((f) => source !== "grok-build" || path.basename(f.path) === "updates.jsonl")
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    const live = new Set(files.map((f) => `${source}:${f.path}`));
    for (const key of cache.keys())
      if (key.startsWith(`${source}:`) && !live.has(key)) cache.delete(key);
    const results = await mapPool(files, 3, async (f) => {
      const key = `${source}:${f.path}`,
        dir = path.dirname(f.path);
      const deps = [
        f.path,
        ...(source === "grok-build"
          ? [
              path.join(dir, "events.jsonl"),
              path.join(dir, "summary.json"),
              path.join(dir, "chat_history.jsonl"),
              ...(await grokArchives(dir)),
            ]
          : []),
      ];
      // Claude 单文件：列目录时已拿到 mtime/size，不必再 stat 一次
      const current =
        source === "claude-code"
          ? `${f.path}:${f.mtimeMs}:${f.size}`
          : (await Promise.all(deps.map(async (d) => `${d}:${await stamp(d)}`))).join("|");
      const hit = cache.get(key);
      if (hit?.stamp === current) return hit.group;
      const group = await (source === "claude-code"
        ? readClaude(f.path, new Date(f.mtimeMs).toISOString())
        : readGrok(f.path, new Date(f.mtimeMs).toISOString()));
      cache.set(key, { stamp: current, group });
      return group;
    });
    groups = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) state.unavailable = `${failed} 个会话文件暂时无法读取，汇总可能不完整`;
  }
  if (source === "claude-code" && dataRoot) {
    const captures = await readClaudeCaptures(dataRoot);
    state.agentCapture = {
      enabled: isClaudeCaptureEnabled(dataRoot),
      installed: isClaudeCaptureInstalled(dataRoot),
      requestCount: captures.length,
      responseCount: captures.filter((c) => c.responseModel).length,
    };
    const byResponse = new Map<string, ModelMonitorRecord[]>();
    for (const c of captures)
      if (c.responseId) {
        const rows = byResponse.get(c.responseId) ?? [];
        rows.push(c);
        byResponse.set(c.responseId, rows);
      }
    const attached = new Set<string>(),
      historical = new Set<string>();
    groups = groups.map((g) => ({
      ...g,
      records: g.records.flatMap((r) => {
        if (historical.has(r.id)) return []; // copied/forked assistant history
        historical.add(r.id);
        const rows = r.responseId ? byResponse.get(r.responseId) : undefined;
        if (!rows?.length) return [r];
        return rows.map((c, i) => {
          attached.add(c.id);
          return {
            ...c,
            inputTokens: i === rows.length - 1 ? r.inputTokens : 0,
            outputTokens: i === rows.length - 1 ? r.outputTokens : 0,
            totalTokens: i === rows.length - 1 ? r.totalTokens : 0,
          };
        });
      }),
    }));
    for (const c of captures)
      if (!attached.has(c.id)) {
        let group = c.sessionId
          ? groups.find((g) => path.basename(g.session.id, ".jsonl") === c.sessionId)
          : undefined;
        if (!group) {
          const id = c.sessionId ?? "claude-captured";
          group = groups.find((g) => g.session.id === id);
          if (!group) {
            group = {
              session: {
                id,
                name: c.sessionId ?? "Claude 实时请求",
                modifiedAt: c.startedAt,
                archived: false,
              },
              records: [],
            };
            groups.push(group);
          }
        }
        group.records.push(c);
      }
  }
  state.sessions = groups.map((g) => g.session);
  summarizeModelMonitor(state, groups, date);
  if (!groups.length && !state.unavailable) state.unavailable = "未找到该 Agent 的本地会话记录";
  return state;
}
