/**
 * マイページのタブとページ（tab / page）と、URL・API パスの相互変換。
 *
 * 画面の URL（/mypage?tab=…）と API のパス（/api/me/<tab>）を同じモジュールから作る。
 * 別々に組み立てると、タブを足したときに「画面にはタブがあるのに API のパスが
 * 無い」ずれが起きるため。画面ではタブをクエリで持つが、API ではパスの一部になる
 * ので、tab はクエリに載せない。
 *
 * React も fetch も知らない純粋関数にしてあるので Vitest で検査できる。
 */

import { firstParam, parsePositiveInt, type RawSearchParams } from "@/lib/search-params";

export type MypageTab = "posts" | "attempts" | "drafts" | "favorites";

/** 表示順と見出し。タブの判定もこの値との完全一致で行う。 */
export const MYPAGE_TABS: readonly { tab: MypageTab; label: string }[] = [
  { tab: "posts", label: "投稿したお題" },
  { tab: "attempts", label: "自分の挑戦" },
  { tab: "drafts", label: "下書き" },
  { tab: "favorites", label: "お気に入り" },
];

export type MypageQuery = { tab: MypageTab; page: number };

const DEFAULT_QUERY: MypageQuery = { tab: "posts", page: 1 };

/**
 * URL から来る任意の値を正規化する。どんな入力でも例外を投げない
 * （URL は誰でも書けるので、壊れた値で画面ごと落とさない）。
 */
export function parseMypageQuery(params: RawSearchParams): MypageQuery {
  const raw = firstParam(params.tab);
  const tab = MYPAGE_TABS.find((entry) => entry.tab === raw)?.tab ?? DEFAULT_QUERY.tab;
  const page = parsePositiveInt(firstParam(params.page)) ?? DEFAULT_QUERY.page;

  return { tab, page };
}

/** 既定値のパラメータを省いたクエリ文字列。 */
function toSearch({ tab, page }: MypageQuery): string {
  const params = new URLSearchParams();
  if (tab !== DEFAULT_QUERY.tab) params.set("tab", tab);
  if (page !== DEFAULT_QUERY.page) params.set("page", String(page));

  const search = params.toString();
  return search ? `?${search}` : "";
}

/**
 * 画面の URL。省いた項目は既定値（投稿したお題・1 ページ目）になる。
 * タブだけ渡せば 1 ページ目になり、タブの切り替えでページ番号を引き継がない。
 */
export function mypageHref(query: Partial<MypageQuery> = {}): string {
  return `/mypage${toSearch({ ...DEFAULT_QUERY, ...query })}`;
}

/** API のパス。tab はパスにだけ入れ、クエリには page だけを載せる。 */
export function mypageApiPath({ tab, page }: MypageQuery): string {
  return `/api/me/${tab}${toSearch({ tab: DEFAULT_QUERY.tab, page })}`;
}
