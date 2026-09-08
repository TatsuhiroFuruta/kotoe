// サーバーが返すエラーコードを画面の文言に翻訳する。
//
// CLAUDE.md の分担：ルールの判定はバック、見せ方（文言・i18n）はフロント。
// バックは invalid_credentials / {"errors":{"email":["taken"]}} のように
// コードだけを返し、日本語をここ 1 箇所に集約する。

import { ApiError } from "@/lib/api";

export type AuthFormErrors = {
  /** フォーム全体に出すエラー。フィールドに紐づかないもの */
  formError: string | null;
  /** フィールド名 → 文言 */
  fieldErrors: Record<string, string>;
};

/** 401 のボディ（Warden の FailureApp）のコード */
const FORM_MESSAGES: Record<string, string> = {
  invalid_credentials: "メールアドレスまたはパスワードが正しくありません",
  unauthorized: "セッションの有効期限が切れました。もう一度ログインしてください",
};

/**
 * 422 のフィールド別コード。Rails 側の実体に対応させる：
 * name は User の presence、email と password は devise validatable と
 * config.password_length = 6..128。
 */
const FIELD_MESSAGES: Record<string, Record<string, string>> = {
  name: { blank: "名前を入力してください" },
  email: {
    blank: "メールアドレスを入力してください",
    invalid: "メールアドレスの形式が正しくありません",
    taken: "このメールアドレスは既に登録されています",
  },
  password: {
    blank: "パスワードを入力してください",
    too_short: "パスワードは6文字以上で入力してください",
    too_long: "パスワードは128文字以下で入力してください",
  },
};

const NETWORK_MESSAGE = "サーバーに接続できませんでした。通信環境を確認してください";
const SERVER_MESSAGE = "サーバーでエラーが発生しました。時間をおいて再度お試しください";
const UNEXPECTED_MESSAGE = "認証に失敗しました。時間をおいて再度お試しください";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 422 のボディを、フィールド別の文言とフォーム全体の文言に振り分ける。
 *
 * 「画面に何も出ない」状態を作らないことが目的で、そのために 2 段構えにしている。
 *
 *   1. 未知の**コード**（既知フィールドの新しいバリデーション）… そのフィールドの
 *      下にコードを含む文言を出す。
 *   2. 未知の**フィールド**（base など、フォームが入力欄を持たないもの）…
 *      fieldErrors に入れても描画されないので、formError へ回す。
 *
 * 2 が要るのは、fieldErrors が非空でも画面に何も出ないことがあるため。
 * FIELD_MESSAGES のキーを「フォームが描画するフィールド」の集合として使っている
 * （/login は email・password、/signup は name・email・password を描画し、
 * /login に name のエラーが返ることはない＝ name を送っていないため）。
 */
function toFieldErrors(errors: Record<string, unknown>): {
  fieldErrors: Record<string, string>;
  unrenderable: string[];
} {
  const fieldErrors: Record<string, string> = {};
  const unrenderable: string[] = [];

  for (const [field, codes] of Object.entries(errors)) {
    // 想定外の形（配列でない、文字列コードが入っていない）でもフィールド名だけは
    // 拾って formError へ回す。捨てると SERVER_MESSAGE に丸まり、どの項目が
    // 問題なのかが画面から失われる。
    if (!Array.isArray(codes)) {
      unrenderable.push(`${field}: ${String(codes)}`);
      continue;
    }

    const code = codes.find((candidate): candidate is string => typeof candidate === "string");
    if (code === undefined) {
      unrenderable.push(field);
      continue;
    }

    const messages = FIELD_MESSAGES[field];
    if (messages === undefined) {
      unrenderable.push(`${field}: ${code}`);
      continue;
    }

    fieldErrors[field] = messages[code] ?? `入力内容を確認してください（${field}: ${code}）`;
  }

  return { fieldErrors, unrenderable };
}

export function toAuthFormErrors(error: unknown): AuthFormErrors {
  if (error instanceof ApiError) {
    const body = error.body;

    if (error.status === 401 && isRecord(body) && typeof body.error === "string") {
      return { formError: FORM_MESSAGES[body.error] ?? SERVER_MESSAGE, fieldErrors: {} };
    }

    if (error.status === 422 && isRecord(body) && isRecord(body.errors)) {
      const { fieldErrors, unrenderable } = toFieldErrors(body.errors);

      if (unrenderable.length > 0) {
        // 入力欄が無いフィールドのエラー。fieldErrors に入れても描画されないので
        // フォーム全体のエラーとして出す。
        return {
          formError: `入力内容を確認してください（${unrenderable.join(" / ")}）`,
          fieldErrors,
        };
      }

      // 422 なのに 1 件も翻訳できなかったときに無言で終わらせない。
      if (Object.keys(fieldErrors).length > 0) {
        return { formError: null, fieldErrors };
      }
    }

    // JSON でないボディ（Render のプロキシや Vercel の HTML エラーページ）も
    // ここに落ちる。api.ts が生の文字列のまま body に入れている。
    return { formError: SERVER_MESSAGE, fieldErrors: {} };
  }

  // fetch 自体が失敗すると TypeError になる（通信断・CORS・名前解決の失敗）。
  if (error instanceof TypeError) {
    return { formError: NETWORK_MESSAGE, fieldErrors: {} };
  }

  // extractToken が投げる Error がここに来る。CORS の expose 設定が壊れている
  // ときで、握り潰すと「ログインは成功しているのに入れない」という原因の
  // 分からない症状になる。文言はユーザー向けに丸め、原文はコンソールに残す。
  console.error("認証処理で想定外のエラーが発生しました", error);
  return { formError: UNEXPECTED_MESSAGE, fieldErrors: {} };
}
