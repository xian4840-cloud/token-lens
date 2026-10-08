import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCsp } from "./http";

/**
 * 渲染进程内容安全策略。
 */

function directive(csp: string, name: string): string[] {
  const part = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${name} `));
  return part ? part.split(/\s+/).slice(1) : [];
}

const uiSrc = path.resolve(__dirname, "../../ui/src");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

describe("buildCsp", () => {
  it("生产环境 connect-src 只有 'self'（回归：此前放行了十几个厂商域名）", () => {
    expect(directive(buildCsp(false), "connect-src")).toEqual(["'self'"]);
  });

  it("生产环境 script-src 只有 'self'，不放行内联脚本", () => {
    expect(directive(buildCsp(false), "script-src")).toEqual(["'self'"]);
  });

  it("开发环境额外放行 Vite dev server（HMR）", () => {
    expect(directive(buildCsp(true), "connect-src")).toEqual(
      expect.arrayContaining(["'self'", "http://localhost:5173", "ws://127.0.0.1:5173"]),
    );
  });

  it("渲染进程源码里没有直接网络请求（connect-src 'self' 的前提）", () => {
    const offenders = walk(uiSrc).filter((f) =>
      /\bfetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket|new\s+EventSource|sendBeacon\s*\(/.test(
        fs.readFileSync(f, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe("ui/index.html 与生产 CSP 兼容", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../../ui/index.html"), "utf8");

  it("没有内联脚本（script-src 'self' 会拦掉，桌宠首帧就不透明了）", () => {
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(
      ([, attrs, body]) => !/\bsrc=/.test(attrs) || body.trim() !== "",
    );
    expect(inline).toEqual([]);
  });

  it("桌宠首帧透明脚本是同源外链，在 <head> 里、早于入口模块执行", () => {
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toMatch(/<script src="\/pet-boot\.js"><\/script>/);
    const boot = fs.readFileSync(path.resolve(__dirname, "../../ui/public/pet-boot.js"), "utf8");
    // 在一个最小 DOM 替身里跑一遍：#/pet 时加类，其它路由不加
    for (const [hash, expected] of [["#/pet", true], ["#/", false]] as const) {
      const classes = new Set<string>();
      const fn = new Function("location", "document", boot);
      fn({ hash }, { documentElement: { classList: { add: (c: string) => classes.add(c) } } });
      expect(classes.has("pet-window")).toBe(expected);
    }
  });
});
