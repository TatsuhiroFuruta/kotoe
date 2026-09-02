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

  // URL パーサは解析の前に ASCII のタブ・LF・CR を取り除く。そのため
  // "/\t/evil.example" は "//evil.example" として解釈され、別オリジンへ飛ぶ。
  // ?next=%2F%09%2Fevil.example がデコードされるとこの形になるので、
  // 「// で始まるか」だけを見ていると素通りする。
  it("タブ・改行を挟んで // を隠した形も / に落とす", () => {
    expect(safeNextPath("/\t/evil.example")).toBe("/");
    expect(safeNextPath("/\n/evil.example")).toBe("/");
    expect(safeNextPath("/\r/evil.example")).toBe("/");
    expect(safeNextPath("/\r\\evil.example")).toBe("/");
    expect(safeNextPath("/\t\\/evil.example")).toBe("/");
  });

  it("パスの途中のタブ・改行は取り除いたうえで通す", () => {
    expect(safeNextPath("/my\tpage")).toBe("/mypage");
  });

  it("未指定・空文字は / を返す", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });
});
