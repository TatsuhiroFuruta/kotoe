import { describe, expect, it } from "vitest";

import {
  parsePostsQuery,
  postsApiPath,
  postsHref,
  type PostsQuery,
} from "@/lib/posts/posts-query";

/** 組み立てた URL を、Next が searchParams として渡す形（値は文字列）に戻す。 */
function paramsOf(href: string): Record<string, string> {
  return Object.fromEntries(new URL(href, "http://localhost").searchParams);
}

describe("parsePostsQuery", () => {
  it("何も無ければ既定値（検索なし・新着順・1 ページ目）", () => {
    expect(parsePostsQuery({})).toEqual({ q: "", sort: "recent", page: 1 });
  });

  describe("sort", () => {
    it("popular だけを人気順として受け付ける", () => {
      expect(parsePostsQuery({ sort: "popular" }).sort).toBe("popular");
    });

    it.each(["recent", "likes", "POPULAR", "", " popular"])(
      "%j は新着順に丸める（API も popular 以外は新着順にする）",
      (sort) => {
        expect(parsePostsQuery({ sort }).sort).toBe("recent");
      },
    );

    it("?sort=a&sort=b のように配列で来たら先頭で判定する", () => {
      expect(parsePostsQuery({ sort: ["popular", "recent"] }).sort).toBe("popular");
      expect(parsePostsQuery({ sort: ["likes", "popular"] }).sort).toBe("recent");
    });
  });

  describe("page", () => {
    it("正の整数の文字列はそのまま使う", () => {
      expect(parsePostsQuery({ page: "3" }).page).toBe(3);
    });

    it.each(["0", "-1", "abc", "2.5", "", "1e3", " 2", "0x10"])(
      "%j は 1 ページ目に丸める",
      (page) => {
        expect(parsePostsQuery({ page }).page).toBe(1);
      },
    );

    it("安全な整数を超える値は 1 ページ目に丸める（精度が落ちて別のページを指すため）", () => {
      expect(parsePostsQuery({ page: "99999999999999999999" }).page).toBe(1);
    });

    it("配列で来たら先頭で判定する", () => {
      expect(parsePostsQuery({ page: ["2", "5"] }).page).toBe(2);
    });
  });

  describe("q", () => {
    it("前後の空白を落とす（全角空白も）", () => {
      expect(parsePostsQuery({ q: "  猫　" }).q).toBe("猫");
    });

    it("空白だけなら検索なしと同じ", () => {
      expect(parsePostsQuery({ q: "   " }).q).toBe("");
    });

    it("配列で来たら先頭を使う", () => {
      expect(parsePostsQuery({ q: ["猫", "犬"] }).q).toBe("猫");
    });
  });
});

describe("postsHref", () => {
  it("既定値のパラメータは省く", () => {
    expect(postsHref()).toBe("/posts");
    expect(postsHref({ q: "", sort: "recent", page: 1 })).toBe("/posts");
  });

  it("既定値以外だけを載せる", () => {
    expect(paramsOf(postsHref({ sort: "popular", page: 2 }))).toEqual({
      sort: "popular",
      page: "2",
    });
  });

  it.each(["猫 と 犬", "a&b=c", "#1", "100%", "C++", "?q=x"])(
    "検索語 %j は往復しても同じ語に戻る",
    (q) => {
      const query: PostsQuery = { q, sort: "popular", page: 3 };

      expect(parsePostsQuery(paramsOf(postsHref(query)))).toEqual(query);
    },
  );
});

describe("postsApiPath", () => {
  it("人気順は sort=popular を API に渡す", () => {
    // 並びの正しさは API（6-1 の request spec）の責務。フロントの責務は
    // popular を渡すことなので、ここが抜けると画面は「人気順」と表示したまま
    // 新着順が返る。
    expect(paramsOf(postsApiPath({ q: "", sort: "popular", page: 1 }))).toEqual({
      sort: "popular",
    });
  });

  it("新着順・1 ページ目・検索なしならクエリを付けない", () => {
    expect(postsApiPath({ q: "", sort: "recent", page: 1 })).toBe("/api/posts");
  });

  it("画面の URL と同じ条件を API に渡す", () => {
    const query: PostsQuery = { q: "猫", sort: "popular", page: 2 };

    expect(paramsOf(postsApiPath(query))).toEqual(paramsOf(postsHref(query)));
    expect(postsApiPath(query).startsWith("/api/posts?")).toBe(true);
  });
});
