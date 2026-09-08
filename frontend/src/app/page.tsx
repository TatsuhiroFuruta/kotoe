"use client";

import Link from "next/link";

import { HealthPanel } from "@/components/dev/health-panel";
import { useAuth } from "@/lib/auth/auth-context";

/**
 * 疎通確認パネルを出すかどうか。
 *
 * NEXT_PUBLIC_VERCEL_ENV は Vercel が自動で入れる変数で、本番のビルドでは
 * "production"、プレビューのビルドでは "preview"、ローカルでは未定義になる。
 * つまりローカルとプレビューでは今まで通り表示され、本番でだけ消える。
 * NEXT_PUBLIC_* はビルド時に値が埋め込まれるので、この条件は定数に畳まれる。
 *
 * 本来のトップ（ヒーロー＋遊び方＋新着/人気）は 7-7。それまでこのページが
 * 本番のトップになるため、デバッグ用のパネルを出しっぱなしにしない。
 */
const SHOW_HEALTH_PANEL = process.env.NEXT_PUBLIC_VERCEL_ENV !== "production";

export default function Home() {
  const auth = useAuth();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 p-8">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          言葉だけで、その絵を伝えられますか。
        </h1>
        <p className="mt-3 text-ink-muted">
          画像を言葉で描写すると、その言葉から AI が画像を再現します。どれだけ近づけるかを競うゲームです。
        </p>

        {/*
          CTA もナビと同じ方針で、実在するルートだけを出す。「お題を探す」→ /posts は
          7-3 が、「お題を投稿」→ /posts/new は 7-5 がここに足す。
        */}
        {auth.status === "unauthenticated" && (
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/signup"
              className="rounded-card bg-accent px-5 py-2.5 font-medium text-white hover:bg-accent-strong"
            >
              新規登録
            </Link>
            <Link
              href="/login"
              className="rounded-card border border-line px-5 py-2.5 font-medium text-ink-muted hover:text-ink"
            >
              ログイン
            </Link>
          </div>
        )}
      </div>

      {SHOW_HEALTH_PANEL && <HealthPanel />}
    </main>
  );
}
