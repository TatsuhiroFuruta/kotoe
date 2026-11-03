import { describe, expect, it } from "vitest";

import { extractUpdatedPost, replacePostInList } from "@/lib/mypage/replace-post-in-list";
import type { PostSummary, PostsIndexResponse } from "@/types/api";

function post(id: number, title: string | null): PostSummary {
  return {
    id,
    title,
    image_public_id: `kotoe/post_${id}`,
    user: { id: 1, name: "テスト" },
    attempts_count: 0,
    likes_count: 0,
    favorited: false,
    created_at: "2026-11-03T00:00:00Z",
  };
}

function listOf(...posts: PostSummary[]): PostsIndexResponse {
  return { posts, meta: { current_page: 1, total_pages: 1, total_count: posts.length } };
}

describe("replacePostInList", () => {
  it("id が一致するお題だけを応答の内容に置き換える", () => {
    const list = listOf(post(1, "一"), post(2, "二"), post(3, "三"));
    const updated = post(2, "新しい二");

    const next = replacePostInList(list, updated);

    expect(next.posts.map((p) => p.title)).toEqual(["一", "新しい二", "三"]);
    expect(next.posts[1]).toBe(updated);
  });

  it("一致しないお題は同じ参照のまま", () => {
    const list = listOf(post(1, "一"), post(2, "二"), post(3, "三"));

    const next = replacePostInList(list, post(2, "新しい二"));

    expect(next.posts[0]).toBe(list.posts[0]);
    expect(next.posts[2]).toBe(list.posts[2]);
  });

  it("元の一覧は書き換えない", () => {
    const list = listOf(post(1, "一"), post(2, "二"));

    replacePostInList(list, post(2, "新しい二"));

    expect(list.posts[1].title).toBe("二");
  });

  it("一致する id が無ければ中身は変わらない", () => {
    const list = listOf(post(1, "一"), post(2, "二"));

    const next = replacePostInList(list, post(99, "無関係"));

    expect(next.posts).toEqual(list.posts);
    next.posts.forEach((p, i) => expect(p).toBe(list.posts[i]));
  });

  it("meta は変わらない（件数・ページは置き換えでは動かない）", () => {
    const list = listOf(post(1, "一"), post(2, "二"));

    const next = replacePostInList(list, post(1, "新しい一"));

    expect(next.meta).toBe(list.meta);
  });
});

describe("extractUpdatedPost", () => {
  it("post を持つ応答からお題を取り出す", () => {
    const updated = post(2, "新");
    expect(extractUpdatedPost({ post: updated })).toBe(updated);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["空オブジェクト", {}],
    ["post が null", { post: null }],
    ["post が文字列", { post: "x" }],
    ["post に id が無い", { post: { title: "新" } }],
    ["id が数値でない", { post: { id: "2" } }],
    ["形が違う（配列）", []],
  ])("%s なら null", (_label, response) => {
    expect(extractUpdatedPost(response)).toBeNull();
  });
});
