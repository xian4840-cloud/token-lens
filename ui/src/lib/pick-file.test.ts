import { describe, expect, it } from "vitest";
import { readFileAsText } from "./pick-file";

describe("readFileAsText", () => {
  it("读成功返回文本", async () => {
    const out = await readFileAsText({
      text: async () => "hello",
    });
    expect(out).toEqual({ ok: true, text: "hello" });
  });

  it("读失败带回原因，不把空 then 当成功", async () => {
    const out = await readFileAsText({
      text: async () => {
        throw new Error("磁盘坏了");
      },
    });
    expect(out).toEqual({ ok: false, error: "磁盘坏了" });
  });
});
