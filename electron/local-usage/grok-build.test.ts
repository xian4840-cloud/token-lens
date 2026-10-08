import { describe, expect, it } from "vitest";
import { usageParts } from "./grok-build";

describe("usageParts", () => {
  it("从 output 里拆出 reasoning，不双计", () => {
    const p = usageParts({
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 10,
      cachedReadTokens: 20,
      cacheCreationTokens: 3,
    });
    expect(p.output).toBe(40);
    expect(p.reasoning).toBe(10);
    expect(p.input).toBe(100);
    expect(p.cacheRead).toBe(20);
    expect(p.cacheCreation).toBe(3);
  });

  it("reasoning 大于 output 时 output 夹到 0，不当成负数", () => {
    const p = usageParts({ outputTokens: 5, reasoningTokens: 9 });
    expect(p.output).toBe(0);
    expect(p.reasoning).toBe(9);
  });
});
