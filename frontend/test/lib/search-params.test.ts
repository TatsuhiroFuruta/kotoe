import { describe, expect, it } from "vitest";

import { firstParam, parsePositiveInt } from "@/lib/search-params";

describe("firstParam", () => {
  it("文字列はそのまま返す", () => {
    expect(firstParam("a")).toBe("a");
  });

  it("?k=a&k=b のように配列で来たら先頭を返す", () => {
    expect(firstParam(["a", "b"])).toBe("a");
  });

  it("未指定なら undefined", () => {
    expect(firstParam(undefined)).toBeUndefined();
  });
});

describe("parsePositiveInt", () => {
  it.each([
    ["1", 1],
    ["3", 3],
    ["007", 7],
  ])("%j は %d", (raw, expected) => {
    expect(parsePositiveInt(raw)).toBe(expected);
  });

  // Number() や parseInt() に任せると "1e3" は 1000、"2.5" は 2 になり、書いていない値へ黙って飛ぶ。
  it.each(["0", "-1", "abc", "2.5", "", "1e3", " 2", "0x10", "+1"])("%j は null", (raw) => {
    expect(parsePositiveInt(raw)).toBeNull();
  });

  it("未指定なら null", () => {
    expect(parsePositiveInt(undefined)).toBeNull();
  });

  it("安全な整数を超える値は null（精度が落ちて別の値を指すため）", () => {
    expect(parsePositiveInt("99999999999999999999")).toBeNull();
  });
});
