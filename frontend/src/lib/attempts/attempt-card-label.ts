/**
 * 挑戦カード（リンク）の読み上げ名。
 *
 * カードは <article> ごと <Link> で包んでいるので、何も付けないとリンクの名前が中身すべて
 * （描写文は最大 1,000 文字）になる。line-clamp は見た目を切るだけで、読み上げは切らない。
 *
 * 並びはカードに見えている順（描写文 → 名前 → いいね数）にする。音声操作は見えている言葉で
 * リンクを押すので、名前は見えている文字列から始める（WCAG 2.5.3 Label in Name）。
 * いいね数は表彰台の順位の根拠なので落とさない。
 */

import type { Attempt } from "@/types/api";

/** 描写文の長さ（書記素の数）。同じ人のカードを区別できれば足りる。 */
const EXCERPT_LENGTH = 40;

/**
 * 書記素（見た目の 1 文字）で数えて切る。コードポイントで切ると、ZWJ でつないだ絵文字や
 * 肌の色の修飾子、結合文字の濁点を途中で切ってしまう。
 */
function excerptOf(text: string): string {
  // 改行や連続する空白で文字数を使い切らないよう、先に 1 つの空白へまとめる。
  const normalized = text.replace(/\s+/g, " ").trim();
  const segments = Array.from(
    new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(normalized),
    ({ segment }) => segment,
  );
  return segments.length > EXCERPT_LENGTH
    ? `${segments.slice(0, EXCERPT_LENGTH).join("")}…`
    : normalized;
}

export function attemptCardLabel(attempt: {
  user: Pick<Attempt["user"], "name">;
  description: Attempt["description"];
  likes_count: Attempt["likes_count"];
}): string {
  const { name } = attempt.user;
  return `${excerptOf(attempt.description)}（${name} さんの挑戦、いいね ${attempt.likes_count}）`;
}
