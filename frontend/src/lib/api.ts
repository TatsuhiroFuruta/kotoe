// Rails API を叩く共通クライアント。個別コンポーネントで直接 fetch しない。

import { tokenStore } from "@/lib/auth/token-store";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

/** API が 2xx 以外を返したときのエラー。文言は呼び出し側（UI）が決める。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
  }
}

export type ApiRequestInit = RequestInit & {
  /**
   * true なら Authorization ヘッダを載せない。sign_up / sign_in で使う。
   * 「まだトークンを持っていないはずだから省略できる」ではなく、
   * ログイン中に再ログインされても下の 401 判定を壊さないために明示する。
   */
  skipAuth?: boolean;
};

/**
 * ボディの取り出し。status ではなく「中身が空かどうか」で判断する。
 *
 * 204 だけを特別扱いすると DELETE /api/auth/sign_out で落ちる。あちらは
 * `head :ok` なので 204 ではなく「ボディが空の 200」で返って来る。
 *
 * JSON でない応答も握り潰さず生の文字列で返す。Render のプロキシや
 * Vercel のエラーページは HTML を返すことがあり、ここで例外にすると
 * 本当のステータスコード（502 など）が失われて切り分けができなくなる。
 */
async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** 低レベル。Response ごと返す。レスポンスヘッダから JWT を取る認証まわりが使う。 */
export async function apiRequest<T>(
  path: string,
  init?: ApiRequestInit,
): Promise<{ data: T; response: Response }> {
  if (!API_BASE_URL) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL が設定されていません");
  }

  const { skipAuth, ...requestInit } = init ?? {};
  const token = skipAuth ? null : tokenStore.get();

  const headers = new Headers(requestInit.headers);

  // Content-Type は「ボディがあり、FormData でなく、呼び出し側が指定して
  // いない」ときだけ付ける。無条件に set すると2つ壊れる。
  //
  //   1. 7-3 / 7-5 の画像アップロードで FormData を渡したとき、ブラウザが
  //      付ける multipart の boundary 付きヘッダを潰し、Rails が本文を
  //      パースできなくなる（原因がここだと気づきにくい）。
  //   2. ボディの無い GET にまで application/json が付くと CORS の
  //      safelist を外れ、認証不要ページのリクエストにも毎回プリフライトの
  //      往復が増える。
  const hasBody = requestInit.body !== undefined && requestInit.body !== null;
  if (hasBody && !(requestInit.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, { ...requestInit, headers });

  // Authorization を載せたリクエストが 401 を返した＝そのトークンが失効している。
  // 載せていないリクエストの 401 はログインの失敗（パスワード不一致）なので、
  // トークンを捨ててはいけない。Rails はどちらも 401 で返してくるため、
  // ステータスコードではなく「送信時に載せたか」で分ける。
  //
  // ここではリダイレクトしない。状態を落とすのは AuthProvider、
  // 画面遷移を決めるのは RequireAuth の仕事。認証不要ページで期限が切れても
  // ユーザーを画面から放り出さないため。
  //
  // 「今も同じトークンが入っているか」まで見るのは、token が送信時に
  // キャプチャした値だから。応答が返るまでの間に再ログインで別のトークンへ
  // 差し替わっていることがあり、そのとき古い 401 で新しいトークンを消すと、
  // ログイン成功直後に未ログインへ戻される（複数の API を並行で叩く
  // マイページで踏む）。
  if (response.status === 401 && token && tokenStore.get() === token) {
    tokenStore.clear();
  }

  const data = await parseBody(response);

  if (!response.ok) throw new ApiError(response.status, data);

  return { data: data as T, response };
}

export async function apiFetch<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const { data } = await apiRequest<T>(path, init);
  return data;
}
