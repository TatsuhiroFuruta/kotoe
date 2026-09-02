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

    // 通信断で復元に失敗しただけなら、トークンはまだ残っている。ここで
    // 飛ばすと、有効な JWT を持ったままログイン画面へ追い出される。
    // Render の無料枠はスリープするので、放置後の初回アクセスで現実に起きる。
    if (auth.restoreFailed) return;

    // usePathname はクエリを含まない。/posts/1?sort=likes でガードに掛かると
    // ログイン後に並び順が失われるので、location から組み立てる。
    // useSearchParams を使わないのは、静的ページで Suspense 境界を要求し、
    // ローカルでは通るのに本番ビルドだけ落ちるため（設計書の申し送り）。
    const current = `${window.location.pathname}${window.location.search}`;

    // push ではなく replace。push だと、ログイン後に戻るボタンでここへ戻り、
    // また /login へ飛ばされるループができる。
    router.replace(`/login?next=${encodeURIComponent(current)}`);
    // pathname を依存に残すのは、クライアント遷移でここが再評価されるようにするため。
  }, [auth.status, auth.restoreFailed, pathname, router]);

  if (auth.status !== "authenticated") {
    // 復元に失敗した場合は、リダイレクトせずここで止まる。
    if (auth.restoreFailed) {
      return (
        <p className="p-8 text-zinc-500">
          サーバーに接続できませんでした。ページを再読み込みしてください。
        </p>
      );
    }

    // レンダリング中に遷移してはいけないので、判定が付くまでは待つ表示を出す。
    // localStorage は SSR で読めないため、この一瞬は localStorage を選んだ
    // 時点で避けられない（設計書「A のコスト」）。
    return <p className="p-8 text-zinc-500">読み込み中…</p>;
  }

  return <>{children}</>;
}
