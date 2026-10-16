import type { User } from "@/types/api";

/**
 * ログイン状態。7-1 では 3 状態 ＋ `restoreFailed: boolean` だったが、
 * 「トークンは残っているが GET /api/me の答えが得られない」を unauthenticated に
 * 混ぜると、ヘッダーが「ログイン」を出す一方で api.ts は Authorization を
 * 載せ続ける、という食い違いが起きる。4 つ目の状態として分ける。
 */
export type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: User }
  /**
   * 未ログインが確定した（トークンが無い、または 401 で破棄された）。
   * expired は「401 で破棄された」とき true。5 つ目の状態にしないのは、未ログインと同じ表示で
   * よい分岐が 7 箇所あり、状態を分けると 1 箇所の漏れでそこだけ何も出なくなるため（7-2.6 決定 2）。
   * 見るのは RequireAuth だけ。
   */
  | { status: "unauthenticated"; expired: boolean }
  /** トークンはあるが、有効かどうか確かめられない（通信断・5xx・CORS） */
  | { status: "unreachable" };

export type AuthStateInput = {
  /** ハイドレーションが済んだか */
  hydrated: boolean;
  /** tokenStore の現在値 */
  token: string | null;
  /** どのトークンに対して誰だと分かっているか */
  session: { token: string; user: User } | null;
  /** 復元に失敗したトークン。無限リトライを防ぐために覚えている */
  restoreFailedFor: string | null;
  /** 最後にトークンが消えた理由が失効か（tokenStore.wasExpired()） */
  expired: boolean;
};

/**
 * 5 つの入力から表示すべき状態を決める。**判定の順序そのものが仕様**なので、
 * 行を入れ替えないこと。各行が前の行より先に来られない理由：
 *
 *   1. hydrated … ハイドレーション中は token が必ず null になる。これを先に
 *      見ないと、有効なトークンを持つ人を未ログインと誤判定する（7-1 のバグ）。
 *   2. token === null … トークンが無いなら他を見る必要が無い。
 *   3. session … signIn 直後。GET /api/me を叩き直さずに済ませる。
 *   4. restoreFailedFor … トークンの一致まで見る。再ログインで差し替わったら
 *      古い失敗を引きずらず、loading（= 再試行される）に落とす。
 */
export function deriveAuthState({
  hydrated,
  token,
  session,
  restoreFailedFor,
  expired,
}: AuthStateInput): AuthState {
  if (!hydrated) return { status: "loading" };
  if (token === null) return { status: "unauthenticated", expired };
  if (session?.token === token) return { status: "authenticated", user: session.user };
  if (restoreFailedFor === token) return { status: "unreachable" };
  return { status: "loading" };
}
