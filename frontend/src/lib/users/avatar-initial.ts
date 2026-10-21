import { charactersOf } from "@/lib/text/graphemes";

// アバターに出す頭文字を返す。
//
// 先頭の 1 文字は `name[0]` でも Array.from でもなく書記素で取る。UTF-16 のサロゲートペアに
// 加えて、ZWJ でつないだ絵文字・肌の色の修飾子・結合文字の濁点も 1 文字として切り出すため
// （挑戦カードの描写文の切り出しと同じ charactersOf を使う）。
export function avatarInitial(name: string): string {
  const first = charactersOf(name.trim()).next();
  if (first.done) return "?";

  // ラテン文字だけが大文字になる。日本語などは toUpperCase しても変わらない。
  // 「ß」は大文字にすると「SS」の 2 文字になって丸に収まらないので、そのままにする。
  const upper = first.value.toUpperCase();
  return Array.from(charactersOf(upper)).length === 1 ? upper : first.value;
}
