"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { HealthResponse } from "@/types/api";

// 疎通確認用の暫定トップページ。issue 7-7 で本来のトップ（ヒーロー＋新着/人気）に差し替える。
// ブラウザから Rails を叩くためクライアントコンポーネントにしている
// （NEXT_PUBLIC_API_BASE_URL は localhost:3000 を指すので、コンテナ内のサーバー側からは解決できない）。

type HealthState =
  | { kind: "loading" }
  | { kind: "success"; health: HealthResponse }
  | { kind: "failure" };

export default function Home() {
  const [state, setState] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    apiFetch<HealthResponse>("/api/health")
      .then((health) => setState({ kind: "success", health }))
      .catch(() => setState({ kind: "failure" }));
  }, []);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Kotoe</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          画像を言葉だけで描写し、その言葉から AI が再現した画像の再現度を競う
        </p>
      </div>

      <section className="w-full max-w-md rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="mb-4 text-sm font-semibold text-zinc-500">Rails API 疎通確認</h2>

        {state.kind === "loading" && <p className="text-zinc-500">確認中…</p>}

        {state.kind === "success" && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-zinc-500">API</dt>
            <dd className="font-mono">{state.health.status}</dd>
            <dt className="text-zinc-500">データベース</dt>
            <dd className="font-mono">{state.health.database}</dd>
          </dl>
        )}

        {state.kind === "failure" && (
          <p className="text-sm text-red-600 dark:text-red-400">
            Rails API に接続できませんでした。`docker compose up` で backend が起動しているか確認してください。
          </p>
        )}
      </section>
    </main>
  );
}
