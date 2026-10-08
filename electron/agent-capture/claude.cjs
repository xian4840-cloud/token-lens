// Bun preload runs inside Claude Code; other Bun programs are left alone.
const path = require("node:path");
if (/^claude(?:\.exe)?$/i.test(path.basename(process.execPath))) {
  try {
    const observeFetch = require("./_token-lens-fetch-models.cjs");
    const fs = require("node:fs");
    const journal = JSON.parse(fs.readFileSync(path.join(__dirname, "claude-journal.json"), "utf8"));
    const original = globalThis.fetch;
    globalThis.fetch = observeFetch(globalThis.fetch, journal, (_input, _init, payload) => {
      try {
        const url = new URL(typeof _input === "string" || _input instanceof URL ? _input : _input.url);
        if (!/\/v1\/messages\/?$/.test(url.pathname)) return undefined;
      } catch { return undefined; }
      let sessionId;
      const user = payload.metadata?.user_id;
      try { sessionId = JSON.parse(user).session_id; } catch {
        if (typeof user === "string") sessionId = /_session_([a-f0-9-]{36})$/i.exec(user)?.[1];
      }
      return { requestedModel: payload.model, sessionId: typeof sessionId === "string" && sessionId.length <= 256 ? sessionId : undefined };
    });
    Object.assign(globalThis.fetch, original); // Preserve Bun fetch.preconnect and other native helpers.
  } catch { /* Collection failure must not prevent Claude from starting. */ }
}
