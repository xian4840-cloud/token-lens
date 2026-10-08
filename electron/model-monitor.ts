import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { listJsonlFilesWithStat } from "./local-usage/files";
import { extractCodexIncrements } from "./local-usage/codex";
import { toDateKey } from "./local-usage/date";
import { mapPool } from "./lib/concurrency";
import { getCodexCaptureState, readCapturedModels, type CodexCaptureState } from "./codex-capture";

export type ModelMonitorSource = "codex" | "claude-code" | "opencode" | "grok-build" | "antigravity";
export interface ModelMonitorSession { id: string; name: string; modifiedAt: string; archived: boolean }
export interface ModelMonitorRecord {
  id: string;
  startedAt: string;
  requestedModel?: string;
  responseModel?: string;
  sentModel?: string;
  matchedCalls?: number;
  mismatchedCalls?: number;
  unverifiedCalls?: number;
  responseCalls?: number;
  responseId?: string;
  reportedModel?: string;
  evidence?: "response" | "assistant-message" | "generation-response" | "usage" | "selection";
  modelCalls?: number;
  status: "match" | "mismatch" | "unknown";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  sessionId?: string;
  sessionName?: string;
  archived?: boolean;
}
export interface ModelMonitorDay {
  date: string;
  sessionCount: number;
  callCount: number;
  totalTokens: number;
  verifiedCount: number;
  mismatchCount: number;
  unknownCount: number;
  responseCount: number;
  models: string[];
}
export interface ModelMonitorSessionDay {
  sessionId: string; name: string; model?: string; modelBasis?: "request" | "response" | "unknown"; callCount: number; matchedCount: number; mismatchedCount: number; unknownCount: number; totalTokens: number;
}
export interface ModelMonitorState {
  source: ModelMonitorSource;
  description?: string;
  root: string;
  scannedAt: string;
  sessions: ModelMonitorSession[];
  days: ModelMonitorDay[];
  selectedDate?: string;
  callCount: number;
  records: ModelMonitorRecord[];
  sessionDays?: ModelMonitorSessionDay[];
  agentCapture?: { enabled: boolean; requestCount: number; responseCount: number };
  capture: CodexCaptureState;
  unavailable?: string;
}

type UsageEvents = Parameters<typeof extractCodexIncrements>[0];
interface ParsedSession { records: ModelMonitorRecord[] }
const cache = new Map<string, { mtimeMs: number; size: number; parsed: ParsedSession }>();
let titleCache: { path: string; mtimeMs: number; titles: Map<string, string> } | undefined;
function smallString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : undefined;
}

/** Never substitute a selected/configured model for an independently recorded response model. */
export function observationsFromEvents(events: UsageEvents, responseModels: ReadonlyMap<string, string>): ModelMonitorRecord[] {
  return extractCodexIncrements(events).increments.map((inc, index) => {
    const responseModel = inc.responseId ? responseModels.get(inc.responseId) : undefined;
    return {
      id: inc.responseId ?? `${inc.ts}:${index}`,
      startedAt: inc.ts, requestedModel: inc.model, responseModel, responseId: inc.responseId,
      status: inc.model && responseModel ? inc.model === responseModel ? "match" : "mismatch" : "unknown",
      inputTokens: inc.input, outputTokens: inc.output, totalTokens: inc.input + inc.output,
    };
  });
}

async function readSession(file: string): Promise<ParsedSession> {
  const stat = fs.statSync(file);
  const hit = cache.get(file);
  if (hit?.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.parsed;
  const events: UsageEvents = [];
  const responses = new Map<string, string>();
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      let event: any;
      try { event = JSON.parse(line); } catch { continue; }
      if (!event || typeof event !== "object") continue;
      const p = event.payload ?? {};
      if (["session_meta", "turn_context", "token_usage_record"].includes(event.type) || (event.type === "event_msg" && p.type === "token_count")) {
        // Reuse the existing usage parser; retain no conversation contents.
        events.push({ type: event.type, timestamp: event.timestamp, payload: {
          type: p.type, thread_source: p.thread_source, model: smallString(p.model),
          info: p.info, usage: p.usage, response_id: smallString(p.response_id),
        } });
      }
      // Accept an explicit Responses envelope only, correlated by response ID.
      // Assistant response_item.model and thread settings are not independent server evidence.
      const response = p.response ?? (p.object === "response" ? p : event.object === "response" ? event : undefined);
      const id = smallString(response?.id), model = smallString(response?.model);
      if (id && model) responses.set(id, model);
    }
  } finally { lines.close(); stream.destroy(); }
  const observations = observationsFromEvents(events, responses);
  // Cache only call metadata, never prompts; daily totals must include older calls too.
  const parsed = { records: observations };
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, parsed });
  return parsed;
}

function readTitles(root: string): Map<string, string> {
  const index = path.join(root, "session_index.jsonl");
  try {
    const stat = fs.statSync(index);
    if (titleCache?.path === index && titleCache.mtimeMs === stat.mtimeMs) return titleCache.titles;
    const titles = new Map<string, string>();
    for (const line of fs.readFileSync(index, "utf8").split("\n")) {
      try {
        const entry = JSON.parse(line);
        const id = smallString(entry.id), name = smallString(entry.thread_name);
        if (id && name) titles.set(id, name);
      } catch { /* Ignore partial lines. */ }
    }
    titleCache = { path: index, mtimeMs: stat.mtimeMs, titles };
    return titles;
  } catch { return new Map(); }
}

export function validateModelMonitorDate(date?: unknown): asserts date is string | undefined {
  if (date !== undefined && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || toDateKey(`${date}T12:00:00`) !== date)) throw new Error("日期无效");
}

export async function getModelMonitorState(date?: unknown, root = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), dataRoot = root): Promise<ModelMonitorState> {
  validateModelMonitorDate(date);
  const titles = readTitles(root);
  const files = [
    ...listJsonlFilesWithStat(path.join(root, "sessions")).map(f => ({ ...f, archived: false })),
    ...listJsonlFilesWithStat(path.join(root, "archived_sessions")).map(f => ({ ...f, archived: true })),
  ].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const paths = new Map<string, string>();
  const sessions: ModelMonitorSession[] = [];
  for (const file of files) {
    const id = path.basename(file.path, ".jsonl").match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i)?.[1];
    if (!id || paths.has(id)) continue;
    paths.set(id, file.path);
    sessions.push({ id, name: titles.get(id) ?? id, modifiedAt: new Date(file.mtimeMs).toISOString(), archived: file.archived });
  }
  const state: ModelMonitorState = { source: "codex", root, scannedAt: new Date().toISOString(), sessions, days: [], selectedDate: date, callCount: 0, records: [], capture: getCodexCaptureState(dataRoot) };
  if (!sessions.length) return { ...state, unavailable: "未找到本地 Codex 会话记录" };
  const livePaths = new Set(paths.values());
  for (const file of cache.keys()) if (!livePaths.has(file)) cache.delete(file);
  const results = await mapPool(sessions, 3, session => readSession(paths.get(session.id)!));
  const capturedModels = readCapturedModels(dataRoot);
  const groups = sessions.flatMap((session, i) => {
    const result = results[i];
    if (result.status === "rejected") return [];
    return [{ session, records: result.value.records.map(original => {
      const models = original.responseId ? capturedModels.get(original.responseId) : undefined;
      // Overlay after caching: new evidence must update an unchanged rollout.
      return models?.size ? { ...original, evidence: "response" as const,
        responseModel: [...models].join(" → "),
        status: original.requestedModel ? [...models].every(model => model === original.requestedModel) ? "match" as const : "mismatch" as const : "unknown" as const,
      } : original;
    }) }];
  });
  summarizeModelMonitor(state, groups, date);
  const unreadable = results.filter(r => r.status === "rejected").length;
  if (unreadable) state.unavailable = `${unreadable} 个会话文件暂时无法读取，汇总可能不完整，稍后会重试`;
  return state;
}

export function summarizeModelMonitor(state: ModelMonitorState, groups: { session: ModelMonitorSession; records: ModelMonitorRecord[] }[], date?: string): void {
  const days = new Map<string, ModelMonitorDay & { sessionIds: Set<string> }>();
  const seen = new Set<string>();
  const sessions = new Map<string, ModelMonitorSessionDay>();
  // A response copied into fork history contributes to the daily totals only once.
  for (let i = groups.length - 1; i >= 0; i--) {
    const { session, records } = groups[i];
    for (const record of records) {
      const key = toDateKey(record.startedAt);
      // OpenCode's capture IDs identify physical requests; a provider can replay a response ID on a retry.
      const dedup = state.source !== "opencode" && !(state.source === "claude-code" && record.evidence === "response");
      if (!key || (dedup && record.responseId && seen.has(record.responseId))) continue;
      if (dedup && record.responseId) seen.add(record.responseId);
      let day = days.get(key);
      if (!day) {
        day = { date: key, sessionCount: 0, callCount: 0, totalTokens: 0, verifiedCount: 0, mismatchCount: 0, unknownCount: 0, responseCount: 0, models: [], sessionIds: new Set() };
        days.set(key, day);
      }
      day.sessionIds.add(session.id);
      const calls = record.modelCalls ?? 1;
      const matched = record.matchedCalls ?? (record.status === "match" ? calls : 0);
      const mismatched = record.mismatchedCalls ?? (record.status === "mismatch" ? calls : 0);
      const unknown = record.unverifiedCalls ?? calls - matched - mismatched;
      day.callCount += calls;
      day.totalTokens += record.totalTokens;
      day.unknownCount += unknown;
      day.verifiedCount += matched + mismatched;
      day.mismatchCount += mismatched;
      day.responseCount += record.responseCalls ?? (record.responseModel ? calls : 0);
      for (const model of [record.requestedModel, record.responseModel, record.reportedModel]) if (model && !day.models.includes(model)) day.models.push(model);
      if (key === date) {
        const model = record.requestedModel ?? record.responseModel;
        const modelBasis = record.requestedModel ? "request" : record.responseModel ? "response" : "unknown";
        const groupKey = JSON.stringify([session.id, modelBasis, model]);
        const item = sessions.get(groupKey) ?? { sessionId: session.id, name: session.name, model, modelBasis, callCount: 0, matchedCount: 0, mismatchedCount: 0, unknownCount: 0, totalTokens: 0 };
        item.callCount += calls; item.matchedCount += matched; item.mismatchedCount += mismatched; item.unknownCount += unknown; item.totalTokens += record.totalTokens;
        sessions.set(groupKey, item);
        state.records.push({ ...record, id: `${session.id}:${record.id}`, sessionId: session.id, sessionName: session.name, archived: session.archived });
      }
    }
  }
  state.days = [...days.values()].map(({ sessionIds, ...day }) => ({ ...day, sessionCount: sessionIds.size })).sort((a, b) => b.date.localeCompare(a.date));
  state.callCount = state.days.reduce((sum, day) => sum + day.callCount, 0);
  state.sessionDays = [...sessions.values()].sort((a, b) => b.callCount - a.callCount);
  state.records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  // ponytail: show the latest 200 calls per opened day; totals always include all calls.
  state.records = state.records.slice(0, 200);
}
