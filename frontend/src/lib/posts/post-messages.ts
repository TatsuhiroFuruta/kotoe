// お題投稿まわりの文言。バックはエラーコードだけを返し、日本語はここに集める
// （CLAUDE.md「メッセージ・エラー・i18n の責務」）。
//
// 送る前の確認（image-file-check.ts）もバックと同じコードを返すので、同じ辞書で翻訳する。
// 例外は image_empty（0 バイト）で、フロントだけが返す。バックが送らないからといって辞書から消さないこと。
// 送信の失敗は「作られなかった（rejected）」と「作られたか分からない（unconfirmed）」に分けて扱う
// （設計書「決定 4」）。後者でフォーム上部用・読み込み用の文言を流用しないこと。失敗と断定すると
// 二重投稿を誘い、場面にも合わない。

import { ApiError, ApiTimeoutError } from "@/lib/api";
import { apiErrorCode, fallbackErrorMessage } from "@/lib/attempts/attempt-messages";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/session-expiry";
import { IMAGE_MAX_BYTES } from "@/lib/posts/image-file-check";

export const POST_CREATED_MESSAGE = "お題を投稿しました";
export const UPLOAD_FAILED_MESSAGE = "画像の保存に失敗しました。時間をおいて再度お試しください";
/** 送信中に画面を離れたあとの rejected で、理由を括弧で添えるときの書き出し */
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
  /**
   * 作られなかった（Rails が「作らなかった」と答えた）。message は画面のフォーム上部用の文、
   * reason は送信中に画面を離れていたときのトーストで括弧に入れる短い句。
   */
  | { kind: "rejected"; message: string; reason: string }
  /**
   * 作られたか分からない（応答が届かなかった）。ブラウザが待つのをやめても通信が切れても Rails は
   * 処理を続けるので、お題は作られている場合がある。文言は unconfirmedMessage() で組み立てる。
   */
  | { kind: "unconfirmed"; reason: string }
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

function rejected(message: string, reason: string): PostFormErrors {
  return { ...NO_ERRORS, form: { kind: "rejected", message, reason } };
}

function unconfirmed(reason: string): PostFormErrors {
  return { ...NO_ERRORS, form: { kind: "unconfirmed", reason } };
}

const UNKNOWN_FIELD_REASON = "入力内容が受け付けられませんでした";

/**
 * 422 の `{ errors: { field: [code] } }` を欄に振り分ける。
 *
 * Object.entries で自前のキーだけを見る。JSON.parse は "__proto__" を自前のキーとして作るが、
 * "image" / "title" との一致でしか欄に振らないので、画面に無い欄として扱われる。
 */
function fromValidationErrors(body: unknown): PostFormErrors {
  if (!isRecord(body) || !isRecord(body.errors)) {
    return rejected(UNKNOWN_FIELD_MESSAGE, UNKNOWN_FIELD_REASON);
  }

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
    result.form = { kind: "rejected", message: UNKNOWN_FIELD_MESSAGE, reason: UNKNOWN_FIELD_REASON };
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
  if (error instanceof ApiTimeoutError) return unconfirmed("応答が時間内に返りませんでした");
  // fetch 自体の失敗（通信断・CORS・名前解決）。本文を送り終えたあとに切れた場合もここに来る。
  if (error instanceof TypeError) return unconfirmed("通信が切れました");

  if (error instanceof ApiError) {
    if (error.status === 401) return { ...NO_ERRORS, form: { kind: "session_expired" } };
    if (error.status === 422) return fromValidationErrors(error.body);
    // 画像の保存に失敗すると、Rails は post.save! の前で止まる（お題は保存されていない）。
    if (
      error.status === 502 &&
      isRecord(error.body) &&
      error.body.error === "image_upload_failed"
    ) {
      return rejected(UPLOAD_FAILED_MESSAGE, "画像の保存に失敗しました");
    }
    if (error.status < 500) {
      return rejected(fallbackErrorMessage(error), apiErrorCode(error) ?? String(error.status));
    }
    // その他の 5xx は、Rails の保存のあとで起きたものや、プロキシが途中で切ったものがありうる。
    return unconfirmed("サーバーでエラーが発生しました");
  }

  // 握り潰すと原因が分からなくなる。文言は丸め、原文はコンソールに残す。
  console.error("お題の投稿で想定外のエラーが発生しました", error);
  return unconfirmed("予期しないエラーが発生しました");
}

/**
 * 作られたか分からないときの文。失敗と断定せず、一覧で確かめてもらう。
 * 画面ではこれに一覧へのリンク（新しいタブ）を添え、離脱後はトーストにそのまま出す。
 */
export function unconfirmedMessage(reason: string): string {
  return `投稿が完了したか確認できませんでした（${reason}）。お題一覧で確かめてから、必要ならもう一度投稿してください`;
}

/**
 * 送信中に画面を離れたあとの失敗を、トーストの 1 文にする。成功のときはトーストを出すので、
 * 失敗で何も出さないと「投稿された」と受け取られる。
 *
 * - 失効：セッションの文言
 * - unconfirmed：画面と同じ文（リンクは無し）
 * - rejected：理由を括弧で添える。欄のエラーがあればそれを優先する（直すべき入力が分かる）
 */
export function toLeftPageFailureMessage(errors: PostFormErrors): string {
  if (errors.form?.kind === "session_expired") return SESSION_EXPIRED_MESSAGE;
  if (errors.form?.kind === "unconfirmed") return unconfirmedMessage(errors.form.reason);

  const reason = errors.image ?? errors.title ?? errors.form?.reason ?? UNKNOWN_FIELD_REASON;
  return `${POST_FAILED_PREFIX}（${reason}）`;
}
