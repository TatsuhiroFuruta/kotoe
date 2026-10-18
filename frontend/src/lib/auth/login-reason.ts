/**
 * ログイン画面へ送るときの「なぜ送ったか」（?reason=）の組み立てと検証。
 *
 * 送る側（RequireAuth）と受ける側（ログイン画面）を同じファイルに置くのは、
 * 文字列が食い違うと枠が二度と出ず、しかもどちらのテストも green のままになるため。
 */

export const LOGIN_REASON_EXPIRED = "expired";

export type LoginReason = typeof LOGIN_REASON_EXPIRED;

/**
 * `?reason=` を検証する。完全に一致したときだけ通し、それ以外はすべて null。
 *
 * `?reason=` は URL に載る＝誰でも書ける値（safeNextPath の ?next= と同じ）。
 * ただし値そのものは画面に出さず、固定の文言を出すかどうかを決めるだけに使う。
 * 外部から ?reason=expired 付きのリンクを踏まされても、出るのはこちらが決めた 1 文だけ。
 *
 * 同じキーが重なると Next の searchParams は配列で渡す。どちらを採るか迷う値は通さない。
 */
export function parseLoginReason(raw: string | string[] | undefined): LoginReason | null {
  return raw === LOGIN_REASON_EXPIRED ? LOGIN_REASON_EXPIRED : null;
}

/**
 * RequireAuth がログイン画面へ送るときの URL。current はクエリを含む今の場所。
 * 失効でなければ今までと同じ /login?next=... を返す。
 */
export function loginPathFor(current: string, expired: boolean): string {
  const next = `next=${encodeURIComponent(current)}`;
  return expired ? `/login?reason=${LOGIN_REASON_EXPIRED}&${next}` : `/login?${next}`;
}
