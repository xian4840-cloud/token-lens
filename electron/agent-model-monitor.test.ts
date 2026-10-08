import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAgentModelMonitorState } from "./agent-model-monitor";
import { toDateKey } from "./local-usage/date";
import { enableOpenCodeCapture, openCodeCapturePaths, claudeCapturePaths } from "./agent-response-capture";
vi.mock("electron", () => ({ app: { getPath: () => "" } }));
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-agent-monitor-")); dirs.push(dir); return dir; }
function write(file: string, rows: unknown[]) { fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join("\n") + "\n"); }
const time = "2026-10-04T00:00:01Z", date = toDateKey(time)!;
const assistant = (id: string, model = "claude-real", output = 5) => ({ type: "assistant", timestamp: time, message: { id, model, content: "PRIVATE_BODY", usage: { input_tokens: 10, output_tokens: output, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 } } });

describe("additional local agent model records", () => {
  it("overlays native Claude captures by response ID, keeps real retries and counts usage once", async () => {
    const dir = root(), data = root(), file = path.join(dir, "session.jsonl");
    write(file, [assistant("r1"), assistant("r2")]);
    const journal = claudeCapturePaths(data).journal;
    fs.mkdirSync(path.dirname(journal), { recursive: true });
    write(journal, [
      { id: "c1", startedAt: time, requestedModel: "claude-real", responseModel: "claude-real", responseId: "r1", inputTokens: 999 },
      { id: "c2", startedAt: time, requestedModel: "other", responseModel: "claude-real", responseId: "r1", outputTokens: 999 },
    ]);
    const state = await getAgentModelMonitorState(date, "claude-code", data, dir);
    expect(state.days[0]).toMatchObject({ callCount: 3, verifiedCount: 2, mismatchCount: 1, unknownCount: 1, totalTokens: 130 });
    expect(state.agentCapture).toMatchObject({ requestCount: 2, responseCount: 2 });
    expect(state.records.find(r => r.id.endsWith("r2"))?.requestedModel).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain("PRIVATE_BODY");
    fs.appendFileSync(journal, JSON.stringify({ id: "c3", startedAt: time, requestedModel: "another", responseModel: "another", responseId: "r2" }) + "\n");
    expect((await getAgentModelMonitorState(date, "claude-code", data, dir)).days[0]).toMatchObject({ callCount: 3, verifiedCount: 3, unknownCount: 0, totalTokens: 130 });
  });

  it("recovers compressed Grok response metadata from coherent native snapshots without replay inflation", async () => {
    const dir = root(), file = path.join(dir, "updates.jsonl"), archiveDir = path.join(dir, "compaction_requests");
    const prompt = (index: number, value: string) => ({ params: { update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: value }, _meta: { promptIndex: index, modelId: "selected" } } } });
    const end = (id: string) => ({ timestamp: Date.parse(time) / 1000, params: { update: { sessionUpdate: "turn_completed", prompt_id: id, usage: { modelCalls: 2 } } } });
    write(file, [prompt(1, "PRIVATE_UNIQUE"), end("p1"), prompt(2, "repeated"), end("p2"), prompt(3, "repeated"), end("p3")]);
    const user = { type: "user", content: [{ type: "text", text: "<user_query>\nPRIVATE_UNIQUE\n</user_query>" }] };
    const first = { type: "assistant", model_id: "selected", content: "PRIVATE_RESPONSE_1" };
    const second = { type: "assistant", model_id: "different", content: "PRIVATE_RESPONSE_2" };
    fs.mkdirSync(archiveDir);
    fs.writeFileSync(path.join(archiveDir, "one.json"), JSON.stringify({ chat_history: [user, first] }));
    fs.writeFileSync(path.join(archiveDir, "two.json"), JSON.stringify({ chat_history: [user, first, second, { type: "user", content: [{ type: "text", text: "<user_query>\nrepeated\n</user_query>" }] }, first] }));
    const state = await getAgentModelMonitorState(date, "grok-build", undefined, dir);
    expect(state.days[0]).toMatchObject({ callCount: 6, verifiedCount: 2, mismatchCount: 1, unknownCount: 4 });
    expect(JSON.stringify(state)).not.toMatch(/PRIVATE_UNIQUE|PRIVATE_RESPONSE/);
    // Conflicting branches sharing a prompt must not be combined into manufactured evidence.
    fs.writeFileSync(path.join(archiveDir, "conflict.json"), JSON.stringify({ chat_history: [user, second] }));
    expect((await getAgentModelMonitorState(date, "grok-build", undefined, dir)).days[0].verifiedCount).toBe(0);
  });
  it("reads Claude response models, deduplicates streaming updates and never invents selected models", async () => {
    const dir = root(), file = path.join(dir, "session.jsonl");
    write(file, [assistant("r1"), assistant("r1", "claude-real", 9), assistant("synthetic", "<synthetic>"), { type: "ai-title", aiTitle: "Local title" }]);
    const state = await getAgentModelMonitorState(date, "claude-code", undefined, dir);
    expect(state.callCount).toBe(1);
    expect(state.records[0]).toMatchObject({ responseModel: "claude-real", status: "unknown", totalTokens: 69, sessionName: "Local title" });
    expect(state.records[0].requestedModel).toBeUndefined();
    expect(state.days[0]).toMatchObject({ responseCount: 1, verifiedCount: 0 });
    expect(JSON.stringify(state)).not.toContain("PRIVATE_BODY");
    fs.appendFileSync(file, JSON.stringify(assistant("r2")) + '\n{"partial":');
    expect((await getAgentModelMonitorState(date, "claude-code", undefined, dir)).callCount).toBe(2);
    fs.unlinkSync(file);
    expect((await getAgentModelMonitorState(date, "claude-code", undefined, dir)).callCount).toBe(0);
  });

  it("reads Grok completed rounds and requested model intervals without promoting mixed usage provenance", async () => {
    const dir = root(), file = path.join(dir, "updates.jsonl"), events = path.join(dir, "events.jsonl");
    const seconds = Date.parse(time) / 1000;
    const turn = (id: string, timestamp = seconds, models: Record<string, object> = { "grok-real": {} }) => ({ timestamp, params: { update: { sessionUpdate: "turn_completed", prompt_id: id, usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 15, modelCalls: 3, modelUsage: models } } } });
    write(file, [turn("p1"), turn("p1"), turn("p2", seconds + 5, { "grok-real": {}, helper: {} })]);
    write(events, [
      { type: "turn_started", ts: "2026-10-04T00:00:00.800Z", model_id: "first" },
      { type: "turn_ended", ts: "2026-10-04T00:00:01.900Z" },
      { type: "turn_started", ts: "2026-10-04T00:00:05.800Z", model_id: "second" },
      { type: "turn_ended", ts: "2026-10-04T00:00:06.900Z" },
    ]);
    write(path.join(dir, "chat_history.jsonl"), [{ type: "assistant", model_id: "unjoinable-response", content: "PRIVATE_BODY" }]);
    const state = await getAgentModelMonitorState(date, "grok-build", undefined, dir);
    expect(state.sessions).toHaveLength(1);
    expect(state.callCount).toBe(6);
    expect(state.days[0]).toMatchObject({ totalTokens: 240, responseCount: 0, verifiedCount: 0, unknownCount: 6 });
    expect(state.records.map(r => r.requestedModel)).toEqual(["second", "first"]);
    expect(state.records.every(r => r.responseModel === undefined && r.status === "unknown")).toBe(true);
    expect(state.records[1]).toMatchObject({ reportedModel: "grok-real", modelCalls: 3, evidence: "usage" });
    expect(JSON.stringify(state)).not.toMatch(/PRIVATE_BODY|unjoinable-response/);
    fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ generated_title: "Grok title", current_model_id: "DO_NOT_BACKFILL" }));
    expect((await getAgentModelMonitorState(date, "grok-build", undefined, dir)).records[0].sessionName).toBe("Grok title");
    write(events, [{ type: "turn_started", ts: "2026-10-04T00:00:01.010Z", model_id: "a" }, { type: "turn_started", ts: "2026-10-04T00:00:01.900Z", model_id: "b" }]);
    const changed = await getAgentModelMonitorState(date, "grok-build", undefined, dir);
    expect(changed.records.find(r => r.id.endsWith("p1"))?.requestedModel).toBeUndefined();
    expect(JSON.stringify(changed)).not.toContain("DO_NOT_BACKFILL");
  });

  it("reads OpenCode metadata in read-only mode and keeps matching configured models unverified", async () => {
    const dir = root(), file = path.join(dir, "opencode.db"), db = new DatabaseSync(file);
    db.exec("CREATE TABLE session(id TEXT, title TEXT, time_updated INTEGER, time_archived INTEGER); CREATE TABLE message(id TEXT, session_id TEXT, time_created INTEGER, data TEXT);");
    const ms = Date.parse(time);
    db.prepare("INSERT INTO session VALUES(?,?,?,?)").run("s", "OpenCode title", ms, null);
    const add = db.prepare("INSERT INTO message VALUES(?,?,?,?)");
    add.run("u", "s", ms, JSON.stringify({ role: "user", model: { modelID: "configured" }, content: "PRIVATE_BODY" }));
    add.run("a", "s", ms, JSON.stringify({ role: "assistant", parentID: "u", modelID: "configured", time: { created: ms }, tokens: { input: 10, output: 5, reasoning: 3, cache: { read: 20, write: 30 } }, content: "PRIVATE_RESPONSE" }));
    add.run("cross", "other-session", ms, JSON.stringify({ role: "user", model: { modelID: "WRONG_PARENT" } }));
    add.run("b", "s", ms, JSON.stringify({ role: "assistant", parentID: "cross", modelID: "other", time: { created: ms }, tokens: { input: 1 } }));
    db.close();
    const before = fs.readFileSync(file);
    const state = await getAgentModelMonitorState(date, "opencode", undefined, file);
    expect(state.callCount).toBe(2);
    expect(state.records.find(r => r.id.endsWith(":a"))).toMatchObject({ requestedModel: "configured", reportedModel: "configured", status: "unknown", totalTokens: 68, evidence: "selection" });
    expect(state.records.find(r => r.id.endsWith(":b"))?.requestedModel).toBeUndefined();
    expect(state.days[0].responseCount).toBe(0);
    expect(JSON.stringify(state)).not.toMatch(/PRIVATE_BODY|PRIVATE_RESPONSE|WRONG_PARENT/);
    expect(fs.readFileSync(file)).toEqual(before);
    const dataRoot = path.join(dir, "app-data"), configRoot = path.join(dir, "config");
    enableOpenCodeCapture(path.join(__dirname, "agent-capture", "opencode.mjs"), dataRoot, configRoot);
    const paths = openCodeCapturePaths(dataRoot, configRoot);
    expect(fs.readFileSync(paths.plugin, "utf8")).toContain("const TOKEN_LENS_JOURNAL");
    fs.mkdirSync(path.dirname(paths.journal), { recursive: true });
    write(paths.journal, [
      { id: "capture-1", sessionId: "s", assistantId: "a", startedAt: time, requestedModel: "configured", sentModel: "api-alias", responseModel: "different", responseId: "api-response-1", inputTokens: 999, outputTokens: 999, body: "PRIVATE_BODY" },
      { id: "capture-2", sessionId: "s", assistantId: "a", startedAt: time, requestedModel: "configured", responseModel: "configured", responseId: "api-response-1", inputTokens: 999, outputTokens: 999 }, // provider replay IDs do not merge two actual requests
    ]);
    const captured = await getAgentModelMonitorState(date, "opencode", dataRoot, file);
    expect(captured.callCount).toBe(3); // two real requests plus one historical unknown
    expect(captured.days[0]).toMatchObject({ totalTokens: 69, verifiedCount: 2, mismatchCount: 1, unknownCount: 1 });
    expect(captured.sessionDays).toEqual([
      { sessionId: "s", name: "OpenCode title", model: "configured", modelBasis: "request", callCount: 2, matchedCount: 1, mismatchedCount: 1, unknownCount: 0, totalTokens: 68 },
      { sessionId: "s", name: "OpenCode title", model: undefined, modelBasis: "unknown", callCount: 1, matchedCount: 0, mismatchedCount: 0, unknownCount: 1, totalTokens: 1 },
    ]);
    expect(captured.records.find(r => r.responseId === "api-response-1")).toMatchObject({ status: "mismatch", sentModel: "api-alias" });
    expect(JSON.stringify(captured)).not.toContain("PRIVATE_BODY");
    fs.writeFileSync(paths.plugin, "// Somebody else's plugin");
    expect(() => enableOpenCodeCapture(path.join(__dirname, "agent-capture", "opencode.mjs"), dataRoot, configRoot)).toThrow("无法覆盖");
  });

  it("verifies Grok responses using explicit turn markers, preserves partial and mixed results and invalidates changed history", async () => {
    const dir = root(), file = path.join(dir, "updates.jsonl"), history = path.join(dir, "chat_history.jsonl");
    const prompt = (index: number, model = "selected") => ({ params: { update: { sessionUpdate: "user_message_chunk", content: "PRIVATE_PROMPT", _meta: { promptIndex: index, modelId: model } } } });
    const end = (id: string, calls = 3) => ({ timestamp: Date.parse(time) / 1000, params: { update: { sessionUpdate: "turn_completed", prompt_id: id, usage: { inputTokens: 10, outputTokens: 5, modelCalls: calls, modelUsage: { selected: {} } } } } });
    write(file, [prompt(7), end("p7"), prompt(9), end("p9", 1)]);
    write(history, [
      { type: "assistant", model_id: "unmarked-do-not-join" },
      { type: "user", prompt_index: 7, content: "PRIVATE_PROMPT" },
      { type: "assistant", model_id: "selected", content: "PRIVATE_REPLY" },
      { type: "user", synthetic_reason: "system_reminder" }, // an unmarked mid-turn message is not a boundary
      { type: "assistant", model_id: "different" },
      { type: "assistant" }, // missing response model never falls back to usage
      { type: "user", prompt_index: 9 }, { type: "assistant", model_id: "selected" },
    ]);
    const state = await getAgentModelMonitorState(date, "grok-build", undefined, dir);
    expect(state.callCount).toBe(4);
    expect(state.days[0]).toMatchObject({ totalTokens: 30, responseCount: 3, verifiedCount: 3, mismatchCount: 1, unknownCount: 1 });
    expect(state.sessionDays?.[0]).toMatchObject({ callCount: 4, matchedCount: 2, mismatchedCount: 1, unknownCount: 1 });
    expect(state.records.find(r => r.id.endsWith("p7"))).toMatchObject({ matchedCalls: 1, mismatchedCalls: 1, unverifiedCalls: 1, status: "mismatch", evidence: "assistant-message" });
    expect(JSON.stringify(state)).not.toMatch(/PRIVATE_PROMPT|PRIVATE_REPLY|unmarked-do-not-join/);
    write(history, [{ type: "user", prompt_index: 9 }, { type: "assistant", model_id: "selected" }]);
    expect((await getAgentModelMonitorState(date, "grok-build", undefined, dir)).days[0]).toMatchObject({ verifiedCount: 1, unknownCount: 3 });
    // A rewind that reuses the same marker has ambiguous provenance, so no name is accepted.
    fs.appendFileSync(history, JSON.stringify({ type: "user", prompt_index: 9 }) + "\n" + JSON.stringify({ type: "assistant", model_id: "selected" }) + "\n");
    expect((await getAgentModelMonitorState(date, "grok-build", undefined, dir)).days[0].verifiedCount).toBe(0);
    // A rewind can remove the old marker entirely, but the update rail still proves the index was reused.
    write(history, [{ type: "user", prompt_index: 9 }, { type: "assistant", model_id: "selected" }]);
    write(file, [prompt(9, "old-model"), end("old-id", 1), prompt(9), end("new-id", 1)]);
    const reused = await getAgentModelMonitorState(date, "grok-build", undefined, dir);
    expect(reused.days[0]).toMatchObject({ verifiedCount: 0, unknownCount: 2 });
  });

  it("validates IPC source/date and reports missing or incompatible local stores", async () => {
    const dir = root();
    for (const source of ["../auth.json", {}, null]) await expect(getAgentModelMonitorState(undefined, source, undefined, dir)).rejects.toThrow("来源无效");
    for (const source of ["claude-code", "opencode", "grok-build", "antigravity"]) await expect(getAgentModelMonitorState("2026-02-30", source, undefined, dir)).rejects.toThrow("日期无效");
    expect((await getAgentModelMonitorState(undefined, "grok-build", undefined, dir)).unavailable).toContain("未找到");
    expect((await getAgentModelMonitorState(undefined, "opencode", undefined, path.join(dir, "absent.db"))).unavailable).toContain("无法读取");
  });

  it("joins Antigravity response fields by explicit step indices, counts generations once and keeps prompts out", async () => {
    const dir = root(), file = path.join(dir, "antigravity.db"), db = new DatabaseSync(file);
    const v = (value: number): Buffer => { const bytes: number[] = []; do { let b = value % 128; value = Math.floor(value / 128); if (value) b |= 128; bytes.push(b); } while (value); return Buffer.from(bytes); };
    const n = (field: number, value: number) => Buffer.concat([v(field * 8), v(value)]);
    const b = (field: number, value: Buffer | string) => { const buf = Buffer.isBuffer(value) ? value : Buffer.from(value); return Buffer.concat([v(field * 8 + 2), v(buf.length), buf]); };
    const usage = Buffer.concat([n(1, 100), n(2, 10), n(3, 8), n(5, 20), n(9, 3), n(10, 5), b(11, "response-id")]);
    const ts = b(1, n(1, Date.parse(time) / 1000));
    const step = Buffer.concat([ts, n(11, 100), b(9, usage)]);
    const generation = (indices: Buffer, response?: string, config = false) => Buffer.concat([
      b(2, indices), b(1, Buffer.concat([b(1, "PRIVATE_PROMPT"), n(3, 100), b(4, usage), ...(response ? [b(19, response)] : [])])),
      ...(config ? [b(3, Buffer.concat([n(1, 100), b(28, "selected-high")]))] : []),
    ]);
    db.exec("CREATE TABLE steps(idx INTEGER, step_type INTEGER, metadata BLOB); CREATE TABLE gen_metadata(idx INTEGER, data BLOB);");
    const addStep = db.prepare("INSERT INTO steps VALUES(?,15,?)"), addGen = db.prepare("INSERT INTO gen_metadata VALUES(?,?)");
    addStep.run(1, step); addStep.run(2, step);
    addGen.run(1, generation(Buffer.concat([v(1), v(2)]), "returned-base", true));
    // Replayed response and multiple steps must not inflate one generation's usage.
    addGen.run(2, generation(v(1), "returned-base"));
    addGen.run(3, generation(v(1))); // configured model alone never becomes response evidence
    addGen.run(4, generation(v(999), "unjoinable"));
    db.close();
    const state = await getAgentModelMonitorState(date, "antigravity", undefined, dir);
    expect(state.unavailable).toBeUndefined();
    expect(state.callCount).toBe(1);
    expect(state.records[0]).toMatchObject({ requestedModel: "selected-high", responseModel: "returned-base", evidence: "generation-response", status: "mismatch", totalTokens: 38 });
    expect(JSON.stringify(state)).not.toMatch(/PRIVATE_PROMPT|unjoinable/);
    // Configuration mappings update with the database; response names never fill missing selection.
    const reopened = new DatabaseSync(file);
    reopened.prepare("INSERT INTO gen_metadata VALUES(?,?)").run(5, Buffer.concat([b(3, Buffer.concat([n(1, 100), b(28, "other-name")]))]));
    reopened.prepare("DELETE FROM gen_metadata WHERE idx=1").run(); reopened.close();
    const updated = await getAgentModelMonitorState(date, "antigravity", undefined, dir);
    expect(updated.records[0].requestedModel).toBe("other-name");
    const missingConfig = new DatabaseSync(file);
    missingConfig.prepare("DELETE FROM gen_metadata WHERE idx=5").run(); missingConfig.close();
    const unverified = await getAgentModelMonitorState(date, "antigravity", undefined, dir);
    expect(unverified.records[0]).toMatchObject({ responseModel: "returned-base", status: "unknown" });
    expect(unverified.records[0].requestedModel).toBeUndefined();
  });
});
