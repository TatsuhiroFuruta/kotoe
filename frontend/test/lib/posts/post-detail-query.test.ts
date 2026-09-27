import { describe, expect, it } from "vitest";

import {
  parsePostDetailQuery,
  parsePostId,
  postDetailApiPath,
  postDetailHref,
  type PostDetailQuery,
} from "@/lib/posts/post-detail-query";

/** 組み立てた URL を、Next が searchParams として渡す形（値は文字列）に戻す。 */
function paramsOf(href: string): Record<string, string> {
  return Object.fromEntries(new URL(href, "http://localhost").searchParams);
}

describe("parsePostId", () => {
  it.each([
    ["1", 1],
    ["9", 9],
    ["007", 7],
  ])("%j は %d", (raw, expected) => {
    expect(parsePostId(raw)).toBe(expected);
  });

  it.each(["0", "-1", "1.5", "abc", "", "1e3", "99999999999999999999"])(
    "%j は null（page.tsx が API を呼ばずに notFound() にする）",
    (raw) => {
      expect(parsePostId(raw)).toBeNull();
    },
  );
});

describe("parsePostDetailQuery", () => {
  it("何も無ければ既定値（新着順・1 ページ目）", () => {
    expect(parsePostDetailQuery({})).toEqual({ sort: "recent", page: 1 });
  });

  it("likes だけを再現度順として受け付ける", () => {
    expect(parsePostDetailQuery({ sort: "likes" }).sort).toBe("likes");
  });

  // popular はお題一覧の値。詳細の API は likes 以外をすべて新着順にする（Attempt.listing_for）。
  it.each(["popular", "recent", "LIKES", "", " likes"])("%j は新着順に丸める", (sort) => {
    expect(parsePostDetailQuery({ sort }).sort).toBe("recent");
  });

  it("配列で来たら先頭で判定する", () => {
    expect(parsePostDetailQuery({ sort: ["likes", "recent"], page: ["2", "5"] })).toEqual({
      sort: "likes",
      page: 2,
    });
  });

  it("正の整数でない page は 1 ページ目に丸める", () => {
    expect(parsePostDetailQuery({ page: "abc" }).page).toBe(1);
    expect(parsePostDetailQuery({ page: "3" }).page).toBe(3);
  });
});

describe("postDetailHref", () => {
  it("既定値のパラメータは省く", () => {
    expect(postDetailHref(9)).toBe("/posts/9");
    expect(postDetailHref(9, { sort: "recent", page: 1 })).toBe("/posts/9");
  });

  it("既定値以外だけを載せる", () => {
    expect(postDetailHref(9, { sort: "likes" })).toBe("/posts/9?sort=likes");
    expect(postDetailHref(9, { page: 2 })).toBe("/posts/9?page=2");
  });

  it.each<PostDetailQuery>([
    { sort: "recent", page: 1 },
    { sort: "likes", page: 1 },
    { sort: "recent", page: 3 },
    { sort: "likes", page: 12 },
  ])("組み立てた URL を読み直すと同じ条件に戻る（%o）", (query) => {
    expect(parsePostDetailQuery(paramsOf(postDetailHref(9, query)))).toEqual(query);
  });
});

describe("postDetailApiPath", () => {
  it("再現度順は sort=likes を API に渡す", () => {
    expect(paramsOf(postDetailApiPath(9, { sort: "likes", page: 1 }))).toEqual({ sort: "likes" });
  });

  it("新着順・1 ページ目ならクエリを付けない", () => {
    expect(postDetailApiPath(9, { sort: "recent", page: 1 })).toBe("/api/posts/9");
  });

  it("画面の URL と同じ条件を API に渡す", () => {
    const query: PostDetailQuery = { sort: "likes", page: 2 };
    expect(paramsOf(postDetailApiPath(9, query))).toEqual(paramsOf(postDetailHref(9, query)));
  });
});
