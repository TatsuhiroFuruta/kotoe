/**
 * URL（searchParams と動的セグメント）から来る値の共通の読み方。
 *
 * お題一覧（posts-query.ts）とお題詳細（post-detail-query.ts）で同じ規則を使う。
 * 片方にだけ書くと、ページ番号の受け付け方を片方だけ直したときに
 * 「一覧では 1 ページ目に丸まる値が、詳細では別のページを指す」ずれが起きる。
 */

/** Next の page.tsx が受け取る searchParams の値の形。 */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** ?sort=a&sort=b のように同じキーが重なると配列で来る。先頭を採る。 */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 正の整数の文字列だけを数値にする。それ以外は null（呼び出し側が既定値に倒す）。
 *
 * Number() や parseInt() に任せない。Number("1e3") は 1000、parseInt("2.5") は 2 に
 * なり、書いていないページやお題へ黙って飛ぶ。数字だけの文字列に限る。
 * 安全な整数を超えると精度が落ちて別の値になるので、それも null にする。
 * 上限（ページの MAX_PAGE など）はサーバーが丸めるので、ここでは見ない。
 */
export function parsePositiveInt(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}
