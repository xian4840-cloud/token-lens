import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLAUDE_PRELOAD_MARKER,
  claudeCapturePaths,
  claudePreloadFlag,
  disableClaudeCapture,
  disableOpenCodeCapture,
  enableClaudeCapture,
  enableOpenCodeCapture,
  FETCH_HELPER_MARKER,
  FETCH_HELPER_NAME,
  isClaudeCaptureInstalled,
  isOpenCodeCaptureInstalled,
  OPENCODE_PLUGIN_MARKER,
  openCodeCapturePaths,
  resetBunOptionsCacheForTest,
  stripBunPreloadFlag,
  windowsBunOptionsStore,
  type UserEnvStore,
} from "./agent-response-capture";

/**
 * 「关闭采集」与卸载清理：只撤销 enable 写下的东西，不碰别人的。
 * 注册表用内存假实现（UserEnvStore），文件系统用临时目录。
 */

const ASSETS = path.join(__dirname, "agent-capture");
const FLAG = "--preload=C:/Users/me/.claude/token-lens-monitor/claude.cjs";

let tmp: string;
let home: string;
let dataRoot: string;
const savedBun = process.env.BUN_OPTIONS;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tl-capture-"));
  home = path.join(tmp, "home");
  dataRoot = path.join(tmp, "app-data");
  fs.mkdirSync(home, { recursive: true });
  resetBunOptionsCacheForTest();
  delete process.env.BUN_OPTIONS;
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (savedBun === undefined) delete process.env.BUN_OPTIONS;
  else process.env.BUN_OPTIONS = savedBun;
  resetBunOptionsCacheForTest();
});

function memoryStore(initial: string | undefined) {
  const state = { value: initial, sets: [] as string[], removes: 0 };
  const store: UserEnvStore = {
    get: () => state.value ?? "",
    set: (v) => { state.value = v; state.sets.push(v); },
    remove: () => { state.value = undefined; state.removes += 1; },
  };
  return { state, store };
}

/** 按 enable 的写法铺好 Claude 那三个文件 */
function seedClaudeFiles() {
  const p = claudeCapturePaths(dataRoot, home);
  fs.mkdirSync(p.directory, { recursive: true });
  fs.writeFileSync(p.preload, CLAUDE_PRELOAD_MARKER + "module.exports = 1;\n");
  fs.copyFileSync(path.join(ASSETS, FETCH_HELPER_NAME), p.helper);
  fs.writeFileSync(p.journalPointer, JSON.stringify(p.journal));
  return p;
}

describe("stripBunPreloadFlag", () => {
  it("只有我们那一段：去掉后为空", () => {
    expect(stripBunPreloadFlag(FLAG, FLAG)).toBe("");
  });
  it("用户自己的选项原样保留（包括空白格式）", () => {
    expect(stripBunPreloadFlag(`--smol ${FLAG}`, FLAG)).toBe("--smol");
    expect(stripBunPreloadFlag(`${FLAG} --smol`, FLAG)).toBe("--smol");
    expect(stripBunPreloadFlag(`--a  --b ${FLAG} --c`, FLAG)).toBe("--a  --b --c");
  });
  it("重复出现的也都去掉", () => {
    expect(stripBunPreloadFlag(`${FLAG} ${FLAG} --x ${FLAG}`, FLAG)).toBe("--x");
  });
  it("相似但不同的值不动", () => {
    for (const v of [`${FLAG}.bak`, `x${FLAG}`, "--preload=C:/other.cjs", ""]) {
      expect(stripBunPreloadFlag(v, FLAG)).toBe(v);
    }
  });
  it("flag 由用户目录推出，与 NSIS 里的拼法一致（反斜杠换成正斜杠）", () => {
    const preload = path.win32.join("C:\\Users\\me", ".claude", "token-lens-monitor", "claude.cjs");
    expect(claudePreloadFlag(preload)).toBe(FLAG);
  });
});

describe("disableClaudeCapture", () => {
  it("删掉三个文件和空目录，BUN_OPTIONS 只去掉我们那一段", () => {
    const p = seedClaudeFiles();
    const flag = claudePreloadFlag(p.preload);
    const { state, store } = memoryStore(`--smol ${flag}`);
    const r = disableClaudeCapture(dataRoot, { home, envStore: store });
    expect(state.value).toBe("--smol");
    expect(state.removes).toBe(0);
    expect(fs.existsSync(p.directory)).toBe(false);
    expect(r.removed).toEqual([
      `HKCU\\Environment\\BUN_OPTIONS: ${flag}`,
      p.preload,
      p.helper,
      p.journalPointer,
      p.directory,
    ]);
    expect(r.kept).toEqual([]);
  });

  it("BUN_OPTIONS 只剩我们那一段时删除整个值", () => {
    const p = seedClaudeFiles();
    const { state, store } = memoryStore(claudePreloadFlag(p.preload));
    disableClaudeCapture(dataRoot, { home, envStore: store });
    expect(state.value).toBeUndefined();
    expect(state.removes).toBe(1);
    expect(state.sets).toEqual([]);
  });

  it("BUN_OPTIONS 里没有我们的值：不写注册表", () => {
    seedClaudeFiles();
    const { state, store } = memoryStore("--smol");
    const r = disableClaudeCapture(dataRoot, { home, envStore: store });
    expect(state.sets).toEqual([]);
    expect(state.removes).toBe(0);
    expect(r.removed.some((x) => x.includes("BUN_OPTIONS"))).toBe(false);
  });

  it("不是我们写的同名文件、目录里用户自己的文件都保留，目录也因此保留", () => {
    const p = seedClaudeFiles();
    fs.writeFileSync(p.preload, "// my own preload\n");
    fs.writeFileSync(p.journalPointer, JSON.stringify("C:/somewhere/else.jsonl"));
    fs.writeFileSync(path.join(p.directory, "notes.txt"), "mine");
    const r = disableClaudeCapture(dataRoot, { home, envStore: null });
    expect(fs.readFileSync(p.preload, "utf8")).toBe("// my own preload\n");
    expect(fs.existsSync(p.journalPointer)).toBe(true);
    expect(fs.existsSync(path.join(p.directory, "notes.txt"))).toBe(true);
    expect(fs.existsSync(p.helper)).toBe(false);
    expect(r.removed).toEqual([p.helper]);
    expect(r.kept).toEqual([p.preload, p.journalPointer, p.directory]);
  });

  it("同名的是目录 / 符号链接时不跟进、不删除", () => {
    const p = claudeCapturePaths(dataRoot, home);
    fs.mkdirSync(path.join(p.preload), { recursive: true });
    const target = path.join(tmp, "victim.cjs");
    fs.writeFileSync(target, CLAUDE_PRELOAD_MARKER);
    fs.symlinkSync(target, p.helper);
    const r = disableClaudeCapture(dataRoot, { home, envStore: null });
    expect(fs.statSync(p.preload).isDirectory()).toBe(true);
    expect(fs.existsSync(target)).toBe(true);
    expect(r.kept).toEqual(expect.arrayContaining([p.preload, p.helper]));
  });

  it("什么都没装时不报错、不动注册表；重复关闭是幂等的", () => {
    const { state, store } = memoryStore(undefined);
    expect(disableClaudeCapture(dataRoot, { home, envStore: store })).toEqual({ removed: [], kept: [] });
    expect(state.sets).toEqual([]);
    expect(state.removes).toBe(0);
  });

  it("同步清理本进程的 BUN_OPTIONS（免得之后从 Token Lens 启动的子进程继续带着）", () => {
    const p = seedClaudeFiles();
    process.env.BUN_OPTIONS = claudePreloadFlag(p.preload);
    disableClaudeCapture(dataRoot, { home, envStore: memoryStore(undefined).store });
    expect(process.env.BUN_OPTIONS).toBeUndefined();
  });

  it("enable -> disable 往返：文件与 BUN_OPTIONS 都回到 enable 之前", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const { state, store } = memoryStore("--smol");
    vi.spyOn(windowsBunOptionsStore, "get").mockImplementation(store.get);
    vi.spyOn(windowsBunOptionsStore, "set").mockImplementation(store.set);
    vi.spyOn(windowsBunOptionsStore, "remove").mockImplementation(store.remove);
    const before = listTree(home);
    enableClaudeCapture(ASSETS, dataRoot);
    const p = claudeCapturePaths(dataRoot, home);
    expect(state.value).toBe(`--smol ${claudePreloadFlag(p.preload)}`);
    expect(fs.readdirSync(p.directory).sort()).toEqual([FETCH_HELPER_NAME, "claude-journal.json", "claude.cjs"].sort());
    expect(isClaudeCaptureInstalled(dataRoot, home)).toBe(true);
    disableClaudeCapture(dataRoot);
    expect(state.value).toBe("--smol");
    // ~/.claude 是 enable 用 mkdir -p 带出来的父目录，可能本来就有用户的 Claude 配置，不删
    expect(listTree(home)).toEqual([...before, ".claude"]);
    resetBunOptionsCacheForTest();
    expect(isClaudeCaptureInstalled(dataRoot, home)).toBe(false);
  });
});

describe("disableOpenCodeCapture", () => {
  const asset = path.join(ASSETS, "opencode.mjs");

  it("enable -> disable 往返：删掉插件与辅助文件，插件目录和其他插件保留", () => {
    const configRoot = path.join(tmp, "opencode");
    const other = path.join(configRoot, "plugins", "someone-else.js");
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(other, "export default {}\n");
    enableOpenCodeCapture(asset, dataRoot, configRoot);
    const p = openCodeCapturePaths(dataRoot, configRoot);
    expect(isOpenCodeCaptureInstalled(dataRoot, configRoot)).toBe(true);
    const r = disableOpenCodeCapture(dataRoot, configRoot);
    expect(r).toEqual({ removed: [p.plugin, p.helper], kept: [] });
    expect(fs.readdirSync(path.join(configRoot, "plugins"))).toEqual(["someone-else.js"]);
    expect(isOpenCodeCaptureInstalled(dataRoot, configRoot)).toBe(false);
  });

  it("同名插件不是我们写的：保留", () => {
    const configRoot = path.join(tmp, "opencode");
    const p = openCodeCapturePaths(dataRoot, configRoot);
    fs.mkdirSync(path.dirname(p.plugin), { recursive: true });
    fs.writeFileSync(p.plugin, "// Somebody else's plugin\n");
    fs.writeFileSync(p.helper, "module.exports = 'not ours';\n");
    const r = disableOpenCodeCapture(dataRoot, configRoot);
    expect(r).toEqual({ removed: [], kept: [p.plugin, p.helper] });
    expect(fs.existsSync(p.plugin)).toBe(true);
    expect(fs.existsSync(p.helper)).toBe(true);
  });

  it("采集日志在应用数据目录里，关闭时保留", () => {
    const configRoot = path.join(tmp, "opencode");
    enableOpenCodeCapture(asset, dataRoot, configRoot);
    const p = openCodeCapturePaths(dataRoot, configRoot);
    fs.mkdirSync(path.dirname(p.journal), { recursive: true });
    fs.writeFileSync(p.journal, "{}\n");
    disableOpenCodeCapture(dataRoot, configRoot);
    expect(fs.existsSync(p.journal)).toBe(true);
  });
});

describe("与 NSIS 卸载脚本（build/installer.nsh）一致", () => {
  const nsh = fs.readFileSync(path.join(__dirname, "..", "build", "installer.nsh"), "utf8");
  const define = (name: string) => nsh.match(new RegExp(`!define ${name} "([^"]*)"`))?.[1];

  it("首行标记与 TS 常量一致；内置辅助脚本确实以该标记开头", () => {
    expect(`${define("TL_CLAUDE_MARKER")}\n`).toBe(CLAUDE_PRELOAD_MARKER);
    expect(`${define("TL_OPENCODE_MARKER")}\n`).toBe(OPENCODE_PLUGIN_MARKER);
    expect(`${define("TL_HELPER_MARKER")}\n`).toBe(FETCH_HELPER_MARKER);
    expect(define("TL_HELPER_NAME")).toBe(FETCH_HELPER_NAME);
    expect(fs.readFileSync(path.join(ASSETS, FETCH_HELPER_NAME), "utf8").startsWith(FETCH_HELPER_MARKER)).toBe(true);
  });

  it("清理的路径与 enable 写入的路径逐项对应", () => {
    const winHome = "C:\\Users\\me";
    const c = claudeCapturePaths("D:\\data", winHome);
    const rel = (p: string) => p.replace(winHome, "$PROFILE").replaceAll("/", "\\");
    for (const p of [c.preload, c.journalPointer]) expect(nsh).toContain(`"${rel(p)}"`);
    expect(nsh).toContain('"$PROFILE\\.claude\\token-lens-monitor\\${TL_HELPER_NAME}"');
    expect(nsh).toContain('RMDir "$PROFILE\\.claude\\token-lens-monitor"');
    const o = openCodeCapturePaths("D:\\data", "X");
    expect(nsh).toContain(`"$R0\\plugins\\${path.basename(o.plugin)}"`);
    expect(nsh).toContain('"$R0\\plugins\\${TL_HELPER_NAME}"');
    expect(nsh).toContain('StrCpy $R0 "$PROFILE\\.config\\opencode"');
    expect(nsh).toContain("ReadEnvStr $R0 OPENCODE_CONFIG_DIR");
    // BUN_OPTIONS：同一个值名、同一种 flag 拼法
    expect(nsh).toContain('ReadRegStr $R0 HKCU "Environment" "BUN_OPTIONS"');
    expect(nsh).toContain('StrCpy $R1 "--preload=$R1/.claude/token-lens-monitor/claude.cjs"');
  });

  it("保守：不递归删除、不用通配符删除，升级安装时不清理", () => {
    expect(nsh).not.toMatch(/RMDir\s+\/r/i);
    expect(nsh).not.toMatch(/Delete\s+(\/\w+\s+)?"[^"]*\*/);
    expect(nsh).toMatch(/\$\{ifNot\} \$\{isUpdated\}\s+Call un\.TLCleanupAgentCapture/);
  });
});

function listTree(root: string): string[] {
  return (fs.readdirSync(root, { recursive: true }) as string[]).sort();
}
