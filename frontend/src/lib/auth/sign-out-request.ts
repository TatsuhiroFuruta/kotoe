import { apiFetch } from "@/lib/api";
import { tokenStore } from "@/lib/auth/token-store";

/**
 * サーバー側でトークンを失効させる（DELETE /api/auth/sign_out）。ローカルのトークンは捨てない
 * （AuthProvider の signOut が成否にかかわらず捨てる）。
 *
 * treatUnauthorizedAsExpiry: false を渡す。前日から開いたままのタブでログアウトを押すと、
 * 送るトークンは既に失効していて 401 が返る。api.ts の既定に任せるとこれを「失効」と判定し、
 * 自分から抜けようとした人に「もう一度ログインしてください」と出してしまう。
 * ログアウトは理由を伝える相手ではない（7-2.6 設計書「経路ごとの見え方」）。
 */
export async function requestSignOut(): Promise<void> {
  if (tokenStore.get() === null) return;

  await apiFetch<null>("/api/auth/sign_out", {
    method: "DELETE",
    treatUnauthorizedAsExpiry: false,
  });
}
