/**
 * お題一覧の検索条件（q / sort / page）と URL の相互変換。
 *
 * 画面の URL（/posts?…）と API のパス（/api/posts?…）を同じ関数から作る。
 * 別々に組み立てると、並び替えの値を片方だけ変えたときに「画面は人気順と
 * 表示しているのに新着順が返る」ずれが起きるため。
 *
 * React も fetch も知らない純粋関数にしてあるので Vitest で検査できる。
 */

export type PostsSort = "recent" | "popular";

export type PostsQuery = { q: string; sort: PostsSort; page: number };

/** Next の page.tsx が受け取る searchParams の値の形。 */
export type RawSearchParams = Record<string, string | string[] | undefined>;

const DEFAULT_QUERY: PostsQuery = { q: "", sort: "recent", page: 1 };

/** ?sort=a&sort=b のように同じキーが重なると配列で来る。先頭を採る。 */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * URL から来る任意の値を正規化する。どんな入力でも例外を投げない
 * （URL は誰でも書けるので、壊れた値で画面ごと落とさない）。
 */
export function parsePostsQuery(params: RawSearchParams): PostsQuery {
  // String.prototype.trim は全角空白（U+3000）も落とす。
  const q = (first(params.q) ?? "").trim();

  // API も popular 以外はすべて新着順に扱う（Post.listing）。ここで同じ丸め方を
  // しておくと、並び替えトグルの「現在地」表示が API の実際の並びと一致する。
  const sort: PostsSort = first(params.sort) === "popular" ? "popular" : "recent";

  // Number() や parseInt() に任せない。Number("1e3") は 1000、parseInt("2.5") は 2 に
  // なり、書いていないページへ黙って飛ぶ。数字だけの文字列に限る。
  // 上限はサーバー（Paginating::MAX_PAGE）が丸めるので、ここでは見ない。
  // ただし安全な整数を超えると精度が落ちて別の値になるので、それは 1 に戻す。
  const rawPage = first(params.page) ?? "";
  const parsed = /^\d+$/.test(rawPage) ? Number(rawPage) : NaN;
  const page = Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_QUERY.page;

  return { q, sort, page };
}

/** 既定値のパラメータを省いたクエリ文字列。/posts?page=1&sort=recent ではなく /posts にする。 */
function toSearch({ q, sort, page }: PostsQuery): string {
  const params = new URLSearchParams();
  if (q !== DEFAULT_QUERY.q) params.set("q", q);
  if (sort !== DEFAULT_QUERY.sort) params.set("sort", sort);
  if (page !== DEFAULT_QUERY.page) params.set("page", String(page));

  const search = params.toString();
  return search ? `?${search}` : "";
}

/** 画面の URL。省いた項目は既定値（検索なし・新着順・1 ページ目）になる。 */
export function postsHref(query: Partial<PostsQuery> = {}): string {
  return `/posts${toSearch({ ...DEFAULT_QUERY, ...query })}`;
}

/** API のパス。画面の URL と同じ規則で組み立てる。 */
export function postsApiPath(query: PostsQuery): string {
  return `/api/posts${toSearch(query)}`;
}
