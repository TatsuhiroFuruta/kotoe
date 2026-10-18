// Rails API を叩く共通クライアント。個別コンポーネントで直接 fetch しない。

import { notifySessionExpired } from "@/lib/auth/session-expiry";
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

/**
 * 応答を待つ既定の上限。
 *
 * Render の無料枠は約 15 分のアイドルでスリープし、次のアクセスの
 * コールドスタートに約 1 分かかる。15 秒は**必ずタイムアウトする**値だが、
 * それを承知で選んでいる。60 秒に合わせると「1 回で成功する代わりに最大
 * 60 秒無言で待つ」ことになり、押せるものがロゴだけの状態がほぼそのまま
 * 残るため。15 秒で unreachable に落とせば、待つか抜けるかをユーザーが
 * 選べる（設計書「決定 1」）。
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * 応答が上限内に返らなかったときのエラー。
 *
 * ApiError（2xx 以外）と同じく instanceof で判定できる形に揃える。
 * DOMException をそのまま流して name の文字列で判定する案は採らない。
 * api.ts が投げうるものの一覧が型から読めなくなるため。
 */
export class ApiTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`API request timed out after ${timeoutMs}ms`);
    this.name = "ApiTimeoutError";
  }
}

export type ApiRequestInit = RequestInit & {
  /**
   * true なら Authorization ヘッダを載せない。sign_up / sign_in で使う。
   * 「まだトークンを持っていないはずだから省略できる」ではなく、
   * ログイン中に再ログインされても下の 401 判定を壊さないために明示する。
   */
  skipAuth?: boolean;

  /**
   * 応答を待つ上限（ミリ秒）。既定は DEFAULT_TIMEOUT_MS。
   *
   * **この時間は本文の送信時間も含む。** AbortSignal は送信側のストリームも
   * 中断するので、低速回線から大きな FormData を送ると、アップロードが順調に
   * 進んでいても既定の 15 秒で打ち切られる。7-5 のお題投稿など画像を送る
   * 呼び出しは、ここに明示的な値を渡すこと。
   *
   * 無効化用の番兵は無い（0 は即座に中断し、Infinity は [EnforceRange] の
   * 変換で落ちる）。待ちたいなら具体的な値を渡す。
   */
  timeoutMs?: number;

  /**
   * false なら、Authorization を載せたリクエストの 401 を失効として扱わない（トークンを捨てず、
   * 失効のトーストも出さない）。既定は true。
   *
   * ログアウト（DELETE /api/auth/sign_out）だけが使う。前日から開いたままのタブでログアウトを
   * 押すと、送るトークンは既に失効していて 401 が返る。自分から抜けようとした人に
   * 「もう一度ログインしてください」と出さないため（7-2.6）。トークンは載せる（サーバー側で
   * 失効させるのに要る）ので、skipAuth では代わりにならない。
   */
  treatUnauthorizedAsExpiry?: boolean;
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

  const {
    skipAuth,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    treatUnauthorizedAsExpiry = true,
    ...requestInit
  } = init ?? {};
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
  // 条件を「文字列のボディ」に絞るのは、この既定値が JSON.stringify した
  // 文字列を送る場合のためのものだから。FormData / Blob / URLSearchParams は
  // ブラウザが正しい Content-Type を付けるので、こちらは手を出さない。
  if (typeof requestInit.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token) headers.set("Authorization", `Bearer ${token}`);

  // 呼び出し側の signal と合成する。どちらか一方だけを fetch へ渡すと、
  // 7-3b のポーリングでどちらかが効かなくなる（timeout だけを渡せば
  // アンマウントで止められず、signal だけを渡せば無限に待つ）。
  // AbortSignal.any は先に中断したほうの reason をそのまま伝えるので、
  // 合成しても TimeoutError と AbortError の区別は失われない。
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = requestInit.signal
    ? AbortSignal.any([timeoutSignal, requestInit.signal])
    : timeoutSignal;

  // このリクエストの 401 でトークンを失効させたか。本文の読み取り中に timeout が
  // 発火したとき、ApiTimeoutError ではなく 401 として投げ直すのに使う（下の catch）。
  let expiredByThisRequest = false;

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { ...requestInit, headers, signal });

    // Authorization を載せたリクエストが 401 を返した＝そのトークンが失効している。
    // 載せていないリクエストの 401 はログインの失敗（パスワード不一致）なので、
    // トークンを捨ててはいけない。Rails はどちらも 401 で返してくるため、
    // ステータスコードではなく「送信時に載せたか」で分ける。
    //
    // ここではリダイレクトしない。状態を落とすのは AuthProvider、
    // 画面遷移を決めるのは RequireAuth の仕事。認証不要ページで期限が切れても
    // ユーザーを画面から放り出さないため。
    //
    // 「今も同じトークンが入っているか」の比較は expire() の中にある。true が返るのは
    // 実際に捨てた 1 回だけなので、並行した 401 が何本あっても知らせは 1 回になる。
    // 各画面は 401 でトーストを出さない（ここが出す。7-2.6 設計書「決定 5」）。
    if (
      response.status === 401 &&
      token &&
      treatUnauthorizedAsExpiry &&
      tokenStore.expire(token)
    ) {
      expiredByThisRequest = true;
      notifySessionExpired();
    }

    const data = await parseBody(response);

    if (!response.ok) throw new ApiError(response.status, data);

    return { data: data as T, response };
  } catch (error) {
    // 変換するのは「ここで張った timeout が発火したとき」だけ。呼び出し側の
    // キャンセルは失敗ではなく、文言を出す相手でもない。
    //
    // name の一致だけを見てはいけない。呼び出し側が自前の
    // AbortSignal.timeout(n) を signal に渡している場合（7-3b のポーリングが
    // まさにそう）、その中断も name は "TimeoutError" になる。name だけで
    // 判定すると、呼び出し側の意図的な打ち切りを利用者向けの失敗に化けさせ、
    // しかも timeoutMs には無関係な既定値が入る。timeoutSignal.aborted を
    // 併せて見ると、どちらが発火したのかを取り違えない。
    //
    // instanceof DOMException と書かないのは、DOMException をグローバルに
    // 持たない実行環境で ReferenceError になるため。DOMException は Error を
    // 継承しているので、この形なら環境に依存せず同じ結果になる。
    //
    // try が parseBody まで包んでいるのは、signal がボディのストリーム読み取りも
    // 中断するため。fetch だけを包むと、本文を読んでいる最中の中断を拾えない。
    // ApiError はここを素通りする。
    if (timeoutSignal.aborted && error instanceof Error && error.name === "TimeoutError") {
      // 401 の本文を読んでいる最中に timeout が発火した。トークンはもう捨てて
      // 知らせも出したので、「応答がありません」ではなく 401 として扱わせる
      // （7-2.7 設計書「後続への申し送り 2」）。本文は読めていないので null。
      if (expiredByThisRequest) throw new ApiError(401, null);
      throw new ApiTimeoutError(timeoutMs);
    }
    throw error;
  }
}

export async function apiFetch<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const { data } = await apiRequest<T>(path, init);
  return data;
}
