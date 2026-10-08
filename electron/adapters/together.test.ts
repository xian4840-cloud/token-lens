import { describe, expect, it } from "vitest";
import { togetherAdapter } from "./together";

describe("togetherAdapter", () => {
  it("缺少 API Key 时抛中文错误，不打网络", async () => {
    await expect(togetherAdapter.fetchBalance({}, {})).rejects.toThrow(/缺少 API Key/);
  });
});
