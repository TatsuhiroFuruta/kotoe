import { describe, expect, it } from "vitest";

import { attemptDetailHref, parseAttemptId } from "@/lib/attempts/attempt-detail-query";

describe("parseAttemptId", () => {
  it.each([
    ["1", 1],
    ["9", 9],
    ["007", 7],
  ])("%j は %d", (raw, expected) => {
    expect(parseAttemptId(raw)).toBe(expected);
  });

  it.each(["0", "-1", "1.5", "abc", "", "1e3", "99999999999999999999"])("%j は null", (raw) => {
    expect(parseAttemptId(raw)).toBeNull();
  });
});

describe("attemptDetailHref", () => {
  it("挑戦詳細のパスを返す", () => {
    expect(attemptDetailHref(12)).toBe("/attempts/12");
  });
});
