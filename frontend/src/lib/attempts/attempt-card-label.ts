/**
 * 挑戦カード（リンク）の読み上げ名。
 *
 * カードは <article> ごと <Link> で包んでいるので、何も付けないとリンクの名前が中身すべて
 * （描写文は最大 1,000 文字）になる。line-clamp は見た目を切るだけで、読み上げは切らない。
 * 名前だけだと同じ人のカードが区別できないので、描写文の先頭を添える。
 */

import type { Attempt } from "@/types/api";

/** 添える描写文の長さ。同じ人のカードを区別できれば足りる。 */
const EXCERPT_LENGTH = 40;

export function attemptCardLabel(attempt: {
  user: Pick<Attempt["user"], "name">;
  description: Attempt["description"];
}): string {
  // Array.from で数えるのは、絵文字などのサロゲートペアを途中で切らないため。
  const chars = Array.from(attempt.description);
  const excerpt =
    chars.length > EXCERPT_LENGTH
      ? `${chars.slice(0, EXCERPT_LENGTH).join("")}…`
      : attempt.description;
  return `${attempt.user.name} さんの挑戦：${excerpt}`;
}
