import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listJsonlFilesWithStat } from "./files";
import { getRecentLogs } from "../lib/logger";

/**
 * 目录枚举的失败必须留痕。
 *
 * 读不到目录与「目录里没有文件」返回的是同一个空数组，而前者会让该来源在界面上
 * 显示成「正常但零用量」——一个静默的错误答案。项目在 antigravity.ts 里已经明确
 * 反对这个模式（「避免呈现「正常但零用量」的静默错误答案」），这里补上同等的处理。
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-files-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function loggedWith(scope: string, fragment: string): boolean {
  return getRecentLogs().some((e) => e.scope === scope && e.message.includes(fragment));
}

describe("listJsonlFilesWithStat", () => {
  it("目录不存在时返回空数组（这是正常的「没装/没用过」）", async () => {
    expect(await listJsonlFilesWithStat(path.join(dir, "nope"))).toEqual([]);
    // 不存在的目录不该留痕：绝大多数用户都没装全部五个 agent
    expect(loggedWith("local-usage", "读取目录失败")).toBe(false);
  });

  it("目录读不了时返回空数组，但记一条警告（回归）", async () => {
    // 用一个普通文件冒充目录：existsSync 为真，readdirSync 抛 ENOTDIR，
    // 正好复现「路径存在但读不了」这一类失败
    const notADir = path.join(dir, "a-file.jsonl");
    fs.writeFileSync(notADir, "", "utf8");

    expect(await listJsonlFilesWithStat(notADir)).toEqual([]);
    expect(loggedWith("local-usage", "读取目录失败")).toBe(true);
    expect(loggedWith("local-usage", notADir)).toBe(true);
  });

  it("正常目录照常递归列出 .jsonl", async () => {
    const sub = path.join(dir, "proj");
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, "s1.jsonl"), "", "utf8");
    fs.writeFileSync(path.join(sub, "ignored.txt"), "", "utf8");

    const found = await listJsonlFilesWithStat(dir);
    expect(found.map((f) => path.basename(f.path))).toEqual(["s1.jsonl"]);
  });

  it("多层目录、按路径稳定排序，并带上 size（异步枚举）", async () => {
    for (const p of ["b/2.jsonl", "a/x/1.jsonl", "a/0.jsonl", "c.jsonl"]) {
      fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
      fs.writeFileSync(path.join(dir, p), "abc\n", "utf8");
    }
    const pending = listJsonlFilesWithStat(dir);
    expect(pending).toBeInstanceOf(Promise);
    const found = await pending;
    expect(found.map((f) => path.relative(dir, f.path).replace(/\\/g, "/"))).toEqual([
      "a/0.jsonl",
      "a/x/1.jsonl",
      "b/2.jsonl",
      "c.jsonl",
    ]);
    expect(found.every((f) => f.size === 4 && f.mtimeMs > 0)).toBe(true);
  });
});
