import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getModelMonitorState, observationsFromEvents } from "./model-monitor";
import { captureDirectory, getCodexCaptureState, readCapturedModels } from "./codex-capture";
import { toDateKey } from "./local-usage/date";
vi.mock("electron", () => ({ app: { getPath: () => "" } }));
const tempDirs: string[] = [];
afterEach(() => { for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const usage = { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 5 };
function events(model = "chosen-model", responseId = "resp_1") {
  return [
    { type: "turn_context", timestamp: "2026-10-04T00:00:00Z", payload: { model } },
    { type: "token_usage_record", timestamp: "2026-10-04T00:00:01Z", payload: { response_id: responseId, usage } },
  ];
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-local-monitor-")); tempDirs.push(root);
  for (const dir of ["sessions", "archived_sessions"]) fs.mkdirSync(path.join(root, dir));
  return root;
}
function write(root: string, id: string, rows: unknown[], archived = false) {
  const file = path.join(root, archived ? "archived_sessions" : "sessions", `rollout-2026-10-04T00-00-00-${id}.jsonl`);
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join("\n") + "\n"); return file;
}
const id = "01a10535-4026-7f31-a30b-4b9fdb5502d0", otherId = "01a10535-4026-7f31-a30b-4b9fdb5502d1";
const date = toDateKey("2026-10-04T00:00:01Z")!;

describe("local model evidence", () => {
  it("does not copy a selected model into missing response evidence", () => {
    const row = observationsFromEvents(events(), new Map())[0];
    expect(row).toMatchObject({ requestedModel: "chosen-model", status: "unknown", responseId: "resp_1", totalTokens: 130 });
    expect(row.responseModel).toBeUndefined();
  });
  it("compares independently recorded response models by response ID only", () => {
    expect(observationsFromEvents(events(), new Map([["resp_1", "chosen-model"]]))[0].status).toBe("match");
    expect(observationsFromEvents(events(), new Map([["resp_1", "different-model"]]))[0].status).toBe("mismatch");
    expect(observationsFromEvents(events(), new Map([["resp_other", "chosen-model"]]))[0].status).toBe("unknown");
  });
  it("keeps model changes per call and deduplicates replayed usage", () => {
    const rows = observationsFromEvents([...events("first", "r1"), ...events("second", "r2"), ...events("second", "r2")], new Map([["r1", "first"], ["r2", "other"]]));
    expect(rows.map(r => [r.requestedModel, r.status])).toEqual([["first", "match"], ["second", "mismatch"]]);
  });
});
describe("local sessions", () => {
  it("discovers active and archived sessions with local names", async () => {
    const root = fixture();
    write(root, id, [{ type: "session_meta", payload: { model_provider: "openai" } }, ...events()]);
    write(root, otherId, events("historic", "r_history"), true);
    fs.writeFileSync(path.join(root, "session_index.jsonl"), JSON.stringify({ id, thread_name: "本地会话标题" }) + "\n");
    const state = await getModelMonitorState(date, root);
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions.find(s => s.id === id)?.name).toBe("本地会话标题");
    expect(state.callCount).toBe(2);
    expect(state.days[0]).toMatchObject({ date, sessionCount: 2, callCount: 2, totalTokens: 260, unknownCount: 2 });
    expect(state.records.find(r => r.sessionId === otherId)).toMatchObject({ requestedModel: "historic", archived: true });
  });
  it("refreshes appended calls and ignores private content and incomplete lines", async () => {
    const root = fixture(); const file = write(root, id, events());
    await getModelMonitorState(date, root);
    fs.appendFileSync(file, JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", model: "not-server-evidence", content: "private content" } }) + "\n" + events("new-model", "r2").map(r => JSON.stringify(r)).join("\n") + '\n{"unfinished":');
    const state = await getModelMonitorState(date, root);
    expect(state.callCount).toBe(2); expect(state.records.some(r => r.requestedModel === "new-model")).toBe(true);
    expect(state.records.every(r => r.status === "unknown")).toBe(true);
    expect(JSON.stringify(state)).not.toMatch(/private content|not-server-evidence/);
  });
  it("reads an explicit response envelope without retaining response text", async () => {
    const root = fixture();
    write(root, id, [...events(), { type: "event_msg", payload: { type: "response.completed", response: { id: "resp_1", model: "different-model", output: "private response" } } }]);
    const state = await getModelMonitorState(date, root);
    expect(state.records[0]).toMatchObject({ responseModel: "different-model", status: "mismatch" });
    expect(JSON.stringify(state)).not.toContain("private response");
  });
  it("joins captured responses by ID after caching history without adding calls or tokens", async () => {
    const root = fixture(), dataRoot = fixture();
    write(root, id, events());
    expect((await getModelMonitorState(date, root, dataRoot)).records[0].status).toBe("unknown");
    const dir = captureDirectory(dataRoot); fs.mkdirSync(dir);
    const journal = path.join(dir, "responses-123.jsonl");
    const capture = (responseId: string, model: string, eventType = "response.completed") => JSON.stringify({ source: "codex-native-trace-v1", responseId, model, eventType, output: "private trace", observedAt: "2026-10-04T00:00:01Z" });
    fs.writeFileSync(journal, capture("other", "unrelated") + "\n" + capture("resp_1", "chosen-model", "response.created") + "\n");
    const matched = await getModelMonitorState(date, root, dataRoot);
    expect(matched.records[0]).toMatchObject({ status: "match", responseModel: "chosen-model", totalTokens: 130 });
    expect(matched.days[0]).toMatchObject({ callCount: 1, totalTokens: 130, verifiedCount: 1 });
    fs.appendFileSync(journal, capture("resp_1", "other-model") + "\n");
    const changed = await getModelMonitorState(date, root, dataRoot);
    expect(changed.records[0]).toMatchObject({ status: "mismatch", responseModel: "chosen-model → other-model" });
    expect(changed.days[0]).toMatchObject({ callCount: 1, totalTokens: 130, mismatchCount: 1 });
    expect(JSON.stringify(changed)).not.toContain("private trace");
    expect((await getModelMonitorState(date, root)).records[0].status).toBe("unknown");
  });
  it("ignores incomplete and untrusted journal rows and recognizes an exited collector", async () => {
    const root = fixture(), dir = captureDirectory(root); fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "responses-123.jsonl"), [
      { source: "configured-model", responseId: "resp_1", model: "fake", eventType: "response.completed" },
      { source: "codex-native-trace-v1", responseId: "resp_1", model: "fake", eventType: "response.create" },
      { source: "codex-native-trace-v1", responseId: "resp_1", model: "server-model", eventType: "response.completed" },
    ].map(row => JSON.stringify(row)).join("\n") + '\n{"incomplete":');
    expect([...(await readCapturedModels(root)).get("resp_1")!]).toEqual(["server-model"]);
    fs.writeFileSync(path.join(dir, "collector.json"), JSON.stringify({ collectorPid: 99999999, responseCount: 3, lastResponseAt: "invalid date" }));
    expect(await getCodexCaptureState(root)).toMatchObject({ active: false, responseCount: 3 });
    expect((await getCodexCaptureState(root)).lastResponseAt).toBeUndefined();
  });
  it("handles empty folders and accepts only valid calendar dates", async () => {
    const root = fixture(); expect((await getModelMonitorState(undefined, root)).unavailable).toContain("未找到");
    write(root, id, events());
    for (const bad of ["../../auth.json", { path: "auth.json" }, "2026-02-30", "2026-13-01"]) await expect(getModelMonitorState(bad, root)).rejects.toThrow("日期无效");
    expect((await getModelMonitorState(undefined, root)).records).toEqual([]);
    expect((await getModelMonitorState("2026-01-01", root)).records).toEqual([]);
  });
  it("splits a cross-midnight session by call date and keeps totals beyond the detail limit", async () => {
    const root = fixture();
    const first = new Date(2026, 9, 4, 23, 59, 0), second = new Date(2026, 9, 5, 0, 1, 0);
    const rows = Array.from({ length: 205 }, (_, i) => events("first", `r${i}`).map(e => ({ ...e, timestamp: first.toISOString() }))).flat();
    rows.push(...events("second", "next_day").map(e => ({ ...e, timestamp: second.toISOString() })));
    write(root, id, rows);
    const state = await getModelMonitorState("2026-10-04", root);
    expect(state.days.map(d => [d.date, d.callCount, d.totalTokens])).toEqual([["2026-10-05", 1, 130], ["2026-10-04", 205, 26650]]);
    expect(state.records).toHaveLength(200);
    expect(state.sessionDays?.[0]).toMatchObject({ model: "first", callCount: 205, unknownCount: 205, totalTokens: 26650 });
    expect(state.records.every(r => toDateKey(r.startedAt) === "2026-10-04")).toBe(true);
    expect((await getModelMonitorState("2026-10-05", root)).records[0].requestedModel).toBe("second");
  });
  it("separates model switches within a session and preserves the same model across different sessions", async () => {
    const root = fixture();
    write(root, id, [...events("model-a", "request-a"), ...events("model-b", "request-b")]);
    write(root, otherId, events("model-a", "request-c"));
    const state = await getModelMonitorState(date, root);
    expect(state.days[0]).toMatchObject({ callCount: 3, sessionCount: 2, totalTokens: 390 });
    expect(state.sessionDays).toHaveLength(3);
    expect(state.sessionDays?.filter(s => s.model === "model-a")).toHaveLength(2);
    expect(state.sessionDays?.find(s => s.sessionId === id && s.model === "model-b")).toMatchObject({ callCount: 1, unknownCount: 1, totalTokens: 130 });
  });
  it("does not count copied fork response IDs twice or keep deleted sessions cached", async () => {
    const root = fixture();
    const first = write(root, id, events());
    write(root, otherId, [...events(), ...events("fork-model", "fork_response")]);
    const state = await getModelMonitorState(date, root);
    expect(state.callCount).toBe(2); expect(state.records).toHaveLength(2);
    fs.unlinkSync(first);
    const next = await getModelMonitorState(date, root);
    expect(next.sessions).toHaveLength(1); expect(next.callCount).toBe(2);
  });
});
