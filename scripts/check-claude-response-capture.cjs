// Offline proof using the installed native Claude Code, no account/API traffic.
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { spawn } = require("node:child_process");
const http = require("node:http");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-claude-check-"));
const journal = path.join(temp, "records.jsonl");
for (const name of ["claude.cjs", "_token-lens-fetch-models.cjs"])
  fs.copyFileSync(path.join(__dirname, "../electron/agent-capture", name), path.join(temp, name));
fs.writeFileSync(path.join(temp, "claude-journal.json"), JSON.stringify(journal));
const requests = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => {
    body += c;
  });
  req.on("end", () => {
    if (req.url.includes("count_tokens")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"input_tokens":10}');
      return;
    }
    if (!req.url.startsWith("/v1/messages")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    const payload = JSON.parse(body);
    requests.push({ model: payload.model });
    const message = {
      id: "msg_offline_check",
      type: "message",
      role: "assistant",
      model: "independent-claude-return",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    };
    const events = [
      { type: "message_start", message },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "PRIVATE_RESPONSE" },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 1 },
      },
      { type: "message_stop" },
    ];
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""));
  });
});
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const env = {
      ...process.env,
      BUN_OPTIONS: `--preload=${path.join(temp, "claude.cjs").replaceAll("\\", "/")}`,
      CLAUDE_CONFIG_DIR: path.join(temp, "config"),
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      ANTHROPIC_API_KEY: "PRIVATE_OFFLINE_KEY",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    };
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    delete env.ANTHROPIC_AUTH_TOKEN;
    const exe =
      process.env.TOKEN_LENS_CLAUDE_EXE ?? path.join(os.homedir(), ".local", "bin", "claude.exe");
    const child = spawn(
      exe,
      [
        "-p",
        "PRIVATE_PROMPT",
        "--model",
        "claude-offline-selected",
        "--tools",
        "",
        "--no-session-persistence",
        "--setting-sources",
        "",
        "--output-format",
        "json",
      ],
      { cwd: temp, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (c) => {
      output += c;
    });
    child.stderr.on("data", (c) => {
      output += c;
    });
    const timer = setTimeout(() => child.kill(), 50000);
    const code = await new Promise((resolve, reject) => {
      child.on("exit", resolve);
      child.on("error", reject);
    });
    clearTimeout(timer);
    assert.equal(
      code,
      0,
      `native CLI failed (output retained only in test memory), requests=${requests.length}`,
    );
    assert.ok(requests.length > 0);
    const raw = fs.readFileSync(journal, "utf8"),
      captured = raw.trim().split("\n").map(JSON.parse);
    assert.ok(
      captured.some(
        (r) =>
          r.requestedModel === "claude-offline-selected" &&
          r.responseModel === "independent-claude-return" &&
          r.responseId === "msg_offline_check",
      ),
    );
    assert.doesNotMatch(raw, /PRIVATE_PROMPT|PRIVATE_RESPONSE|PRIVATE_OFFLINE_KEY/);
    console.log(
      `PASS: native Claude Code, ${requests.length} offline requests, independent request/response models, response ID, metadata-only journal`,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    try {
      fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
      console.log(
        "Cleanup skipped: Windows denied removal of the isolated temporary check directory.",
      );
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
