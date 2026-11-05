import { describe, expect, it } from "vitest";

import { postImageAlt, postTitleText } from "@/lib/posts/post-title";

describe("postTitleText", () => {
  it("タイトルがあればそのまま返す", () => {
    expect(postTitleText("夕暮れ")).toBe("夕暮れ");
  });

  it("null（無題）なら「無題」を返す", () => {
    expect(postTitleText(null)).toBe("無題");
  });
});

describe("postImageAlt", () => {
  it("タイトルがあればそのまま返す", () => {
    expect(postImageAlt("夕暮れ")).toBe("夕暮れ");
  });

  it("null（無題）なら「お題の画像」を返す", () => {
    expect(postImageAlt(null)).toBe("お題の画像");
  });
});
