// Shared in-process observer: metadata only, bounded frames, unchanged response bytes.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const small = v => typeof v === 'string' && v.length > 0 && v.length <= 256 ? v : undefined;
const number = v => Number.isSafeInteger(v) && v >= 0 ? v : 0;
module.exports = function observeFetch(original, journal, context) {
  function save(row) { try { fs.mkdirSync(path.dirname(journal), { recursive: true }); fs.appendFileSync(journal, JSON.stringify(row) + '\n', { mode: 0o600 }); } catch {} }
  return async function(input, init) {
    let payload;
    try { if (typeof init?.body === 'string') payload = JSON.parse(init.body); } catch {}
    const sentModel = small(payload?.model);
    if (!sentModel) return original(input, init);
    const ctx = context(input, init, payload);
    if (!ctx) return original(input, init);
    const base = { id: randomUUID(), startedAt: new Date().toISOString(), ...ctx, sentModel };
    let response;
    try { response = await original(input, init); } catch(error) { save({ ...base, outcome: 'failed' }); throw error; }
    if (!response.body) { save({ ...base, outcome: 'failed' }); return response; }
    let model, responseId, conflicting = false, inputTokens = 0, outputTokens = 0;
    function observe(value) {
      const r = value?.response ?? value?.message ?? value;
      if (!response.ok) return;
      const envelope = r?.object === "response" || r?.object?.startsWith("chat.completion") || r?.type === "message";
      if (!envelope && !(responseId && value?.type === "message_delta")) return;
      const m = small(r?.model), id = small(r?.id);
      if (m) { if (model && model !== m) conflicting = true; model = m; }
      if (id) responseId = id;
      const u = r?.usage ?? value?.usage;
      if (u) {
        inputTokens = Math.max(inputTokens, number(u.prompt_tokens ?? u.input_tokens) + number(u.cache_read_input_tokens) + number(u.cache_creation_input_tokens));
        outputTokens = Math.max(outputTokens, number(u.completion_tokens ?? u.output_tokens));
      }
    }
    let saved = false;
    function finish(outcome) {
      if (saved) return; saved = true;
      save({ ...base, responseId, responseModel: conflicting ? undefined : model, inputTokens, outputTokens, outcome });
    }
    const sse = response.headers.get("content-type")?.includes("text/event-stream");
    const json = response.headers.get("content-type")?.includes("json");
    if (!sse && !json) { finish("unsupported"); return response; }
    const decoder = new TextDecoder();
    let buffer = "", dropping = false;
    function parse(raw) { try { observe(JSON.parse(raw)); } catch {} }
    // ponytail: bounded SSE/JSON frame, oversized frames stay unverified; no whole-response buffering.
    function consume(chunk) {
      const value = decoder.decode(chunk, { stream: true });
      if (json) { if (!dropping && buffer.length + value.length <= 262144) buffer += value; else { buffer = ""; dropping = true; } return; }
      for (const c of value.split(/(?<=\n)/)) {
        if (!dropping && buffer.length + c.length <= 262144) buffer += c;
        else { buffer = ""; dropping = true; }
        if (!c.endsWith("\n")) continue;
        if (!dropping && buffer.startsWith("data:")) parse(buffer.slice(5).trim());
        buffer = ""; dropping = false;
      }
    }
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) { if (!dropping && buffer) parse(json ? buffer : buffer.startsWith("data:") ? buffer.slice(5).trim() : ""); finish(response.ok ? "completed" : "failed"); controller.close(); }
          else { try { consume(next.value); } catch {} controller.enqueue(next.value); }
        } catch (error) { finish("interrupted"); controller.error(error); }
      },
      async cancel(reason) { finish("interrupted"); await reader.cancel(reason); },
    });
    const wrapped = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    Object.defineProperties(wrapped, { url: { value: response.url }, redirected: { value: response.redirected }, type: { value: response.type } });
    return wrapped;
  };
};
