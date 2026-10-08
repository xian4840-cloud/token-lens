import { describe, expect, it } from "vitest";
import { geminiAdapter } from "./gemini";

describe("geminiAdapter", () => {
  it("缺少 API Key 时抛中文错误，不打网络", async () => {
    await expect(geminiAdapter.fetchBalance({}, {})).rejects.toThrow(/缺少 API Key/);
  });
});
