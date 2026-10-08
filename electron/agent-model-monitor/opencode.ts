import { msToIso } from "../lib/time";
import { stamp, text, tokens, type Group } from "./shared";

/** OpenCode 监控结果按数据库文件（含 -wal）的 mtime/size 缓存：库没变就不再逐条 json_extract */
let openCodeCache: { file: string; stamp: string; groups: Group[] } | undefined;
export async function readOpenCodeCached(file: string): Promise<Group[]> {
  const current = (await Promise.all([file, file + "-wal"].map(stamp))).join("|");
  if (openCodeCache?.file !== file || openCodeCache.stamp !== current) {
    openCodeCache = { file, stamp: current, groups: readOpenCode(file) };
  }
  // 调用方会改写 group.records / 追加 group，必须给一份浅拷贝
  return openCodeCache.groups.map((g) => ({ session: { ...g.session }, records: [...g.records] }));
}
function readOpenCode(file: string): Group[] {
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const groups = new Map<string, Group>();
    // Extract metadata in SQLite; prompts, text parts and tool output never enter the monitor.
    const query = db.prepare(`SELECT a.id, a.session_id, s.title, s.time_updated, s.time_archived,
      json_extract(a.data,'$.time.completed') AS completed, json_extract(a.data,'$.time.created') AS created,
      json_extract(a.data,'$.modelID') AS model,
      json_extract(u.data,'$.model.modelID') AS requested,
      json_extract(a.data,'$.tokens.input') AS input, json_extract(a.data,'$.tokens.output') AS output,
      json_extract(a.data,'$.tokens.reasoning') AS reasoning,
      json_extract(a.data,'$.tokens.cache.read') AS cache_read, json_extract(a.data,'$.tokens.cache.write') AS cache_write
      FROM message a JOIN session s ON s.id=a.session_id
      LEFT JOIN message u ON u.id=json_extract(a.data,'$.parentID') AND u.session_id=a.session_id AND json_extract(u.data,'$.role')='user'
      WHERE json_valid(a.data) AND json_extract(a.data,'$.role')='assistant' ORDER BY a.time_created`);
    for (const raw of query.iterate()) {
      const row = raw as any,
        startedAt = msToIso(row.completed ?? row.created);
      if (!startedAt) continue;
      const inputTokens = tokens(row.input) + tokens(row.cache_read) + tokens(row.cache_write);
      const outputTokens = tokens(row.output) + tokens(row.reasoning);
      if (!inputTokens && !outputTokens) continue;
      let group = groups.get(row.session_id);
      if (!group) {
        group = {
          session: {
            id: row.session_id,
            name: text(row.title) ?? row.session_id,
            modifiedAt: msToIso(row.time_updated) ?? startedAt,
            archived: !!row.time_archived,
          },
          records: [],
        };
        groups.set(row.session_id, group);
      }
      group.records.push({
        id: row.id,
        startedAt,
        requestedModel: text(row.requested),
        reportedModel: text(row.model),
        evidence: "selection",
        status: "unknown",
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      });
    }
    return [...groups.values()];
  } finally {
    db.close();
  }
}
