import path from "node:path";
import { msToIso } from "../lib/time";
import type { ModelMonitorRecord } from "../model-monitor";
import { lines, text, tokens, type Group } from "./shared";

export async function readClaude(file: string, modifiedAt: string): Promise<Group> {
  const session = { id: file, name: path.basename(file, ".jsonl"), modifiedAt, archived: false };
  const records = new Map<string, ModelMonitorRecord>();
  await lines(file, (row) => {
    const title =
      row.type === "ai-title"
        ? text(row.aiTitle)
        : row.type === "custom-title"
          ? text(row.customTitle)
          : undefined;
    if (title) session.name = title;
    const m = row.message,
      id = text(m?.id),
      model = text(m?.model);
    if (row.type !== "assistant" || !id || !model || model === "<synthetic>" || !m?.usage) return;
    const startedAt =
      typeof row.timestamp === "string" ? msToIso(Date.parse(row.timestamp)) : undefined;
    if (!startedAt) return;
    const inputTokens =
      tokens(m.usage.input_tokens) +
      tokens(m.usage.cache_read_input_tokens) +
      tokens(m.usage.cache_creation_input_tokens);
    const outputTokens = tokens(m.usage.output_tokens);
    records.set(id, {
      id,
      responseId: id,
      startedAt,
      responseModel: model,
      evidence: "assistant-message",
      status: "unknown",
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    });
  });
  return { session, records: [...records.values()].filter((r) => r.totalTokens > 0) };
}
