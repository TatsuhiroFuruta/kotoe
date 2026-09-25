"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { buttonClasses } from "@/components/ui/button";
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
      {/*
        高さを固定せず（min-h-14）、収まらなければ右側を次の行へ折り返す。
        375px 幅の中身は 343px しかなく、unreachable の右側（文言＋ボタン 2 つ）は
        それだけで約 366px ある。h-14 固定の 1 行だと、はみ出した分がページ全体の
        横スクロールになっていた（7-3a で左に「探す」を足して起きやすくなった）。
      */}
      <div className="mx-auto flex min-h-14 w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
        <div className="flex shrink-0 items-center gap-6">
          <Link href="/" className="text-lg font-semibold tracking-tight text-ink">
            Kotoe
          </Link>

          {/*
            ナビのリンクは、そのルートを作る issue がここに足す。
            7-5:「お題を投稿」→ /posts/new ／ 7-6: アバター → /mypage ／
            7-7:「ランキング」→ /rankings。
            main は Vercel の本番を追跡するので、存在しないルートへのリンクは置かない
            （置いた瞬間に本番で 404 になる）。

            「探す」は認証状態に関係なく出す。一覧は誰でも見られる。
          */}
          <nav aria-label="メイン" className="flex items-center gap-4 text-sm">
            <Link href="/posts" className="text-ink-muted hover:text-ink">
              探す
            </Link>
          </nav>
        </div>

        {/* 左の「メイン」と並ぶ 2 つ目のナビ。ランドマークの一覧で区別できるよう名前を付ける */}
        <nav
          aria-label="アカウント"
          className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 text-sm"
        >
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
                className={buttonClasses({ size: "sm" })}
              >
                新規登録
              </Link>
            </>
          )}

          {auth.status === "authenticated" && (
            <>
              {/*
                公開 UGC。React が自動でエスケープするので、そのまま置いてよい。
                name には長さの上限が無い（presence だけ）。空白を含まない長い名前でも
                1 行に収まるよう幅を切り、全文は title で読めるようにする。
              */}
              <span className="max-w-40 truncate text-ink-muted" title={auth.user.name}>
                {auth.user.name}
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                ログアウト
              </button>
            </>
          )}

          {/*
            unreachable で「ログイン」を出さないのが要点。この状態では
            tokenStore にトークンが残っており api.ts は Authorization を載せ続けるので、
            「ログイン」を出すと表示と実際の通信が食い違う。

            この状態には timeout 経由で来るのが最多になる（Render のコールド
            スタート）。文言を「接続できません」から「応答がありません」に
            寄せてあるのはそのため。通信断の場合にも当てはまるので、
            経路ごとの出し分けはしない（unreachable は理由を持っていない）。
          */}
          {auth.status === "unreachable" && (
            <>
              <span className="text-ink-muted">サーバーの応答がありません</span>
              <button
                type="button"
                onClick={auth.retryRestore}
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                再試行
              </button>
              {/*
                この状態からの脱出口。再試行を何度押しても復帰しないとき、これが
                無いと全ページのヘッダーが unreachable のままになり、ログイン画面へ
                向かう導線もアプリ内に存在しなくなる（トップの CTA も
                unauthenticated のときしか出ない）。signOut() は失効の API 呼び出しに
                失敗しても finally でローカルのトークンを必ず捨てるので、
                サーバーに届かない状態でも unauthenticated へ抜けられる。
              */}
              <button
                type="button"
                onClick={handleSignOut}
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                ログアウト
              </button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
