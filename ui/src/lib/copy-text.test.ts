import { describe, expect, it } from "vitest";
import { writeClipboard } from "./copy-text";

describe("writeClipboard", () => {
  it("写出文本", async () => {
    let got = "";
    const out = await writeClipboard("hi", async (t) => {
      got = t;
    });
    expect(out).toEqual({ ok: true });
    expect(got).toBe("hi");
  });

  it("失败带回原因，不当成成功", async () => {
    const out = await writeClipboard("x", async () => {
      throw new Error("权限被拒");
    });
    expect(out).toEqual({ ok: false, error: "权限被拒" });
  });
});
