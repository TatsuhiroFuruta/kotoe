import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/auth/safe-next-path";

describe("safeNextPath", () => {
  it("自サイト内の絶対パスはそのまま通す", () => {
    expect(safeNextPath("/mypage")).toBe("/mypage");
    expect(safeNextPath("/posts/1?sort=likes")).toBe("/posts/1?sort=likes");
  });

  // Next.js のドキュメントいわく、未検証の URL を router.replace に渡すと
  // javascript: がページのコンテキストで実行される。
  it("javascript: スキームは / に落とす", () => {
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
  });

  it("外部オリジンへの絶対 URL は / に落とす", () => {
    expect(safeNextPath("https://evil.example/steal")).toBe("/");
  });

  // 「/」で始まるが別オリジンへ飛ぶ2つの形。ここを見落とすと
  // ホワイトリストが素通しになる。
  it("protocol-relative な //host は / に落とす", () => {
    expect(safeNextPath("//evil.example")).toBe("/");
  });

  it("バックスラッシュの /\\host は / に落とす", () => {
    expect(safeNextPath("/\\evil.example")).toBe("/");
  });

  it("未指定・空文字は / を返す", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });
});
