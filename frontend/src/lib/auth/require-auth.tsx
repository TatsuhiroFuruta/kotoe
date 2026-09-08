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
    // 飛ばすのは「未ログインが確定した」ときだけ。unreachable では飛ばさない
    // （トークンはまだ残っており、飛ばすと有効な JWT を持ったままログイン画面へ
    // 追い出される）。7-1 では restoreFailed フラグを併せて見る必要があったが、
    // 状態が分かれたので status だけで判断できる。
    if (auth.status !== "unauthenticated") return;

    // usePathname はクエリを含まない。/posts/1?sort=likes でガードに掛かると
    // ログイン後に並び順が失われるので、location から組み立てる。
    // useSearchParams を使わないのは、静的ページで Suspense 境界を要求し、
    // ローカルでは通るのに本番ビルドだけ落ちるため（設計書の申し送り）。
    const current = `${window.location.pathname}${window.location.search}`;

    // push ではなく replace。push だと、ログイン後に戻るボタンでここへ戻り、
    // また /login へ飛ばされるループができる。
    router.replace(`/login?next=${encodeURIComponent(current)}`);
    // pathname を依存に残すのは、クライアント遷移でここが再評価されるようにするため。
  }, [auth.status, pathname, router]);

  if (auth.status === "unreachable") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="text-ink-muted">サーバーに接続できませんでした。</p>
        <button
          type="button"
          onClick={auth.retryRestore}
          className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
        >
          再試行
        </button>
      </div>
    );
  }

  if (auth.status !== "authenticated") {
    // レンダリング中に遷移してはいけないので、判定が付くまでは待つ表示を出す。
    // localStorage は SSR で読めないため、この一瞬は localStorage を選んだ
    // 時点で避けられない（7-1 設計書「A のコスト」）。
    return <p className="p-8 text-ink-muted">読み込み中…</p>;
  }

  return <>{children}</>;
}
