/**
 * お題一覧のうち、id が一致する 1 件だけを PATCH の応答で置き換える（3-3 のタイトル編集）。
 *
 * 一覧を取り直すとスケルトンに入れ替わり、「タイトルを編集」ボタンと <dialog> が DOM から
 * 外れてフォーカスの戻り先が無くなる。その場で置き換えれば、ボタンは同じ要素のまま残る。
 * 件数・ページは変わらないので meta はそのまま渡す。他のお題は同じ参照のまま返す。
 */

import type { PostSummary, PostsIndexResponse } from "@/types/api";

export function replacePostInList(list: PostsIndexResponse, post: PostSummary): PostsIndexResponse {
  return {
    ...list,
    posts: list.posts.map((current) => (current.id === post.id ? post : current)),
  };
}

/**
 * PATCH の応答から更新後のお題を取り出す。取り出せない（空・形が違う）ときは null。
 * null のときは置き換えの代わりに一覧を取り直す。replacePostInList は id で突き合わせるので、
 * 数値の id を持つオブジェクトだけを受け入れる。
 */
export function extractUpdatedPost(response: unknown): PostSummary | null {
  if (typeof response !== "object" || response === null || !("post" in response)) return null;
  const { post } = response;
  if (typeof post !== "object" || post === null || !("id" in post)) return null;
  if (typeof post.id !== "number") return null;
  // id の存在と型は確かめた。残りの項目の形まではここで検査しない（サーバーが正）。
  return post as PostSummary;
}
