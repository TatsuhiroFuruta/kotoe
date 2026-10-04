/**
 * 挑戦詳細（/attempts/[id]）の URL。カード・結果パネル・ログイン導線・リンクのコピーが
 * 同じ関数から作る（別々に組み立てると、片方だけ形が変わったときに気づけない）。
 */

import { parsePositiveInt } from "@/lib/search-params";

/**
 * URL の [id]。正の安全な整数の文字列だけを受け付ける。
 * それ以外は null を返し、page.tsx が API を呼ばずに notFound() にする（parsePostId と同じ）。
 */
export function parseAttemptId(raw: string): number | null {
  return parsePositiveInt(raw);
}

export function attemptDetailHref(id: number): string {
  return `/attempts/${id}`;
}
