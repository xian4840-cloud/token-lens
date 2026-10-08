import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerIpc } from "./ipc";
import type { GuardConfig } from "./lib/ipc-guard";

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

function channelsUsedBy(file: string): string[] {
  const src = fs.readFileSync(path.join(__dirname, file), "utf8");
  return [...src.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*"([^"]+)"/g)].map((m) => m[1]);
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
      "model-monitor:launch-codex",
    ]) {
      expect(policies.get(c), c).toEqual({ roles: ["main"], highRisk: { route: "/model-monitor" } });
    }
  });
});
