// 通信そのものの失敗（タイムアウト・通信断・2xx 以外）を画面の文言にする。
//
// 認証フォーム（lib/auth/error-messages.ts）と一覧などの取得（7-3a 以降）で
// 同じ文言を使うため、ここに 1 つだけ置く。どちらかにだけ書くと、片方の
// 文言を直したときにもう片方が古いまま残る。
//
// 業務ルールのエラー（422 のフィールド別コードなど）はここでは扱わない。
// 画面ごとに描画する入力欄が違い、振り分け方も画面ごとに違うため。

import { ApiError, ApiTimeoutError } from "@/lib/api";

export const TIMEOUT_MESSAGE =
  "サーバーの応答がありません。起動中の可能性があるので、少し待ってから再度お試しください";
export const NETWORK_MESSAGE = "サーバーに接続できませんでした。通信環境を確認してください";
export const SERVER_MESSAGE = "サーバーでエラーが発生しました。時間をおいて再度お試しください";

const UNEXPECTED_LOAD_MESSAGE = "読み込みに失敗しました。時間をおいて再度お試しください";

/**
 * 認証に依存しない取得（お題一覧など）の失敗を 1 文にする。
 *
 * 判定の順序は toAuthFormErrors の末尾と揃えてある。ApiTimeoutError を先に見るのは、
 * abort の reject 値が TypeError ではないため（後ろに置いても結果は同じだが、
 * 「タイムアウトは通信断ではない」という意図を順序で示す）。
 *
 * 呼び出し側の中断（AbortError）はここに渡さないこと。失敗ではないので文言を出す相手が無い。
 */
export function toRequestErrorMessage(error: unknown): string {
  if (error instanceof ApiTimeoutError) return TIMEOUT_MESSAGE;

  // JSON でないボディ（Render のプロキシや Vercel の HTML エラーページ）もここに来る。
  if (error instanceof ApiError) return SERVER_MESSAGE;

  // fetch 自体が失敗すると TypeError になる（通信断・CORS・名前解決の失敗）。
  if (error instanceof TypeError) return NETWORK_MESSAGE;

  // 握り潰すと原因の分からない「読み込めない」になる。文言は丸め、原文はコンソールに残す。
  console.error("読み込みで想定外のエラーが発生しました", error);
  return UNEXPECTED_LOAD_MESSAGE;
}
