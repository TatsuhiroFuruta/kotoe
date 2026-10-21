/**
 * 文字を先頭から 1 つずつ返す。書記素（見た目の 1 文字）で数えるのは、コードポイントで切ると
 * ZWJ でつないだ絵文字や肌の色の修飾子、結合文字の濁点を途中で切ってしまうため。
 *
 * Intl.Segmenter は Firefox では 125 から。無い環境ではコードポイントで数える（描画中に
 * 例外を投げないため）。その場合は上の文字を途中で切ることがある。
 */
let segmenter: Intl.Segmenter | undefined;

export function* charactersOf(text: string): Generator<string> {
  // 有無の判定は呼ぶたびに行う（キャッシュするのは作ったインスタンスだけ）。
  // こうすると Segmenter を隠すテストでも、先に作られたインスタンスに影響されずに代替経路を通る。
  if (typeof Intl.Segmenter !== "function") {
    yield* text;
    return;
  }
  segmenter ??= new Intl.Segmenter("ja", { granularity: "grapheme" });
  for (const { segment } of segmenter.segment(text)) {
    yield segment;
  }
}
