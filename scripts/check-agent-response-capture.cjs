// Offline: node scripts/check-agent-response-capture.cjs [--runtime]
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const http = require("node:http");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-response-check-"));
const journal = path.join(temp, "records.jsonl");
const asset = fs.readFileSync(
  path.join(__dirname, "../electron/agent-capture/opencode.mjs"),
  "utf8",
);
const core = path.join(__dirname, "../electron/agent-capture/_token-lens-fetch-models.cjs");
const pluginSource = `const TOKEN_LENS_JOURNAL = ${JSON.stringify(journal)};\n` + asset;
const rows = () =>
  fs.existsSync(journal)
    ? fs.readFileSync(journal, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    : [];

async function check() {
  fs.copyFileSync(core, path.join(temp, "_token-lens-fetch-models.cjs"));
  const file = path.join(temp, "plugin.mjs");
  fs.writeFileSync(file, pluginSource);
  const hooks = await (await import(pathToFileURL(file).href)).default();
  await hooks.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          id: "assistant-1",
          sessionID: "session-1",
          parentID: "user-1",
          modelID: "selected",
          time: {},
        },
      },
    },
  });
  const output = { headers: {} };
  await hooks["chat.headers"](
    { sessionID: "session-1", model: { id: "selected" }, message: { id: "user-1" } },
    output,
  );
  const wire = `data: ${JSON.stringify({ id: "response-1", object: "chat.completion.chunk", model: "returned", choices: [{ delta: { content: "PRIVATE_RESPONSE" } }] })}\n\ndata: ${JSON.stringify({ id: "response-1", object: "chat.completion.chunk", model: "returned", choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } })}\n\ndata: [DONE]\n\n`;
  let reads = 0;
  const config = {
    provider: {
      test: {
        options: {
          fetch: async (_url, init) => {
            assert.equal(init.headers.has("x-token-lens-local-id"), false);
            assert.equal(init.headers.get("authorization"), "PRIVATE_KEY");
            return new Response(
              new ReadableStream({
                pull(c) {
                  if (reads < wire.length) c.enqueue(Buffer.from(wire[reads++]));
                  else c.close();
                },
              }),
              { headers: { "content-type": "text/event-stream", "x-test": "preserved" } },
            );
          },
        },
      },
    },
  };
  await hooks.config(config);
  const response = await config.provider.test.options.fetch("http://local.invalid", {
    headers: { ...output.headers, authorization: "PRIVATE_KEY" },
    body: JSON.stringify({ model: "wire-name", messages: ["PRIVATE_PROMPT"] }),
  });
  assert.ok(reads < wire.length, "must preserve backpressure, no eager whole-response reader");
  assert.equal(await response.text(), wire);
  assert.equal(response.headers.get("x-test"), "preserved");
  assert.equal(rows().length, 1);
  assert.deepEqual(rows()[0], {
    id: rows()[0].id,
    startedAt: rows()[0].startedAt,
    sessionId: "session-1",
    assistantId: "assistant-1",
    requestedModel: "selected",
    sentModel: "wire-name",
    responseId: "response-1",
    responseModel: "returned",
    inputTokens: 12,
    outputTokens: 3,
    outcome: "completed",
  });
  assert.doesNotMatch(
    fs.readFileSync(journal, "utf8"),
    /PRIVATE_KEY|PRIVATE_RESPONSE|PRIVATE_PROMPT/,
  );
  // Retry keeps its exact local association; malformed and oversized frames cannot fabricate a match.
  let cancelled = false;
  const config2 = {
    provider: {
      test: {
        options: {
          fetch: async () =>
            new Response(
              new ReadableStream({
                pull(c) {
                  c.enqueue(Buffer.from("data: " + "x".repeat(300000) + "\n\n"));
                },
                cancel() {
                  cancelled = true;
                },
              }),
              { headers: { "content-type": "text/event-stream" } },
            ),
        },
      },
    },
  };
  await hooks.config(config2);
  const second = await config2.provider.test.options.fetch("http://local.invalid", {
    headers: output.headers,
    body: '{"model":"wire-name"}',
  });
  const reader = second.body.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(cancelled, true);
  assert.equal(rows()[1].assistantId, "assistant-1");
  assert.equal(rows()[1].responseModel, undefined);
  for (const payload of [
    {
      object: "response",
      id: "r-json",
      model: "selected",
      usage: { input_tokens: 7, output_tokens: 2 },
    },
    {
      type: "message",
      id: "r-claude",
      model: "claude-return",
      usage: { input_tokens: 7, output_tokens: 2 },
    },
  ]) {
    const c = {
      provider: {
        test: {
          options: {
            fetch: async () =>
              new Response(JSON.stringify(payload), {
                headers: { "content-type": "application/json" },
              }),
          },
        },
      },
    };
    await hooks.config(c);
    const r = await c.provider.test.options.fetch("http://local.invalid", {
      headers: output.headers,
      body: '{"model":"wire-name"}',
    });
    assert.deepEqual(JSON.parse(await r.text()), payload);
    assert.equal(rows().at(-1).responseModel, payload.model);
  }
  const c = {
    provider: {
      test: {
        options: {
          fetch: async () =>
            new Response('{"object":"response","id":"error","model":"selected"}', {
              status: 500,
              headers: { "content-type": "application/json" },
            }),
        },
      },
    },
  };
  await hooks.config(c);
  await (
    await c.provider.test.options.fetch("http://local.invalid", {
      headers: output.headers,
      body: '{"model":"selected"}',
    })
  ).text();
  assert.equal(rows().at(-1).responseModel, undefined);
  const conflicting = {
    provider: {
      test: {
        options: {
          fetch: async () =>
            new Response(
              'data: {"object":"chat.completion.chunk","id":"r-conflict","model":"one"}\n\ndata: {"object":"chat.completion.chunk","id":"r-conflict","model":"two"}\n\n',
              { headers: { "content-type": "text/event-stream" } },
            ),
        },
      },
    },
  };
  await hooks.config(conflicting);
  await (
    await conflicting.provider.test.options.fetch("http://local.invalid", {
      headers: output.headers,
      body: '{"model":"one"}',
    })
  ).text();
  assert.equal(
    rows().at(-1).responseModel,
    undefined,
    "conflicting response fields must stay unverified",
  );
  // A built-in provider has no config.provider entry; nested custom fetches must not double count.
  const previous = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal(init.headers.has("x-token-lens-local-id"), false);
    return new Response(
      '{"object":"response","id":"built-in-response","model":"returned-built-in"}',
      { headers: { "content-type": "application/json" } },
    );
  };
  try {
    await hooks.config({});
    const before = rows().length;
    await (
      await globalThis.fetch("http://local.invalid", {
        headers: output.headers,
        body: '{"model":"builtin-request"}',
      })
    ).text();
    assert.equal(rows().length, before + 1);
    assert.equal(rows().at(-1).responseModel, "returned-built-in");
    const custom = {
      provider: { test: { options: { fetch: (input, init) => globalThis.fetch(input, init) } } },
    };
    await hooks.config(custom);
    await (
      await custom.provider.test.options.fetch("http://local.invalid", {
        headers: output.headers,
        body: '{"model":"nested-request"}',
      })
    ).text();
    assert.equal(
      rows().length,
      before + 2,
      "nested custom/global observers must count one real request once",
    );
  } finally {
    globalThis.fetch = previous;
  }
  console.log(
    "PASS: stream unchanged, exact association, retries, backpressure, cancellation, bounded frames, JSON, privacy, error responses",
  );
}

async function runtime() {
  const configDir = path.join(temp, "config"),
    runtimeJournal = path.join(temp, "runtime-records.jsonl");
  fs.mkdirSync(path.join(configDir, "plugins"), { recursive: true });
  fs.copyFileSync(core, path.join(configDir, "plugins", "_token-lens-fetch-models.cjs"));
  fs.writeFileSync(
    path.join(configDir, "plugins", "token-lens-response-monitor.js"),
    `const TOKEN_LENS_JOURNAL = ${JSON.stringify(runtimeJournal)};\n` + asset,
  );
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      const input = JSON.parse(body);
      requests.push({ model: input.model, localHeader: req.headers["x-token-lens-local-id"] });
      const id = `mock-response-${requests.length}`;
      const chunk = {
        id,
        object: "chat.completion.chunk",
        created: 1,
        model: "independent-returned-model",
        choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }],
      };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } })}\n\ndata: [DONE]\n\n`,
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  fs.writeFileSync(
    path.join(configDir, "opencode.json"),
    JSON.stringify({
      model: "tokenlensmock/selected-test",
      small_model: "tokenlensmock/selected-test",
      permission: { "*": "deny" },
      provider: {
        tokenlensmock: {
          npm: "@ai-sdk/openai-compatible",
          name: "Offline Token Lens check",
          options: {
            baseURL: `http://127.0.0.1:${server.address().port}/v1`,
            apiKey: "offline-only",
          },
          models: {
            "selected-test": { name: "Offline test", limit: { context: 32000, output: 1000 } },
          },
        },
      },
    }),
  );
  try {
    const child = spawn(
      process.env.TOKEN_LENS_OPENCODE_EXE ??
        "D:/npm-global/node_modules/opencode-ai/bin/opencode.exe",
      [
        "--print-logs",
        "--log-level",
        "DEBUG",
        "run",
        "-m",
        "tokenlensmock/selected-test",
        "Reply OK without tools.",
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        cwd: temp,
        env: {
          ...process.env,
          OPENCODE_CONFIG_DIR: configDir,
          XDG_CONFIG_HOME: path.join(temp, "xdg-config"),
          XDG_DATA_HOME: path.join(temp, "data"),
          XDG_STATE_HOME: path.join(temp, "state"),
          OPENCODE_DISABLE_MODELS_FETCH: "true",
          OPENCODE_DISABLE_AUTOUPDATE: "true",
          OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
        },
      },
    );
    let output = "";
    child.stdout.on("data", (c) => {
      output += c;
    });
    child.stderr.on("data", (c) => {
      output += c;
    });
    const timer = setTimeout(() => child.kill(), 55000);
    const code = await new Promise((resolve) => child.on("exit", resolve));
    clearTimeout(timer);
    if (code !== 0) throw new Error(`OpenCode offline exit ${code}: ${output.slice(-1500)}`);
    assert.ok(requests.length > 0);
    assert.ok(requests.every((r) => r.localHeader === undefined));
    const captured = fs.readFileSync(runtimeJournal, "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(
      captured.some(
        (r) =>
          r.assistantId &&
          r.requestedModel === "selected-test" &&
          r.responseModel === "independent-returned-model",
      ),
      "installed runtime must deliver exact assistant context and independent model",
    );
    console.log(
      `PASS: installed OpenCode runtime, ${requests.length} offline HTTP requests, independent response model and assistant IDs`,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
(async () => {
  try {
    await check();
    if (process.argv.includes("--runtime")) await runtime();
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
