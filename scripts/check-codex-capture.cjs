// Offline Windows integration check: stdio, argument quoting, metadata-only storage and child cleanup.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
if (process.platform !== "win32") {
  console.log("Native collector check requires Windows");
  process.exit(0);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-capture-check-"));
const exe = path.join(dir, "CodexCapture.exe"),
  fixture = path.join(dir, "backend.cjs");
const env = {
  ...process.env,
  TOKEN_LENS_REAL_CODEX: process.execPath,
  TOKEN_LENS_CAPTURE_DIR: dir,
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function check() {
  execFileSync(
    path.join(process.env.WINDIR, "Microsoft.NET/Framework64/v4.0.30319/csc.exe"),
    [
      "/nologo",
      "/target:exe",
      "/reference:System.Web.Extensions.dll",
      "/out:" + exe,
      path.join(__dirname, "../electron/codex-capture/CodexCapture.cs"),
    ],
    { windowsHide: true },
  );
  fs.writeFileSync(
    fixture,
    String.raw`
    const fs=require('node:fs');
    if(process.argv.includes('--keepalive')) {console.log(process.pid);setInterval(()=>{},1000);}
    else if(process.argv.includes('--interactive')) {process.stdin.on('data',b=>process.stdout.write(b));}
    else {
      const bytes=fs.readFileSync(0);process.stdout.write(bytes);console.log(JSON.stringify(process.argv.slice(2)));
      const emit=message=>console.error(JSON.stringify({target:'tungstenite::protocol',fields:{message}}));
      emit('Sending frame PRIVATE_AUTH');
      for(const type of ['response.created','response.completed'])emit('Received message '+JSON.stringify({type,response:{id:'resp_offline',model:'server-model',output:'PRIVATE_RESPONSE'}}));
      emit('Sending frame '+('PRIVATE_AUTH '.repeat(100000)));
      emit('Received message '+JSON.stringify({type:'response.output_text.delta',delta:'PRIVATE_RESPONSE'}));
      emit('Received message '+JSON.stringify({type:'response.completed',response:{id:'resp_large',model:'large-model',output:'PRIVATE_RESPONSE'.repeat(10000)}}));
      // Standard JSON parsing remains the authority: escaped names, nested decoys,
      // ordinary warnings mentioning a target, and alternate envelope layouts.
      emit('Received message {"type":"\\u0072esponse.created","response":{"id":"resp_escaped","model":"escaped-model"}}');
      emit('SSE event: '+JSON.stringify({type:'response.incomplete',response:{id:'resp_sse',model:'sse-model'}}));
      console.error(JSON.stringify({fields:{message:'Received message '+JSON.stringify({type:'response.failed',response:{id:'resp_layout',model:'layout-model'}})},target:'codex_api::sse::responses'},null,0));
      console.error(JSON.stringify({target:'codex_api::sse::responses',fields:{message:'SSE event: '+JSON.stringify({type:'response.created',response:{id:'resp_spaced',model:'spaced-model'}})}},null,1).replace(/\n/g,''));
      emit('Received message '+JSON.stringify({type:'response.completed',response:{output:{id:'resp_decoy',model:'decoy-model'}}}));
      console.error(JSON.stringify({target:'other',fields:{message:'warning about tungstenite::protocol and codex_api::sse::responses'}}));
      console.error('ordinary warning');
    }
  `,
  );
  const args = ["app-server", "", 'a "quoted" model', "C:\\folder space\\", "中文"];
  const input = "PRIVATE_REQUEST\0中文\n";
  let stderr = "";
  const child = spawn(exe, [fixture, ...args], { env, windowsHide: true });
  const output = [];
  child.stdout.on("data", (b) => output.push(b));
  child.stderr.on("data", (b) => (stderr += b.toString("utf8")));
  child.stdin.end(input);
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  assert.equal(code, 0);
  const body = Buffer.concat(output).toString("utf8");
  assert(body.startsWith(input));
  assert.deepEqual(JSON.parse(body.slice(input.length).trim()), args);
  assert(stderr.includes("ordinary warning"));
  assert(!stderr.includes("PRIVATE"));
  assert(stderr.includes("warning about tungstenite::protocol"));
  const rows = fs.readFileSync(
    path.join(
      dir,
      fs.readdirSync(dir).find((f) => /^responses-\d+\.jsonl$/.test(f)),
    ),
    "utf8",
  );
  assert(!rows.includes("PRIVATE"));
  const records = rows
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(records.length, 7);
  assert.deepEqual(
    records.map((r) => [r.responseId, r.model]),
    [
      ["resp_offline", "server-model"],
      ["resp_offline", "server-model"],
      ["resp_large", "large-model"],
      ["resp_escaped", "escaped-model"],
      ["resp_sse", "sse-model"],
      ["resp_layout", "layout-model"],
      ["resp_spaced", "spaced-model"],
    ],
  );
  const status = JSON.parse(fs.readFileSync(path.join(dir, "collector.json"), "utf8"));
  assert.equal(status.responseCount, 4);
  const interactive = spawn(exe, [fixture, "app-server", "--interactive"], {
    env,
    windowsHide: true,
  });
  const echo = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      interactive.kill();
      reject(new Error("Stdio must flush before EOF"));
    }, 3000);
    interactive.once("error", reject);
    interactive.stdout.once("data", (b) => {
      clearTimeout(timeout);
      resolve(b.toString("utf8"));
    });
    interactive.stdin.write("interactive 中文\n");
  });
  assert.equal(echo, "interactive 中文\n");
  interactive.stdin.end();
  await new Promise((resolve) => interactive.once("exit", resolve));
  const alive = spawn(exe, [fixture, "app-server", "--keepalive"], { env, windowsHide: true });
  const nativePid = await new Promise((resolve, reject) => {
    alive.once("error", reject);
    alive.stdout.once("data", (b) => resolve(Number(b.toString().trim())));
  });
  alive.kill();
  let remains = true;
  for (let i = 0; i < 40; i++) {
    try {
      process.kill(nativePid, 0);
    } catch {
      remains = false;
      break;
    }
    await delay(50);
  }
  assert(!remains, "Native backend must exit when wrapper is terminated");
  console.log(
    "PASS: native stdio, Windows arguments, metadata-only capture and forced-exit cleanup",
  );
}
check()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  });
