"use client";

import Link from "next/link";
import { useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import type { MeResponse } from "@/types/api";

// 7-1 の動作確認用の暫定 UI。ログイン画面は 7-2 が作るので、それまでの
// つなぎとしてここに最小のフォームを置く。
//
// **7-2 でこのフォルダごと削除すること（7-7 まで残さない）。**
// main は Vercel の本番を追跡しているため、これは本番のトップページに
// 「パスワードが初期値で入った認証パネル」として公開される。7-2 で /login が
// できれば役目は終わるので、露出を 1 issue 分に抑える。

export function AuthProbe() {
  const auth = useAuth();
  const [name, setName] = useState("テスト太郎");
  const [email, setEmail] = useState("probe@example.com");
  const [password, setPassword] = useState("password123");
  const [message, setMessage] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);

  const run = async (label: string, action: () => Promise<void>) => {
    setMessage(`${label}…`);
    try {
      await action();
      setMessage(`${label}: OK`);
    } catch (error) {
      // 文言は本来フロントの辞書が持つ（7-2）。ここは確認用なので生で出す。
      setMessage(
        error instanceof ApiError
          ? `${label}: ${error.status} ${JSON.stringify(error.body)}`
          : `${label}: ${String(error)}`,
      );
    }
  };

  return (
    <section className="w-full max-w-md rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
      <h2 className="mb-4 text-sm font-semibold text-zinc-500">認証疎通確認（暫定）</h2>

      <p className="mb-4 text-sm">
        状態: <span className="font-mono">{auth.status}</span>
        {auth.status === "authenticated" && (
          <span className="font-mono">
            {" "}
            / {auth.user.name}（{auth.user.email}）
          </span>
        )}
      </p>

      {auth.status === "unauthenticated" && (
        <div className="flex flex-col gap-2">
          <input
            className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="名前"
          />
          <input
            className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="メールアドレス"
          />
          <input
            className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="パスワード"
          />
          <div className="flex gap-2">
            <button
              className="rounded bg-zinc-900 px-3 py-1 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
              onClick={() => run("新規登録", () => auth.signUp({ name, email, password }))}
            >
              新規登録
            </button>
            <button
              className="rounded border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
              onClick={() => run("ログイン", () => auth.signIn({ email, password }))}
            >
              ログイン
            </button>
          </div>
        </div>
      )}

      {auth.status === "authenticated" && (
        <div className="flex gap-2">
          <button
            className="rounded border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            onClick={() =>
              run("GET /api/me", async () => {
                setMe(await apiFetch<MeResponse>("/api/me"));
              })
            }
          >
            /api/me を叩く
          </button>
          <button
            className="rounded border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            onClick={() => run("ログアウト", () => auth.signOut())}
          >
            ログアウト
          </button>
        </div>
      )}

      {message && <p className="mt-4 font-mono text-xs break-all">{message}</p>}
      {me && <pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(me, null, 2)}</pre>}

      <Link className="mt-4 block text-sm underline" href="/auth-check">
        /auth-check（ガードの確認）
      </Link>
    </section>
  );
}
