import { describe, expect, it } from "vitest";

import {
  MYPAGE_TABS,
  mypageApiPath,
  mypageHref,
  parseMypageQuery,
  type MypageQuery,
} from "@/lib/mypage/mypage-query";

/** 組み立てた URL を、Next が searchParams として渡す形（値は文字列）に戻す。 */
function paramsOf(href: string): Record<string, string> {
  return Object.fromEntries(new URL(href, "http://localhost").searchParams);
}

describe("parseMypageQuery", () => {
  it("何も無ければ投稿したお題の 1 ページ目", () => {
    expect(parseMypageQuery({})).toEqual({ tab: "posts", page: 1 });
  });
  it.each(["posts", "attempts", "drafts", "favorites"])("%j はそのまま受け付ける", (tab) => {
    expect(parseMypageQuery({ tab }).tab).toBe(tab);
  });
  it.each(["DRAFTS", "draft", "", " drafts", "likes"])("%j は posts に丸める", (tab) => {
    expect(parseMypageQuery({ tab }).tab).toBe("posts");
  });
  it("配列で来たら先頭で判定する", () => {
    expect(parseMypageQuery({ tab: ["drafts", "posts"] }).tab).toBe("drafts");
  });
  it.each(["0", "-1", "1.5", "abc", ""])("page=%j は 1 に丸める", (page) => {
    expect(parseMypageQuery({ page }).page).toBe(1);
  });
  it("正の整数の page はそのまま使う", () => {
    expect(parseMypageQuery({ tab: "favorites", page: "3" })).toEqual({
      tab: "favorites",
      page: 3,
    });
  });
});

describe("mypageHref", () => {
  it("既定値は省く", () => {
    expect(mypageHref()).toBe("/mypage");
    expect(mypageHref({ tab: "posts", page: 1 })).toBe("/mypage");
  });
  it("タブだけ渡すと 1 ページ目（タブの切り替えでページを引き継がない）", () => {
    expect(mypageHref({ tab: "drafts" })).toBe("/mypage?tab=drafts");
  });
  it("タブとページ", () => {
    expect(paramsOf(mypageHref({ tab: "attempts", page: 2 }))).toEqual({
      tab: "attempts",
      page: "2",
    });
  });
  it("組み立てた URL を parse すると元に戻る", () => {
    const query: MypageQuery = { tab: "favorites", page: 4 };
    expect(parseMypageQuery(paramsOf(mypageHref(query)))).toEqual(query);
  });
});

describe("mypageApiPath", () => {
  it.each([
    [{ tab: "posts", page: 1 }, "/api/me/posts"],
    [{ tab: "attempts", page: 1 }, "/api/me/attempts"],
    [{ tab: "drafts", page: 2 }, "/api/me/drafts?page=2"],
    [{ tab: "favorites", page: 3 }, "/api/me/favorites?page=3"],
  ] as const)("%j → %s（tab はクエリに載せない）", (query, path) => {
    expect(mypageApiPath(query)).toBe(path);
  });
});

describe("MYPAGE_TABS", () => {
  it("表示順はデザインブリーフどおり", () => {
    expect(MYPAGE_TABS.map(({ tab }) => tab)).toEqual([
      "posts",
      "attempts",
      "drafts",
      "favorites",
    ]);
  });
});
