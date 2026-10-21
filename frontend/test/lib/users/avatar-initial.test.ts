import { afterEach, describe, expect, it, vi } from "vitest";

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
    ["\u200bbob", "B"], // 幅ゼロの空白は飛ばして最初の文字を取る
    ["\u3099abc", "A"], // 単独の濁点（結合文字）は飛ばす
    ["\u200b", "?"], // 文字が 1 つも無ければ ?
    ["!!!", "!"], // 句読点も見える文字なので頭文字になる
    ["☆☆☆", "☆"], // 記号だけの名前も ? にしない
    ["♪", "♪"],
    ["★ミク", "★"],
    ["♡ミク", "♡"],
    ["\u{1F1EF}\u{1F1F5}taro", "\u{1F1EF}\u{1F1F5}"], // 国旗（地域指示記号 2 つ）
    ["\u{1F1EF}\u{1F1F5}", "\u{1F1EF}\u{1F1F5}"],
    ["#\uFE0F\u20E3team", "#\uFE0F\u20E3"], // キーキャップ
  ])("%j → %j", (name, initial) => {
    expect(avatarInitial(name)).toBe(initial);
  });
});

describe("avatarInitial（Intl.Segmenter が無いブラウザ）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("例外にせず、コードポイントで頭文字を取る", () => {
    vi.stubGlobal("Intl", Object.assign(Object.create(Intl), { Segmenter: undefined }));
    // か + 濁点 は書記素なら 2 コードポイントで 1 文字、コードポイントなら か だけになり、
    // どちらの経路を通ったかが分かる。
    expect(avatarInitial("\u304b\u3099な")).toBe("\u304b");
    expect(avatarInitial("\u200bbob")).toBe("B");
    expect(avatarInitial("")).toBe("?");
  });
});
