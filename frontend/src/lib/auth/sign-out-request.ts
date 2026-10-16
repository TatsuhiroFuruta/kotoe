import { apiFetch } from "@/lib/api";
import { tokenStore } from "@/lib/auth/token-store";

/**
 * サーバー側でトークンを失効させる（DELETE /api/auth/sign_out）。ローカルのトークンは捨てない
 * （AuthProvider の signOut が成否にかかわらず捨てる）。
 *
 * トークンは自分で Authorization に載せ、api.ts には skipAuth を渡す。api.ts に任せると、
 * 既に失効したトークンでの 401（前日から開いたままのタブでログアウトを押すと必ずこうなる）を
 * 「失効」と判定し、自分から抜けようとした人に「もう一度ログインしてください」と出してしまう。
 * ログアウトは理由を伝える相手ではない（7-2.6 設計書「経路ごとの見え方」）。
 */
export async function requestSignOut(): Promise<void> {
  const token = tokenStore.get();
  if (token === null) return;

  await apiFetch<null>("/api/auth/sign_out", {
    method: "DELETE",
    skipAuth: true,
    headers: { Authorization: `Bearer ${token}` },
  });
}
