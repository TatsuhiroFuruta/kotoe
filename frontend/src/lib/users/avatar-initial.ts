// アバターに出す頭文字を返す。
//
// 先頭の 1 文字を `name[0]` ではなく Array.from で取るのは、UTF-16 の
// サロゲートペア（絵文字など）を途中で割らないため。
// 結合文字や ZWJ でつないだ絵文字は 1 つのコードポイントとして切り出されて崩れうるが、
// 飾りの丸に出すだけなので許容する（設計書の決定 7）。
export function avatarInitial(name: string): string {
  const [first] = Array.from(name.trim());
  if (first === undefined) return "?";

  // ラテン文字だけが大文字になる。日本語などは toUpperCase しても変わらない。
  return first.toUpperCase();
}
