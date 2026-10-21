import { charactersOf } from "@/lib/text/graphemes";

// 文字・数字・絵文字のどれかを含む書記素だけを頭文字の候補にする。
const VISIBLE = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;

// アバターに出す頭文字を返す（設計書 決定 7）。
//
// 先頭から書記素（見た目の 1 文字）で見て、文字・数字・絵文字を含む最初のものを取る。
// サロゲートペア・ZWJ の絵文字・肌の色の修飾子・結合文字の濁点を割らず、幅ゼロの空白や
// 単独の結合文字は飛ばす。見つからなければ "?"。
export function avatarInitial(name: string): string {
  for (const character of charactersOf(name.trim())) {
    if (!VISIBLE.test(character)) continue;

    // ラテン文字だけが大文字になる。日本語などは toUpperCase しても変わらない。
    // 「ß」は大文字にすると「SS」の 2 文字になって丸に収まらないので、そのままにする。
    const upper = character.toUpperCase();
    return Array.from(charactersOf(upper)).length === 1 ? upper : character;
  }
  return "?";
}
