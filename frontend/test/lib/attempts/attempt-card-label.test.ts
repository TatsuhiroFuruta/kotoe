import { afterEach, describe, expect, it, vi } from "vitest";

import { attemptCardLabel } from "@/lib/attempts/attempt-card-label";

const attempt = (description: string, likes = 3) => ({
  user: { name: "taro" },
  description,
  likes_count: likes,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("attemptCardLabel", () => {
  it("見えている順（描写文・名前・いいね数）で並べる（音声操作は見えている言葉で押すため、描写文から始める）", () => {
    expect(attemptCardLabel(attempt("赤い太陽", 5))).toBe("赤い太陽、taro さんの挑戦、いいね 5");
  });

  it("40 文字ちょうどなら切らない", () => {
    const text = "あ".repeat(40);
    expect(attemptCardLabel(attempt(text))).toBe(`${text}、taro さんの挑戦、いいね 3`);
  });

  it("41 文字以上は先頭 40 文字で切って … を付ける", () => {
    const text = "あ".repeat(40) + "い".repeat(960);
    expect(attemptCardLabel(attempt(text))).toBe(`${"あ".repeat(40)}…、taro さんの挑戦、いいね 3`);
  });

  it.each([
    ["サロゲートペアの絵文字", "😀"],
    ["ZWJ でつないだ絵文字", "👨‍👩‍👧"],
    ["肌の色の修飾子つき絵文字", "👍🏽"],
    ["結合文字の濁点", "が"],
  ])("%s を途中で切らない", (_label, unit) => {
    expect(attemptCardLabel(attempt(unit.repeat(41)))).toBe(
      `${unit.repeat(40)}…、taro さんの挑戦、いいね 3`,
    );
  });

  it("連続する空白・改行を 1 つの空白にまとめ、前後を落としてから数える", () => {
    expect(attemptCardLabel(attempt("\n\n  赤い\n\n太陽  \n"))).toBe(
      "赤い 太陽、taro さんの挑戦、いいね 3",
    );
  });

  it("切った位置が空白なら、… の前に空白を残さない", () => {
    const text = "あ".repeat(39) + "\n\n" + "い".repeat(10);
    expect(attemptCardLabel(attempt(text))).toBe(`${"あ".repeat(39)}…、taro さんの挑戦、いいね 3`);
  });

  it("Intl.Segmenter が無いブラウザでも例外にせず、コードポイントで切る", () => {
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    const text = "😀".repeat(41);
    expect(attemptCardLabel(attempt(text))).toBe(`${"😀".repeat(40)}…、taro さんの挑戦、いいね 3`);
  });
});
