/**
 * 挑戦カード（リンク）の読み上げ名。
 *
 * カードは <article> ごと <Link> で包んでいるので、何も付けないとリンクの名前が中身すべて
 * （描写文は最大 1,000 文字）になる。line-clamp は見た目を切るだけで、読み上げは切らない。
 *
 * 並びはカードに見えている順（描写文 → 名前 → いいね数）にする。音声操作は見えている言葉で
 * リンクを押すので、名前は見えている文字列から始める（WCAG 2.5.3 Label in Name）。
 * いいね数はカードに見えている情報で、表彰台・再現度順の並びを決める値なので落とさない。
 * 区切りは「、」にする（括弧は読み上げの設定によって「かっこ」と読まれる）。
 */

import type { Attempt } from "@/types/api";

/** 描写文の長さ（書記素の数）。同じ人のカードを区別できれば足りる。 */
const EXCERPT_LENGTH = 40;

/**
 * 文字を先頭から 1 つずつ返す。書記素（見た目の 1 文字）で数えるのは、コードポイントで切ると
 * ZWJ でつないだ絵文字や肌の色の修飾子、結合文字の濁点を途中で切ってしまうため。
 *
 * Intl.Segmenter は Firefox では 125 から。無い環境で例外にすると挑戦の一覧ごと描画できなく
 * なるので、そのときはコードポイントで数える（読み上げ名の末尾が少し崩れるだけで済む）。
 */
function charactersOf(text: string): Iterable<string> {
  if (typeof Intl.Segmenter !== "function") return text;
  const segments = new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text);
  return (function* () {
    for (const { segment } of segments) yield segment;
  })();
}

function excerptOf(text: string): string {
  // 改行や連続する空白で文字数を使い切らないよう、先に 1 つの空白へまとめる。
  const normalized = text.replace(/\s+/g, " ").trim();

  // 41 文字目で打ち切る（1,000 文字を最後まで分割しない）。
  const head: string[] = [];
  for (const character of charactersOf(normalized)) {
    if (head.length === EXCERPT_LENGTH) {
      // 切った位置が空白なら、… の前に残さない。
      return `${head.join("").trimEnd()}…`;
    }
    head.push(character);
  }
  return normalized;
}

export function attemptCardLabel(attempt: {
  user: Pick<Attempt["user"], "name">;
  description: Attempt["description"];
  likes_count: Attempt["likes_count"];
}): string {
  const { name } = attempt.user;
  return `${excerptOf(attempt.description)}、${name} さんの挑戦、いいね ${attempt.likes_count}`;
}
