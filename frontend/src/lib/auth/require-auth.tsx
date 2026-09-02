"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/lib/auth/auth-context";

/**
 * 認証必須ページのガード。画面遷移を知るのはこのファイルだけ。
 *
 * api.ts は失効を検知してもリダイレクトしない。認証不要ページ（お題一覧など）で
 * 期限が切れたときにユーザーを画面から放り出さないため、飛ばすかどうかは
 * ガードを敷いたページだけが決める。
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (auth.status !== "unauthenticated") return;

    // push ではなく replace。push だと、ログイン後に戻るボタンでここへ戻り、
    // また /login へ飛ばされるループができる。
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [auth.status, pathname, router]);

  // レンダリング中に遷移してはいけないので、判定が付くまでは待つ表示を出す。
  // localStorage は SSR で読めないため、この一瞬は localStorage を選んだ
  // 時点で避けられない（設計書「A のコスト」）。
  if (auth.status !== "authenticated") {
    return <p className="p-8 text-zinc-500">読み込み中…</p>;
  }

  return <>{children}</>;
}
