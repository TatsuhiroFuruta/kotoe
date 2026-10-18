/**
 * JWT の失効（Authorization を載せたリクエストの 401）の知らせ方。
 *
 * 文言を error-messages.ts から移したのは、api.ts から使うため。error-messages.ts は
 * api.ts（ApiError）を import しているので、api.ts からあちらを import すると循環する。
 */

import { toast } from "@/lib/toast/toast-store";

/** ログインフォームの 401（unauthorized）とログイン画面の案内の枠でも使う。文言を 2 箇所に書かない。 */
export const SESSION_EXPIRED_MESSAGE = "セッションの有効期限が切れました。もう一度ログインしてください";

/**
 * 失効をトーストで知らせる。api.ts が tokenStore.expire() が true を返したときだけ呼ぶ。
 * 1 回の失効につき 1 回になるのは expire() の側が保証している（並行した 401 の 2 本目以降は false）。
 */
export function notifySessionExpired(): void {
  toast.error(SESSION_EXPIRED_MESSAGE);
}
