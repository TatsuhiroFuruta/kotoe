// 受け口（/posts/[id]?draft=<id>）で下書きを取得した結果の扱い（7-6b 設計書 決定 2）。
// 描写フォームから切り出した純粋関数。画面の操作（トースト・URL の書き換え）は呼び出し側が行う。

import { ApiError } from "@/lib/api";
import { toRequestErrorMessage } from "@/lib/request-error-messages";
import type { AttemptShowResponse } from "@/types/api";

export type DraftResumeOutcome =
  /** 文面を入れて開く */
  | { kind: "ready"; draftId: number; description: string }
  /** 空のフォーム＋DRAFT_UNAVAILABLE_MESSAGE。?draft= を外す */
  | { kind: "unavailable" }
  /** 401（失効）。api.ts がトークンを捨ててトーストを出しているので、何も重ねない。?draft= は残す */
  | { kind: "silent" }
  /** 通信の失敗。待てば開けるかもしれないので、?draft= を残してリロードで試せるようにする */
  | { kind: "failed"; message: string };

/**
 * 応答から開けるかを決める。理由（生成済み・別のお題・他人）は出し分けない。
 * 他人の下書きは API が 404 で隠しているので、ここで区別して見せると存在を漏らす。
 *
 * 本人の確認が要るのは、公開済みの挑戦は誰にでも返るため。status だけでも弾けるが、
 * 「本人の draft であること」を条件として直接書いておく。
 */
export function draftResumeFromResponse(
  response: AttemptShowResponse,
  expected: { postId: number; userId: number },
): DraftResumeOutcome {
  const { attempt, post } = response;
  const opensHere =
    attempt.status === "draft" &&
    post.id === expected.postId &&
    attempt.user.id === expected.userId;

  return opensHere
    ? { kind: "ready", draftId: attempt.id, description: attempt.description }
    : { kind: "unavailable" };
}

export function draftResumeFromError(error: unknown): DraftResumeOutcome {
  if (error instanceof ApiError && error.status === 404) return { kind: "unavailable" };
  if (error instanceof ApiError && error.status === 401) return { kind: "silent" };
  return { kind: "failed", message: toRequestErrorMessage(error) };
}

/**
 * 取得した結果を描写フォームに適用するか。適用しないのは 2 つの場合。
 *
 * - 同じ下書きが ready / unavailable で決着済み。認証が loading を経て戻ると（失効後の再ログイン、
 *   unreachable からの再試行）取得が走り直すが、もう一度 ready を適用すると書き直した文面が
 *   保存済みの文面に戻され、「保存済み」の表示で消えたことにも気づけない。unavailable はトーストの繰り返しになる。
 *   failed（通信の失敗）だけは取り直しで開けるようになるので適用する。
 * - ready で、入力欄に既に文面がある。unreachable の間は取得せず書けるので、あとから届いた下書きで
 *   書いた文面を上書きしない（7-6b 設計書「作り手に任せること」）。
 */
export function shouldApplyDraftResume({
  previous,
  draftKey,
  outcome,
  currentText,
}: {
  previous: { key: number; outcome: DraftResumeOutcome } | null;
  draftKey: number;
  outcome: DraftResumeOutcome;
  currentText: string;
}): boolean {
  const settled =
    previous !== null &&
    previous.key === draftKey &&
    (previous.outcome.kind === "ready" || previous.outcome.kind === "unavailable");
  if (settled) return false;
  return !(outcome.kind === "ready" && currentText !== "");
}
