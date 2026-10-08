import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EVENT_CHANNELS, INVOKE_CHANNELS, SEND_CHANNELS } from "../shared/ipc";
import { registerIpc } from "./ipc";
import type { GuardConfig } from "./lib/ipc-guard";

/**
 * 两个 preload 实际用到的通道：替换 electron 的 contextBridge / ipcRenderer，
 * 加载 preload 拿到它暴露的 api，逐个调用并记录打到了哪个通道。
 */
const electronFake = vi.hoisted(() => ({
  exposed: undefined as Record<string, (...args: unknown[]) => unknown> | undefined,
  calls: [] as { kind: "invoke" | "send" | "on"; channel: string }[],
}));
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, api: Record<string, (...args: unknown[]) => unknown>) => {
      electronFake.exposed = api;
    },
  },
  ipcRenderer: {
    invoke: (channel: string) => (electronFake.calls.push({ kind: "invoke", channel }), Promise.resolve()),
    send: (channel: string) => void electronFake.calls.push({ kind: "send", channel }),
    on: (channel: string) => void electronFake.calls.push({ kind: "on", channel }),
    removeListener: () => undefined,
  },
  // ipc.ts 用到的其余导出：测试里不会真的调用
  app: undefined,
  BrowserWindow: undefined,
  dialog: undefined,
  ipcMain: undefined,
  shell: undefined,
  webContents: undefined,
  session: undefined,
  safeStorage: undefined,
  screen: undefined,
  net: undefined,
}));

interface PreloadUsage {
  methods: Record<string, { kind: string; channel: string }>;
  channels: string[];
}

async function loadPreload(file: "./preload" | "./pet-preload"): Promise<PreloadUsage> {
  vi.resetModules();
  electronFake.exposed = undefined;
  await import(file);
  const api = electronFake.exposed!;
  const methods: PreloadUsage["methods"] = {};
  for (const [name, fn] of Object.entries(api)) {
    electronFake.calls.length = 0;
    void fn(() => undefined);
    expect(electronFake.calls, name).toHaveLength(1);
    methods[name] = electronFake.calls[0];
  }
  return { methods, channels: Object.values(methods).filter((m) => m.kind !== "on").map((m) => m.channel) };
}

const mainPreload = await loadPreload("./preload");
const petPreload = await loadPreload("./pet-preload");

/**
 * IPC 暴露面的整体约束：
 * - 主进程注册的每个通道都经过 ipc-guard（没有绕过它直接 ipcMain.handle/on 的）；
 * - 主窗口 preload 用到的通道都对主窗口开放；
 * - 桌宠 preload 只用桌宠通道，主进程侧这些通道对桌宠开放，其余一律不对桌宠开放；
 * - 改注册表 / 往用户目录装脚本 / 启动外部程序的通道是高危策略。
 */

function fakeIpc() {
  const registered: string[] = [];
  return {
    registered,
    handle: (c: string) => void registered.push(c),
    on: (c: string) => void registered.push(c),
  };
}

const cfg: GuardConfig = {
  indexHtmlPath: "/app/ui/dist/index.html",
  platform: "linux",
  roleOf: () => undefined,
  isFocused: () => false,
};

function channelsUsedBy(file: "preload.ts" | "pet-preload.ts"): string[] {
  return (file === "preload.ts" ? mainPreload : petPreload).channels;
}

describe("IPC 暴露面", () => {
  const ipc = fakeIpc();
  const guard = registerIpc(ipc, () => cfg);
  const policies = guard.policies;

  it("每个注册到 ipcMain 的通道都带有发送方策略", () => {
    expect(ipc.registered.length).toBeGreaterThan(40);
    expect(new Set(ipc.registered).size).toBe(ipc.registered.length);
    for (const c of ipc.registered) expect(policies.has(c), c).toBe(true);
  });

  it("源码里没有绕过 guard 直接调用 ipcMain.handle / ipcMain.on 的地方", () => {
    const files = (fs.readdirSync(__dirname, { recursive: true }) as string[]).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    expect(files).toContain(path.join("pet", "ipc.ts"));
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, f), "utf8");
      expect(/ipcMain\.(handle|on|once|handleOnce)\(/.test(src), f).toBe(false);
    }
  });

  it("主窗口 preload 用到的通道都已注册并对主窗口开放", () => {
    const used = channelsUsedBy("preload.ts");
    expect(used.length).toBeGreaterThan(30);
    for (const c of used) expect(policies.get(c)?.roles, c).toContain("main");
  });

  it("桌宠 preload 只用到桌宠需要的通道", () => {
    const used = channelsUsedBy("pet-preload.ts").sort();
    expect(used).toEqual(
      [
        "logs:report-renderer-error",
        "pet:drag-end",
        "pet:drag-move",
        "pet:drag-start",
        "pet:getActivity",
        "pet:todaySpend",
      ].sort(),
    );
    for (const c of used) expect(policies.get(c)?.roles, c).toContain("pet");
  });

  it("除上述通道外，没有任何通道对桌宠窗口开放", () => {
    const petOpen = [...policies].filter(([, p]) => p.roles.includes("pet")).map(([c]) => c).sort();
    expect(petOpen).toEqual(channelsUsedBy("pet-preload.ts").sort());
  });

  it("主窗口 preload 不再暴露桌宠专用通道", () => {
    const used = channelsUsedBy("preload.ts");
    for (const c of ["pet:todaySpend", "pet:getActivity", "pet:drag-start", "pet:drag-move", "pet:drag-end"]) {
      expect(used).not.toContain(c);
    }
  });

  it("高危通道只对主窗口开放，并限定从模型监测页发起", () => {
    for (const c of [
      "model-monitor:enable-claude",
      "model-monitor:enable-opencode",
      "model-monitor:disable-claude",
      "model-monitor:disable-opencode",
      "model-monitor:launch-codex",
    ]) {
      expect(policies.get(c), c).toEqual({ roles: ["main"], highRisk: { route: "/model-monitor" } });
    }
  });

  it("preload 的每个方法都打到 shared/ipc.ts 通道表里登记的通道", () => {
    for (const usage of [mainPreload, petPreload]) {
      for (const [method, { kind, channel }] of Object.entries(usage.methods)) {
        if (kind === "invoke") expect(channel, method).toBe(INVOKE_CHANNELS[method as keyof typeof INVOKE_CHANNELS]);
        else if (kind === "send") expect(channel, method).toBe(SEND_CHANNELS[method as keyof typeof SEND_CHANNELS]);
        else {
          // onXxxUpdated / onXxx -> 事件名 xxxUpdated / xxx
          const event = method.replace(/^on(.)/, (_m, c: string) => c.toLowerCase());
          expect(channel, method).toBe(EVENT_CHANNELS[event as keyof typeof EVENT_CHANNELS]);
        }
      }
    }
  });

  it("通道表里的 invoke / send 通道都已在主进程注册，主进程也没有表外的通道", () => {
    const declared = [...Object.values(INVOKE_CHANNELS), ...Object.values(SEND_CHANNELS)].sort();
    expect([...ipc.registered].sort()).toEqual(declared);
  });

  it("通道名在各表内外都不重复", () => {
    const all = [
      ...Object.values(INVOKE_CHANNELS),
      ...Object.values(SEND_CHANNELS),
      ...Object.values(EVENT_CHANNELS),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it("preload 运行在沙箱里，运行时只能 require electron（其余只允许 import type）", () => {
    for (const file of ["preload.ts", "pet-preload.ts"]) {
      const src = fs.readFileSync(path.join(__dirname, file), "utf8");
      const runtimeImports = [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
      expect(runtimeImports, file).toEqual(["electron"]);
    }
  });
});

