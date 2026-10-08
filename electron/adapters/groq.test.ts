import { describe, expect, it } from "vitest";
import { groqAdapter } from "./groq";

describe("groqAdapter", () => {
  it("缺少 API Key 时抛中文错误，不打网络", async () => {
    await expect(groqAdapter.fetchBalance({}, {})).rejects.toThrow(/缺少 API Key/);
  });
});
