import { afterEach, describe, expect, it, vi } from "vitest";

import { attemptCardLabel, myAttemptCardLabel } from "@/lib/attempts/attempt-card-label";

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

  it("Intl.Segmenter が無いブラウザでも例外にせず、コードポイントで数える", () => {
    // Intl のプロパティは列挙できないので、スプレッドでは写せない。Segmenter だけを隠す。
    vi.stubGlobal("Intl", Object.assign(Object.create(Intl), { Segmenter: undefined }));
    // 👍🏽 は 2 コードポイントで 1 書記素。21 個は書記素なら 21 文字（切らない）、
    // コードポイントなら 42 文字（40 で切る）になり、どちらの経路を通ったかが分かる。
    const text = "👍🏽".repeat(21);
    expect(attemptCardLabel(attempt(text))).toBe(`${"👍🏽".repeat(20)}…、taro さんの挑戦、いいね 3`);
  });
});

describe("myAttemptCardLabel", () => {
  const mine = (title: string | null) => ({
    user: { name: "taro" },
    description: "赤い太陽",
    likes_count: 5,
    post: { id: 1, title, image_public_id: null, discarded: false },
  });

  it("描写文・お題・いいね数の順で並べ、見えていない自分の名前は含めない", () => {
    const label = myAttemptCardLabel(mine("夕焼けの海"));
    expect(label).toBe("赤い太陽、お題：夕焼けの海、いいね 5");
    expect(label).not.toContain("taro");
  });

  it("お題の題名が null のときは null と読ませず、お題の部分を省く", () => {
    expect(myAttemptCardLabel(mine(null))).toBe("赤い太陽、いいね 5");
  });
});
