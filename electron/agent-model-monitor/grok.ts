import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { secToIso } from "../lib/time";
import type { ModelMonitorRecord } from "../model-monitor";
import { exists, lines, text, tokens, type Group } from "./shared";

export async function grokArchives(dir: string): Promise<string[]> {
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
export async function readGrok(file: string, modifiedAt: string): Promise<Group> {
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
