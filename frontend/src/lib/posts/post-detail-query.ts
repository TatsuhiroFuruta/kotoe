/**
 * お題詳細の URL（/posts/[id]?sort=&page=）と API のパスの相互変換。
 *
 * posts-query.ts と同じく、画面の URL と API のパスを同じ関数から作る。
 * 別々に組み立てると「画面は再現度順と表示しているのに新着順が返る」ずれが起きる。
 *
 * 並び替えの値は一覧（popular）と違い likes。API（Attempt.listing_for）と
 * docs/screen_and_api_design.md がそう定義している。
 */

import { firstParam, parsePositiveInt, type RawSearchParams } from "@/lib/search-params";

export type AttemptsSort = "recent" | "likes";

export type PostDetailQuery = { sort: AttemptsSort; page: number };

const DEFAULT_QUERY: PostDetailQuery = { sort: "recent", page: 1 };

/**
 * URL の [id]。正の安全な整数の文字列だけを受け付ける。
 * それ以外は null を返し、page.tsx が API を呼ばずに notFound() にする。
 * "007" は 7 として受け付ける（API も 7 として扱うので、正規化の URL へは飛ばさない）。
 */
export function parsePostId(raw: string): number | null {
  return parsePositiveInt(raw);
}

/** URL から来る任意の値を正規化する。どんな入力でも例外を投げない。 */
export function parsePostDetailQuery(params: RawSearchParams): PostDetailQuery {
  const sort: AttemptsSort = firstParam(params.sort) === "likes" ? "likes" : "recent";
  const page = parsePositiveInt(firstParam(params.page)) ?? DEFAULT_QUERY.page;

  return { sort, page };
}

/** 既定値のパラメータを省いたクエリ文字列。/posts/9?page=1&sort=recent ではなく /posts/9 にする。 */
function toSearch({ sort, page }: PostDetailQuery): string {
  const params = new URLSearchParams();
  if (sort !== DEFAULT_QUERY.sort) params.set("sort", sort);
  if (page !== DEFAULT_QUERY.page) params.set("page", String(page));

  const search = params.toString();
  return search ? `?${search}` : "";
}

/** 画面の URL。省いた項目は既定値（新着順・1 ページ目）になる。 */
export function postDetailHref(id: number, query: Partial<PostDetailQuery> = {}): string {
  return `/posts/${id}${toSearch({ ...DEFAULT_QUERY, ...query })}`;
}

/** みんなの挑戦の見出し（AttemptList）の id。断片の行き先。 */
export const ATTEMPTS_HEADING_ID = "attempts-heading";

/**
 * みんなの挑戦の並び替え・ページ送り用の URL。見出しへの断片を付ける。
 *
 * 断片が無いと、Next はクエリの変わったページの先頭へスクロールするので、
 * 押すたびに高さ 70vh のヒーローと表彰台（7-3c 以降は描写フォームも）の上まで
 * 戻されてしまう。見出しは再取得中もアンマウントされないので、行き先として使える。
 */
export function attemptsSectionHref(id: number, query: Partial<PostDetailQuery>): string {
  return `${postDetailHref(id, query)}#${ATTEMPTS_HEADING_ID}`;
}

/** API のパス。画面の URL と同じ規則で組み立てる。 */
export function postDetailApiPath(id: number, query: PostDetailQuery): string {
  return `/api/posts/${id}${toSearch(query)}`;
}
