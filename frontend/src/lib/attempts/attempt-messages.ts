// 挑戦（描写・生成）まわりの文言。バックはエラーコードだけを返し、日本語はここに集める
// （CLAUDE.md「メッセージ・エラー・i18n の責務」）。
//
// 通信そのものの失敗（timeout・通信断・5xx）の文言は lib/request-error-messages.ts にある。

import { ApiError } from "@/lib/api";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/error-messages";
import { toRequestErrorMessage } from "@/lib/request-error-messages";
import type { FailureReason } from "@/types/api";

/**
 * 描写文の上限。backend の Attempt::MAX_DESCRIPTION_LENGTH と揃える。
 * 用途は文字数カウンターの表示だけで、判定はサーバーの 422 に任せる（7-3c 設計書「決定 9」）。
 */
export const DESCRIPTION_MAX_LENGTH = 1_000;

export const DRAFT_SAVED_MESSAGE = "下書きを保存しました";
/**
 * 保存（PATCH）の 404。下書きの削除だけでなく、お題の削除でも返る（4-4）。
 * お題が残っていれば次の保存は新しい下書きになり、消えていれば POST が 404 で説明する。
 */
export const DRAFT_GONE_MESSAGE =
  "この下書きは削除されたか、お題が削除されています。お題が残っていれば、もう一度保存すると新しい下書きになります";

/** 保存（PATCH）の attempt_not_draft。下書きは既に生成済みで、その結果を確かめに行く。 */
export const EDIT_NOT_SAVED_MESSAGE =
  "この下書きは既に生成が始まっていたため、書き直した内容は保存されていません。始まっていた生成の結果を表示します";
export const POST_GONE_MESSAGE = "このお題は削除されました";
export const GENERATE_TARGET_GONE_MESSAGE = "この下書きは削除されたか、お題が削除されています";
/**
 * 応答が不明だった生成を確かめたら、まだ draft だったとき。「開始できませんでした」と
 * 断定しない。Render のコールドスタートでは、処理待ちの generate より先に確認の GET が
 * 返ることがある。もう一度押せば、起動済みなら attempt_not_draft → 確認に合流し、
 * 未起動なら起動する（サーバーのロックで二重には起動しない）。
 */
export const GENERATION_NOT_STARTED_MESSAGE =
  "生成の開始を確認できませんでした。もう一度「画像を生成」を押してください";

/** 失敗パネルに必ず添える。枠は enqueue 時に消費し、失敗しても戻らない（ドメインの重要ルール）。 */
export const QUOTA_USED_NOTE = "この生成で今日の生成回数を 1 回使いました";

/** いいねの 404。挑戦の削除だけでなく、お題の削除でも返る（5-1）。 */
export const ATTEMPT_GONE_MESSAGE = "この挑戦は削除されました";
/**
 * いいねの 422 cannot_like_own_attempt。比較ビューは自分の挑戦にボタンを出さないので、
 * 届くのは画面を開いた後に別タブで別アカウントへ切り替えたときなど。
 */
export const CANNOT_LIKE_OWN_MESSAGE = "自分の挑戦にはいいねできません";

const FAILURE_MESSAGES: Record<FailureReason, string> = {
  content_policy:
    "描写の内容が画像生成サービスの規約に触れたため、生成できませんでした。表現を変えて再挑戦してください",
  rate_limited:
    "画像生成サービスが混み合っていたため、生成できませんでした。時間をおいて再挑戦してください",
  api_error: "画像生成サービスでエラーが発生したため、生成できませんでした",
  upload_failed: "生成した画像を保存できませんでした",
  internal_error: "サーバーでエラーが発生したため、生成できませんでした",
  generation_disabled: "画像生成が一時停止されたため、生成できませんでした",
};

const DESCRIPTION_MESSAGES: Record<string, string> = {
  blank: "描写を入力してください",
  too_long: `描写は ${DESCRIPTION_MAX_LENGTH} 文字以内で入力してください`,
};

const HOUR_MS = 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 辞書に自前のキーとしてあるか。`key in record` や `record[key]` は、Object.prototype から
 * 継承したキー（toString・constructor・__proto__ など）にも値を返し、文言ではない値
 * （関数やオブジェクト）を文言として扱ってしまう。これらのキーは未知のコードとして扱う。
 */
function hasOwnKey<T extends object>(record: T, key: string): key is Extract<keyof T, string> {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** ApiError のボディの error（エラーコード）。無ければ null。 */
export function apiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError) || !isRecord(error.body)) return null;
  return typeof error.body.error === "string" ? error.body.error : null;
}

/** failure_reason を 1 文にする。未知のコード・null でも必ず何かを返す（無言にしない）。 */
export function failureReasonMessage(reason: string | null): string {
  if (reason !== null && hasOwnKey(FAILURE_MESSAGES, reason)) return FAILURE_MESSAGES[reason];
  return `生成できませんでした（${reason ?? "理由不明"}）`;
}

/**
 * resets_at から「あと約 N 時間で」を作る。時間は切り上げ（「あと約 0 時間」を出さないため）。
 * 壊れた値・過去の時刻なら null を返し、呼び出し側はその節ごと省く。
 */
export function resetsInText(resetsAt: unknown, now: number): string | null {
  if (typeof resetsAt !== "string") return null;

  const resetsAtMs = Date.parse(resetsAt);
  if (Number.isNaN(resetsAtMs)) return null;

  const remaining = resetsAtMs - now;
  if (remaining <= 0) return null;
  if (remaining <= HOUR_MS) return "1 時間以内に";

  return `あと約 ${Math.ceil(remaining / HOUR_MS)} 時間で`;
}

/**
 * POST :generate の業務エラー（上限・キルスイッチ）を 1 文にする。
 * それ以外は null を返す。呼び出し側が 404・応答不明（7-3c 設計書「決定 10」）へ振り分ける。
 */
export function generationErrorMessage(error: unknown, now: number): string | null {
  if (!(error instanceof ApiError) || !isRecord(error.body)) return null;

  const { body } = error;
  const resets = resetsInText(body.resets_at, now);
  const recovery = resets === null ? "" : `${resets}回復します`;

  if (error.status === 422 && body.error === "generation_limit_reached") {
    const limit =
      typeof body.limit === "number" && Number.isInteger(body.limit) && body.limit > 0
        ? `（${body.limit} 回）`
        : "";
    return `今日の生成回数${limit}を使い切りました。${recovery}`;
  }

  if (error.status === 503 && body.error === "service_generation_limit_reached") {
    return `本日はサービス全体の生成上限に達しました。${recovery}`;
  }

  if (error.status === 503 && body.error === "generation_disabled") {
    return "現在、画像生成を一時停止しています。時間をおいて再度お試しください";
  }

  return null;
}

/** 保存の 422 のうち description のエラーを 1 文にする。入力欄の下に出す。該当しなければ null。 */
export function descriptionFieldError(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  if (!isRecord(error.body) || !isRecord(error.body.errors)) return null;

  const codes = error.body.errors.description;
  if (!Array.isArray(codes)) return null;

  const code = codes.find((candidate): candidate is string => typeof candidate === "string");
  if (code === undefined) return null;

  return hasOwnKey(DESCRIPTION_MESSAGES, code)
    ? DESCRIPTION_MESSAGES[code]
    : `描写の内容を確認してください（${code}）`;
}

/**
 * どの分岐にも当たらなかった失敗。4xx はコード（無ければステータス）を含めて出す
 * （無言にしない）。5xx・timeout・通信断は通信エラーの文言に揃える。
 */
export function fallbackErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status < 500) {
    return `操作を完了できませんでした（${apiErrorCode(error) ?? error.status}）`;
  }
  return toRequestErrorMessage(error);
}

/**
 * いいね（POST / DELETE :like）の失敗を 1 文にする。無言にしない（FavoriteButton と同じ方針）。
 *
 * 401 は失効。api.ts がトークンを捨てるので、ボタンはすぐ「ログインしていいね」に変わる。
 * 理由を伝えないと、押したら別のボタンに化けたようにしか見えない。
 */
export function toLikeErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return SESSION_EXPIRED_MESSAGE;
  if (error instanceof ApiError && error.status === 404) return ATTEMPT_GONE_MESSAGE;
  if (
    error instanceof ApiError &&
    error.status === 422 &&
    apiErrorCode(error) === "cannot_like_own_attempt"
  ) {
    return CANNOT_LIKE_OWN_MESSAGE;
  }
  return fallbackErrorMessage(error);
}
