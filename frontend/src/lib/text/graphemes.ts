/**
 * 文字を先頭から 1 つずつ返す。書記素（見た目の 1 文字）で数えるのは、コードポイントで切ると
 * ZWJ でつないだ絵文字や肌の色の修飾子、結合文字の濁点を途中で切ってしまうため。
 *
 * Intl.Segmenter は Firefox では 125 から。無い環境ではコードポイントで数える（描画中に
 * 例外を投げないため）。その場合は上の文字を途中で切ることがある。
 */
export function* charactersOf(text: string): Generator<string> {
  if (typeof Intl.Segmenter !== "function") {
    yield* text;
    return;
  }
  for (const { segment } of new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text)) {
    yield segment;
  }
}
