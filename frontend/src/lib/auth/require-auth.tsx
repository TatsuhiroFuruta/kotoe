"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { buttonClasses } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { loginPathFor } from "@/lib/auth/login-reason";

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

  // 失効でログイン画面へ送るときは、理由を ?reason=expired で運ぶ（7-2.6 決定 3）。
  // effect の依存に入れるため、narrowing した結果を外で取り出しておく。
  const expired = auth.status === "unauthenticated" && auth.expired;

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
    router.replace(loginPathFor(current, expired));
    // pathname を依存に残すのは、クライアント遷移でここが再評価されるようにするため。
  }, [auth.status, expired, pathname, router]);

  if (auth.status === "unreachable") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="text-ink-muted">サーバーの応答がありません。</p>
        <button
          type="button"
          onClick={auth.retryRestore}
          className={`${buttonClasses()} text-sm`}
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
