import { describe, expect, it } from "vitest";

import { attemptCardLabel } from "@/lib/attempts/attempt-card-label";

const attempt = (name: string, description: string) => ({ user: { name }, description });

describe("attemptCardLabel", () => {
  it("名前と描写文を並べる", () => {
    expect(attemptCardLabel(attempt("taro", "赤い太陽"))).toBe("taro さんの挑戦：赤い太陽");
  });

  it("40 文字ちょうどなら切らない", () => {
    const text = "あ".repeat(40);
    expect(attemptCardLabel(attempt("taro", text))).toBe(`taro さんの挑戦：${text}`);
  });

  it("41 文字以上は先頭 40 文字で切って … を付ける", () => {
    const text = "あ".repeat(40) + "い".repeat(960);
    expect(attemptCardLabel(attempt("taro", text))).toBe(`taro さんの挑戦：${"あ".repeat(40)}…`);
  });

  it("絵文字（サロゲートペア）を途中で切らない", () => {
    const text = "😀".repeat(41);
    expect(attemptCardLabel(attempt("taro", text))).toBe(`taro さんの挑戦：${"😀".repeat(40)}…`);
  });
});
