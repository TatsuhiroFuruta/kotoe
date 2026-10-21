import { charactersOf } from "@/lib/text/graphemes";

// 結合文字・書式文字・空白・制御文字だけでできた書記素は、見えないので頭文字にしない。
// 「見える文字を許可する」向きの判定（文字・数字・絵文字だけ通す）だと、記号（☆ ♪）・国旗・
// キーキャップが漏れるため、「見えないものだけを除く」向きにしている（設計書 決定 7）。
const INVISIBLE = /^[\p{M}\p{Cf}\p{Z}\p{Cc}]+$/u;

// アバターに出す頭文字を返す（設計書 決定 7）。
//
// 先頭から書記素（見た目の 1 文字）で見て、見えない書記素を飛ばした最初のものを取る。
// サロゲートペア・ZWJ の絵文字・肌の色の修飾子・国旗・結合文字の濁点を割らない。
// 見つからなければ "?"。
export function avatarInitial(name: string): string {
  for (const character of charactersOf(name.trim())) {
    if (INVISIBLE.test(character)) continue;

    // ラテン文字だけが大文字になる。日本語・記号・絵文字は toUpperCase しても変わらない。
    const upper = character.toUpperCase();
    if (upper === character) return character;

    // 「ß」は大文字にすると「SS」の 2 文字になって丸に収まらないので、そのままにする。
    return Array.from(charactersOf(upper)).length === 1 ? upper : character;
  }
  return "?";
}
