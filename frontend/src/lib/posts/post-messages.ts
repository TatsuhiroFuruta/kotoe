// お題投稿まわりの文言。バックはエラーコードだけを返し、日本語はここに集める
// （CLAUDE.md「メッセージ・エラー・i18n の責務」）。
//
// 送る前の確認（image-file-check.ts）もバックと同じコードを返すので、同じ辞書で翻訳する。
// 例外は image_empty（0 バイト）で、フロントだけが返す。バックが送らないからといって辞書から消さないこと。
// 通信そのものの失敗（timeout 以外）の文言は lib/request-error-messages.ts にある。

import { ApiError, ApiTimeoutError } from "@/lib/api";
import { fallbackErrorMessage } from "@/lib/attempts/attempt-messages";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/error-messages";
import { IMAGE_MAX_BYTES } from "@/lib/posts/image-file-check";
import { toRequestErrorMessage } from "@/lib/request-error-messages";

export const POST_CREATED_MESSAGE = "お題を投稿しました";
export const UPLOAD_FAILED_MESSAGE = "画像の保存に失敗しました。時間をおいて再度お試しください";
/**
 * timeout したとき。Rails が本文を受け取ったあとに切れた場合、お題はサーバー側で作られている
 * 可能性がある。一般的な「再度お試しください」では押し直しを促し、二重投稿になる（設計書「決定 4」）。
 */
export const POST_TIMEOUT_MESSAGE =
  "投稿に時間がかかっています。投稿が完了している場合がありますので、お題一覧で確認してから再度お試しください";
/**
 * 送信中に画面を離れたあとで失敗したとき。フォームはもう無いので、欄の文言は見せられない。
 * 成功のときはトーストを出すので、失敗で何も出さないと「投稿された」と受け取られる。
 */
export const POST_FAILED_AFTER_LEAVE_MESSAGE = "お題を投稿できませんでした。もう一度投稿してください";
/** 欄の理由を添えるときの書き出し。欄の文言は短い句なので括弧に入れられる */
const POST_FAILED_PREFIX = "お題を投稿できませんでした";
/** 422 のうち、画面に欄が無いもの。何も表示されない状態を作らないための受け皿 */
export const UNKNOWN_FIELD_MESSAGE = "投稿できませんでした。入力内容を確認してください";

const IMAGE_MESSAGES: Record<string, string> = {
  image_empty: "空のファイルです。別の画像を選んでください",
  image_missing: "画像を選んでください",
  image_too_large: `画像は ${IMAGE_MAX_BYTES / 1024 / 1024}MB 以下にしてください`,
  image_type_not_allowed: "JPEG・PNG・WebP・HEIC の画像を選んでください",
};
const IMAGE_FALLBACK_MESSAGE = "この画像は使えません";

const TITLE_MESSAGES: Record<string, string> = {
  blank: "タイトルを入力してください",
};
const TITLE_FALLBACK_MESSAGE = "このタイトルは使えません";

export type PostFormError =
  | { kind: "message"; message: string }
  /** 文言に一覧へのリンクを添えるので、文字列ではなく種類で返す */
  | { kind: "timeout" }
  /** 文言はトーストで出す（7-3c と同じ）。RequireAuth がこのあとログイン画面へ送る */
  | { kind: "session_expired" };

export type PostFormErrors = {
  image: string | null;
  title: string | null;
  form: PostFormError | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 辞書に自前のキーとしてあるか。`record[key]` は Object.prototype から継承したキー
 * （toString など）にも値を返すので、それらを未知のコードとして扱うために使う。
 */
function hasOwnKey(record: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * タイトルが空か。Rails の `presence`（`blank?`）は空白だけの文字列も空と判定するので、
 * ここで素通しすると 422 になる。JS の trim() と Ruby の [[:space:]] はどちらも
 * 全角スペース（U+3000）を空白として扱う。
 */
export function isBlankTitle(title: string): boolean {
  return title.trim() === "";
}

export function imageErrorMessage(code: string): string {
  return hasOwnKey(IMAGE_MESSAGES, code) ? IMAGE_MESSAGES[code] : IMAGE_FALLBACK_MESSAGE;
}

export function titleErrorMessage(code: string): string {
  return hasOwnKey(TITLE_MESSAGES, code) ? TITLE_MESSAGES[code] : TITLE_FALLBACK_MESSAGE;
}

/** 欄のコードの配列から最初の 1 件を取る。読めなければ null（呼び出し側が汎用の文言にする） */
function firstCode(codes: unknown): string | null {
  return Array.isArray(codes) && typeof codes[0] === "string" ? codes[0] : null;
}

const NO_ERRORS: PostFormErrors = { image: null, title: null, form: null };

function formMessage(message: string): PostFormErrors {
  return { ...NO_ERRORS, form: { kind: "message", message } };
}

/**
 * 422 の `{ errors: { field: [code] } }` を欄に振り分ける。
 *
 * Object.entries で自前のキーだけを見る。JSON.parse は "__proto__" を自前のキーとして作るが、
 * "image" / "title" との一致でしか欄に振らないので、画面に無い欄として扱われる。
 */
function fromValidationErrors(body: unknown): PostFormErrors {
  if (!isRecord(body) || !isRecord(body.errors)) return formMessage(UNKNOWN_FIELD_MESSAGE);

  const result: PostFormErrors = { ...NO_ERRORS };
  let hasUnknownField = false;

  for (const [field, codes] of Object.entries(body.errors)) {
    const code = firstCode(codes);
    if (field === "image") {
      result.image = code === null ? IMAGE_FALLBACK_MESSAGE : imageErrorMessage(code);
    } else if (field === "title") {
      result.title = code === null ? TITLE_FALLBACK_MESSAGE : titleErrorMessage(code);
    } else {
      hasUnknownField = true;
    }
  }

  // errors が空のときもここに来る。どの欄にも出ない 422 を無言にしない。
  if (hasUnknownField || (result.image === null && result.title === null)) {
    result.form = { kind: "message", message: UNKNOWN_FIELD_MESSAGE };
  }
  return result;
}

/**
 * 投稿（POST /api/posts）の失敗を、欄ごとの文言とフォーム上部の表示に振り分ける。
 * どんな失敗でも、image・title・form のどれか 1 つは必ず埋まる。
 *
 * 呼び出し側の中断（AbortError）は渡さないこと（投稿は中断しない）。
 */
export function toPostFormErrors(error: unknown): PostFormErrors {
  if (error instanceof ApiTimeoutError) return { ...NO_ERRORS, form: { kind: "timeout" } };

  if (error instanceof ApiError) {
    if (error.status === 401) return { ...NO_ERRORS, form: { kind: "session_expired" } };
    if (error.status === 422) return fromValidationErrors(error.body);
    if (
      error.status === 502 &&
      isRecord(error.body) &&
      error.body.error === "image_upload_failed"
    ) {
      return formMessage(UPLOAD_FAILED_MESSAGE);
    }
  }

  // 5xx・通信断は toRequestErrorMessage、それ以外の 4xx はコードかステータスを添えた文言
  // （attempt-messages.ts と同じ汎用の扱い）。
  return formMessage(
    error instanceof ApiError && error.status < 500
      ? fallbackErrorMessage(error)
      : toRequestErrorMessage(error),
  );
}

/**
 * 送信中に画面を離れたあとの失敗を、トーストの 1 文にする。
 * timeout は「投稿されている場合がある」をそのまま伝える（押し直して二重にしないため）。
 * 欄のエラーは理由を添える。理由が無いと、同じファイルを送り直してまた弾かれる。
 * フォーム上部の文言は完結した文なので添えない（括弧に入れると重複・入れ子になり、
 * 「入力内容を確認してください」のように、もう無いフォームを指す文も混ざる）。
 */
export function toLeftPageFailureMessage(errors: PostFormErrors): string {
  if (errors.form?.kind === "timeout") return POST_TIMEOUT_MESSAGE;
  if (errors.form?.kind === "session_expired") return SESSION_EXPIRED_MESSAGE;

  const reason = errors.image ?? errors.title;
  return reason === null ? POST_FAILED_AFTER_LEAVE_MESSAGE : `${POST_FAILED_PREFIX}（${reason}）`;
}
