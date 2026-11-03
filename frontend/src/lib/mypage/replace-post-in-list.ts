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
