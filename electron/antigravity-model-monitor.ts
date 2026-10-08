import fs from "node:fs";
import path from "node:path";
import { parseProtoFields, readVarint } from "./local-usage/antigravity";
import { msToIso } from "./lib/time";
import type { ModelMonitorRecord, ModelMonitorSession } from "./model-monitor";

type Fields = NonNullable<ReturnType<typeof parseProtoFields>>;
const nested = (fields: Fields, n: number): Fields => {
  const data = fields.find((f) => f.num === n)?.data;
  return data ? (parseProtoFields(data) ?? []) : [];
};
const number = (fields: Fields, n: number): number => fields.find((f) => f.num === n)?.varint ?? 0;
const text = (fields: Fields, n: number): string | undefined => {
  const data = fields.find((f) => f.num === n)?.data;
  if (!data || data.length > 256) return;
  const value = Buffer.from(data).toString("utf8");
  return value && !/[\u0000-\u001f\ufffd]/.test(value) ? value : undefined;
};
function stepIndices(fields: Fields): number[] {
  const result: number[] = [];
  for (const f of fields.filter((f) => f.num === 2)) {
    if (f.varint !== undefined) result.push(f.varint);
    else if (f.data)
      for (let pos = 0; pos < f.data.length;) {
        const v = readVarint(f.data, pos);
        if (!v) return [];
        result.push(v[0]);
        pos = v[1];
      }
  }
  return [...new Set(result)];
}

/** Local Antigravity 2.19.1 descriptors:
 * CortexStepGeneratorMetadata: 1=chat_model, 2=step_indices, 3=planner_config.
 * ChatModelMetadata: 3=model enum, 4=usage, 19=response_model, 22=response_model_full.
 * CascadePlannerConfig: 1=plan_model, 28=model_name. Keep configuration separate.
 * No heuristics over prompt strings; unknown/missing schema fields stay unverified.
 */
export function readAntigravityModelSession(file: string): {
  session: ModelMonitorSession;
  records: ModelMonitorRecord[];
} {
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const steps = new Map<number, { startedAt: string; responseId?: string; enumId: number }>();
    for (const row of db.prepare("SELECT idx, metadata FROM steps WHERE step_type=15").iterate()) {
      if (!(row.metadata instanceof Uint8Array)) continue;
      const f = parseProtoFields(row.metadata);
      if (!f) continue;
      const ts = nested(f, 1),
        usage = nested(f, 9);
      const startedAt = msToIso(number(ts, 1) * 1000 + Math.floor(number(ts, 2) / 1e6));
      if (startedAt)
        steps.set(Number(row.idx), {
          startedAt,
          responseId: text(usage, 11),
          enumId: number(f, 11),
        });
    }
    const records: ModelMonitorRecord[] = [];
    const enumNames = new Map<number, Set<string>>();
    const pending: { record: ModelMonitorRecord; enumId: number }[] = [];
    // ponytail: read each generation blob once (some include large prompts), cache only metadata.
    for (const row of db.prepare("SELECT idx, data FROM gen_metadata ORDER BY idx").iterate()) {
      if (!(row.data instanceof Uint8Array)) continue;
      const f = parseProtoFields(row.data);
      if (!f) continue;
      const chat = nested(f, 1),
        usage = nested(chat, 4),
        config = nested(f, 3);
      const responseModel = text(chat, 22) ?? text(chat, 19);
      const requested = text(config, 28),
        configEnum = number(config, 1),
        enumId = number(chat, 3);
      if (requested && configEnum) {
        const names = enumNames.get(configEnum) ?? new Set();
        names.add(requested);
        enumNames.set(configEnum, names);
      }
      // Exact step indices are stored by Antigravity; never join by timestamp or ordering.
      const responseId = text(usage, 11);
      const linked = stepIndices(f).flatMap((i) => (steps.has(i) ? [steps.get(i)!] : []));
      const matching = linked.filter(
        (s) =>
          (!responseId || !s.responseId || s.responseId === responseId) &&
          (!enumId || !s.enumId || s.enumId === enumId),
      );
      if (!matching.length || !responseModel || !usage.length) continue;
      // Multiple steps from one generation count once; conflicting response IDs are ambiguous.
      if (new Set(matching.map((s) => s.responseId).filter(Boolean)).size > 1) continue;
      const inputTokens = number(usage, 2) + number(usage, 5) + number(usage, 4);
      const outputTokens = number(usage, 3) || number(usage, 9) + number(usage, 10);
      const record: ModelMonitorRecord = {
        id: `generation:${row.idx}`,
        startedAt: matching[0].startedAt,
        requestedModel: requested,
        responseModel,
        responseId,
        evidence: "generation-response",
        status: "unknown",
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      };
      records.push(record);
      pending.push({ record, enumId });
    }
    for (const { record, enumId } of pending) {
      const names = enumNames.get(enumId);
      // Use only unambiguous configuration mappings in this database, never response names.
      if (!record.requestedModel && names?.size === 1) record.requestedModel = [...names][0];
      if (record.requestedModel)
        record.status = record.requestedModel === record.responseModel ? "match" : "mismatch";
    }
    return {
      session: {
        id: path.basename(file, ".db"),
        name: path.basename(file, ".db"),
        modifiedAt: fs.statSync(file).mtime.toISOString(),
        archived: false,
      },
      records,
    };
  } finally {
    db.close();
  }
}
