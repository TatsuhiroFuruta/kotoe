"use client";

import { useEffect, useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast/toast-store";
import type { HealthResponse } from "@/types/api";

type HealthState =
  | { kind: "loading" }
  | { kind: "success"; health: HealthResponse }
  | { kind: "failure" };

/**
 * Rails API への疎通確認パネル。**本番では描画しない**（page.tsx が出し分ける）。
 *
 * コンポーネントごと切り出しているのは、GET /api/health を叩く useEffect を
 * 条件分岐の中に置けないため。出し分けをコンポーネント単位にすれば、本番では
 * effect も動かない。
 *
 * 消さずに残すのは、CLAUDE.md の「PR を出すたび Vercel のプレビュー URL で確認する」
 * を実際に支えているのがこれだから。CORS の許可オリジンや NEXT_PUBLIC_API_BASE_URL
 * の設定ミスは、まずここで見つかる。
 */
export function HealthPanel() {
  const [state, setState] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    apiFetch<HealthResponse>("/api/health")
      .then((health) => setState({ kind: "success", health }))
      .catch(() => setState({ kind: "failure" }));
  }, []);

  return (
    <section className="w-full max-w-md rounded-card border border-line bg-surface p-6">
      <h2 className="mb-4 text-sm font-semibold text-ink-muted">Rails API 疎通確認</h2>

      {state.kind === "loading" && <p className="text-ink-muted">確認中…</p>}

      {state.kind === "success" && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-ink-muted">API</dt>
          <dd className="font-mono">{state.health.status}</dd>
          <dt className="text-ink-muted">データベース</dt>
          <dd className="font-mono">{state.health.database}</dd>
        </dl>
      )}

      {/*
        原因をローカル前提で断定しない。ここはプレビューでも表示され、そこでの
        失敗理由はたいてい CORS の許可オリジンか NEXT_PUBLIC_API_BASE_URL であって、
        backend が起動していないことではない。7-1 のプレビュー確認で実際に
        「docker compose up を確認してください」と案内し、切り分けを遅らせた。
      */}
      {state.kind === "failure" && (
        <p className="text-sm text-danger">
          Rails API に接続できませんでした。ブラウザの Console と Network を確認してください
          （ローカルなら backend の起動、別オリジンなら CORS の許可オリジンと
          NEXT_PUBLIC_API_BASE_URL が主な原因です）。
        </p>
      )}

      {/*
        7-2.5 のトーストの確認用。最初の呼び出し元は 7-3（描写の「保存」）で、
        それまで画面からトーストを出す手段がここにしか無い。7-3 が入ったら
        このブロックは消してよい。

        page.tsx の SHOW_HEALTH_PANEL で出し分けられているので、ローカルと
        Vercel プレビューにだけ出て本番には出ない。
      */}
      <div className="mt-4 flex gap-2 border-t border-line pt-4">
        <button
          type="button"
          onClick={() => toast.success("下書きを保存しました")}
          className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
        >
          成功トースト
        </button>
        <button
          type="button"
          onClick={() => toast.error("画像の生成に失敗しました")}
          className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
        >
          エラートースト
        </button>
      </div>
    </section>
  );
}
