"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth/auth-context";

export function SiteHeader() {
  const auth = useAuth();
  const router = useRouter();

  async function handleSignOut() {
    await auth.signOut();

    // signOut() だけだと、ガード付きページ（7-5 以降の /posts/new・/mypage）からは
    // RequireAuth によって /login?next=... へ送られる。「抜ける」という意思表示に
    // 対してログインを促す画面を出すことになるので、認証不要なトップへ明示的に戻す。
    // replace ではなく push なのは、戻るボタンで直前のページに戻れてよいため
    //（ログアウト済みなので、そこで見えて困るものは無い）。
    router.push("/");
  }

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-semibold tracking-tight text-ink">
          Kotoe
        </Link>

        {/*
          中央のリンクは、そのルートを作る issue がここに足す。
          7-3: 「探す」→ /posts ／ 7-5:「お題を投稿」→ /posts/new ／
          7-6: アバター → /mypage ／ 7-7:「ランキング」→ /rankings。
          main は Vercel の本番を追跡するので、存在しないルートへのリンクは置かない
          （置いた瞬間に本番で 404 になる）。
        */}

        <nav className="flex items-center gap-3 text-sm">
          {/*
            loading のあいだはスケルトンを出す。SSR と初回クライアント描画は
            どちらも loading なので、ここで描くものが食い違うことはない。
          */}
          {auth.status === "loading" && (
            <span className="h-4 w-24 rounded bg-line" aria-hidden="true" />
          )}

          {auth.status === "unauthenticated" && (
            <>
              <Link href="/login" className="text-ink-muted hover:text-ink">
                ログイン
              </Link>
              <Link
                href="/signup"
                className="rounded-card bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-strong"
              >
                新規登録
              </Link>
            </>
          )}

          {auth.status === "authenticated" && (
            <>
              {/* 公開 UGC。React が自動でエスケープするので、そのまま置いてよい */}
              <span className="text-ink-muted">{auth.user.name}</span>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-card border border-line px-3 py-1.5 text-ink-muted hover:text-ink"
              >
                ログアウト
              </button>
            </>
          )}

          {/*
            unreachable で「ログイン」を出さないのが要点。この状態では
            tokenStore にトークンが残っており api.ts は Authorization を載せ続けるので、
            「ログイン」を出すと表示と実際の通信が食い違う。
          */}
          {auth.status === "unreachable" && (
            <>
              <span className="text-ink-muted">サーバーに接続できません</span>
              <button
                type="button"
                onClick={auth.retryRestore}
                className="rounded-card border border-line px-3 py-1.5 text-ink-muted hover:text-ink"
              >
                再試行
              </button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
