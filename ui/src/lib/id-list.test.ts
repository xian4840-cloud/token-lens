import { describe, expect, it } from "vitest";
import { parseIdList, sortPinnedFirst, toggleId } from "./id-list";

describe("parseIdList", () => {
  it("空值与非法 JSON 当成空列表，不抛", () => {
    expect(parseIdList(undefined)).toEqual([]);
    expect(parseIdList("")).toEqual([]);
    expect(parseIdList("not-json")).toEqual([]);
    expect(parseIdList("{}")).toEqual([]);
    expect(parseIdList("[1,2]")).toEqual([]);
  });

  it("只留非空字符串，去重、截断过长 id，不把脏数据原样用", () => {
    expect(parseIdList('["a","a","  b  ",""]')).toEqual(["a", "b"]);
    expect(parseIdList(`["${"x".repeat(81)}","ok"]`)).toEqual(["ok"]);
  });
});

describe("sortPinnedFirst", () => {
  it("置顶按列表顺序排在最前，其余保持原序", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(sortPinnedFirst(items, ["c", "a"]).map((x) => x.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("没有置顶时不改顺序", () => {
    const items = [{ id: "a" }, { id: "b" }];
    expect(sortPinnedFirst(items, [])).toBe(items);
  });
});

describe("toggleId", () => {
  it("没有则追加，有则去掉", () => {
    expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
  });
});
