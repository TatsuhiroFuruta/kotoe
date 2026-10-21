import { describe, expect, it } from "vitest";

import { avatarInitial } from "@/lib/users/avatar-initial";

describe("avatarInitial", () => {
  it.each([
    ["山田", "山"],
    ["alice", "A"],
    ["  bob", "B"],
    ["😀smile", "😀"], // サロゲートペアを割らない
    ["👍🏽taro", "👍🏽"], // 肌の色の修飾子を割らない
    ["👨‍👩‍👧家族", "👨‍👩‍👧"], // ZWJ でつないだ絵文字を割らない
    ["\u304b\u3099な", "\u304b\u3099"], // 結合文字の濁点を割らない
    ["ßen", "ß"], // 大文字にすると SS の 2 文字になるので、そのまま
    ["", "?"],
    ["   ", "?"],
  ])("%j → %j", (name, initial) => {
    expect(avatarInitial(name)).toBe(initial);
  });
});
