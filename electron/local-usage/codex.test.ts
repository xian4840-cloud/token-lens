import { describe, expect, it } from "vitest";
import { extractCodexIncrements, splitCodexUsage, type CodexUsage } from "./codex";

function usage(partial: Partial<CodexUsage> & { total?: number }): {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
} {
  return {
    input_tokens: partial.input ?? 0,
    cached_input_tokens: partial.cached ?? 0,
    cache_write_input_tokens: partial.cacheWrite ?? 0,
    output_tokens: partial.output ?? 0,
    reasoning_output_tokens: partial.reasoning ?? 0,
    total_tokens: partial.total ?? (partial.input ?? 0) + (partial.output ?? 0),
  };
}

describe("splitCodexUsage", () => {
  it("把 cache 从 input、reasoning 从 output 里拆出来", () => {
    expect(
      splitCodexUsage({
        input: 1000,
        cached: 200,
        cacheWrite: 0,
        output: 500,
        reasoning: 200,
      }),
    ).toEqual({
      input: 800,
      output: 300,
      cacheCreation: 0,
      cacheRead: 200,
      reasoning: 200,
    });
  });
});

describe("extractCodexIncrements", () => {
  it("主会话第一条 last_token_usage 计入，重放且累计不变的跳过", () => {
    const out = extractCodexIncrements([
      {
        type: "session_meta",
        payload: { thread_source: "user" },
      },
      {
        type: "event_msg",
        timestamp: "2026-09-04T00:00:01Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: usage({ input: 100, output: 30, total: 130 }),
            last_token_usage: usage({ input: 100, output: 30, total: 130 }),
          },
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-09-04T00:00:02Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: usage({ input: 100, output: 30, total: 130 }),
            last_token_usage: usage({ input: 100, output: 30, total: 130 }),
          },
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-09-04T00:00:03Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: usage({ input: 300, output: 80, total: 380 }),
            last_token_usage: usage({ input: 200, output: 50, total: 250 }),
          },
        },
      },
    ]);
    expect(out.increments).toHaveLength(2);
    expect(out.increments[0]?.input).toBe(100);
    expect(out.increments[1]?.input).toBe(200);
  });

  it("累计值回退后再次增长，不把历史重新加进去", () => {
    const out = extractCodexIncrements([
      {
        type: "session_meta",
        payload: { thread_source: "user" },
      },
      {
        type: "event_msg",
        timestamp: "2026-09-04T00:00:01Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: usage({ input: 1000, output: 10, total: 1010 }),
            last_token_usage: usage({ input: 1000, output: 10, total: 1010 }),
          },
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-09-04T00:00:02Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: usage({ input: 100, output: 5, total: 105 }),
            last_token_usage: usage({ input: 100, output: 5, total: 105 }),
          },
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-09-04T00:00:03Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: usage({ input: 400, output: 20, total: 420 }),
            last_token_usage: usage({ input: 300, output: 15, total: 315 }),
          },
        },
      },
    ]);
    // 第一轮 1010 + 回退后的新增量 315，不含把 1010 再加一遍
    const sumIn = out.increments.reduce((s, i) => s + i.input, 0);
    expect(sumIn).toBe(1300);
    expect(out.increments).toHaveLength(2);
  });

  it("子代理第一条累计快照只作基线", () => {
    const out = extractCodexIncrements([
      {
        type: "session_meta",
        payload: { thread_source: "subagent" },
      },
      {
        type: "event_msg",
        timestamp: "2026-09-04T00:00:01Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: usage({
              input: 27_000_000,
              output: 10,
              total: 27_000_010,
            }),
            last_token_usage: usage({
              input: 27_000_000,
              output: 10,
              total: 27_000_010,
            }),
          },
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-09-04T00:00:02Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: usage({
              input: 27_000_200,
              output: 40,
              total: 27_000_240,
            }),
            last_token_usage: usage({ input: 200, output: 30, total: 230 }),
          },
        },
      },
    ]);
    expect(out.increments).toHaveLength(1);
    expect(out.increments[0]?.input).toBe(200);
  });

  it("有 token_usage_record 时只认 usage，并按 response_id 去重", () => {
    const rec = (id: string, ts: string, input: number) => ({
      type: "token_usage_record" as const,
      timestamp: ts,
      payload: {
        response_id: id,
        usage: usage({ input, output: 1, total: input + 1 }),
      },
    });
    const out = extractCodexIncrements([
      rec("r1", "2026-09-04T00:00:01Z", 10),
      rec("r1", "2026-09-04T00:00:02Z", 10),
      rec("r2", "2026-09-04T00:00:03Z", 20),
      {
        type: "event_msg",
        timestamp: "2026-09-04T00:00:04Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: usage({ input: 999, output: 1, total: 1000 }),
            last_token_usage: usage({ input: 999, output: 1, total: 1000 }),
          },
        },
      },
    ]);
    expect(out.increments).toHaveLength(2);
    expect(out.increments.map((i) => i.input)).toEqual([10, 20]);
  });
});
