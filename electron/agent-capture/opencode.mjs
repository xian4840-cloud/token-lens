// Loaded in OpenCode itself. No daemon, response clone, credentials or chat bodies on disk.
import observeFetch from "./_token-lens-fetch-models.cjs";
const TOKEN_LENS_CONTEXT = Symbol("token-lens-context");
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export default async function TokenLensResponseMonitor() {
  const contexts = new Map(), assistants = new Map();
  const nested = new AsyncLocalStorage();
  const small = v => typeof v === "string" && v.length > 0 && v.length <= 256 ? v : undefined;
  function wrap(original) {
    const observe = observeFetch(original, TOKEN_LENS_JOURNAL, (_input, init) => init[TOKEN_LENS_CONTEXT]?.sessionId ? init[TOKEN_LENS_CONTEXT] : undefined);
    const wrapped = (input, init) => {
      if (nested.getStore()) return original(input, init);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const ctx = contexts.get(headers.get("x-token-lens-local-id"));
      headers.delete("x-token-lens-local-id");
      let model; try { model = small(JSON.parse(init?.body).model); } catch {}
      const actualInput = input instanceof Request ? new Request(input, { headers }) : input;
      return nested.run(true, () => observe(actualInput, { ...init, headers, [TOKEN_LENS_CONTEXT]: { sessionId: small(ctx?.sessionId ?? headers.get("x-opencode-session-id")), assistantId: small(ctx?.assistantId), requestedModel: ctx?.requestedModel ?? model } }));
    };
    return Object.assign(wrapped, original);
  }
  return {
    event: async ({ event }) => {
      if (event.type !== "message.updated") return;
      const m = event.properties?.info;
      if (m?.role !== "assistant") return;
      if (m.time?.completed || m.error) assistants.delete(m.id);
      else assistants.set(m.id, { id: m.id, sessionID: m.sessionID, parentID: m.parentID, modelID: m.modelID });
    },
    "chat.headers": async (input, output) => {
      const id = randomUUID();
      const candidates = [...assistants.values()].filter(a => a.sessionID === input.sessionID && a.parentID === input.message.id && a.modelID === input.model.id);
      contexts.set(id, { sessionId: input.sessionID, assistantId: candidates.length === 1 ? candidates[0].id : undefined, requestedModel: small(input.model.id), created: Date.now() });
      // This local correlation header is removed before the underlying fetch.
      output.headers["x-token-lens-local-id"] = id;
      for (const [key, ctx] of contexts) if (Date.now() - ctx.created > 300_000) contexts.delete(key);
    },
    config: async config => {
      // Built-in providers may be absent from config.provider but use the same global fetch.
      const original = globalThis.fetch;
      for (const provider of Object.values(config.provider ?? {})) {
        if (provider.options?.fetch && provider.options.fetch !== original) provider.options.fetch = wrap(provider.options.fetch);
      }
      globalThis.fetch = wrap(original);
    },
  };
}
