import { describe, expect, it } from "vitest";

import { avatarInitial } from "@/lib/users/avatar-initial";

describe("avatarInitial", () => {
  it.each([
    ["山田", "山"],
    ["alice", "A"],
    ["  bob", "B"],
    ["😀smile", "😀"], // サロゲートペアを割らない
    ["", "?"],
    ["   ", "?"],
  ])("%j → %j", (name, initial) => {
    expect(avatarInitial(name)).toBe(initial);
  });
});
