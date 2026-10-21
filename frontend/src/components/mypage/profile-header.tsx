"use client";

import { useEffect, useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { apiFetch } from "@/lib/api";
import { toRequestErrorMessage } from "@/lib/request-error-messages";
import type { MeResponse } from "@/types/api";

type Outcome =
  | { kind: "success"; stats: MeResponse["stats"] }
  | { kind: "error"; message: string };

const API_PATH = "/api/me";

/**
 * プロフィールの見出しと統計。名前は呼び出し側（useAuth）から受け取り、
 * /api/me の応答を待たずに出す。統計だけを自分で取る。
 *
 * 取得の形は PostList と同じ（結果を { key, outcome } で持ち、今の key と
 * 一致するものだけ表示する。effect の中で同期的に setState しないため）。
 * 統計の取得に失敗しても、一覧（隣の MypageList）には影響させない。
 */
export function ProfileHeader({ name }: { name: string }) {
  const [retryCount, setRetryCount] = useState(0);
  const requestKey = `${API_PATH}#${retryCount}`;
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    apiFetch<MeResponse>(API_PATH, { signal: controller.signal })
      .then((me) => setResult({ key: requestKey, outcome: { kind: "success", stats: me.stats } }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key: requestKey,
          outcome: { kind: "error", message: toRequestErrorMessage(error) },
        });
      });

    return () => controller.abort();
  }, [requestKey]);

  const outcome = result?.key === requestKey ? result.outcome : null;

  return (
    <section className="flex items-center gap-4">
      <UserAvatar name={name} size="lg" />
      <div className="min-w-0 flex-1">
        <h1 className="wrap-break-word text-2xl font-semibold tracking-tight text-ink">{name}</h1>

        {outcome === null && (
          <div aria-busy="true" aria-label="読み込み中" className="mt-2 flex gap-4">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-4 w-20 animate-pulse rounded bg-line" />
            ))}
          </div>
        )}

        {outcome?.kind === "error" && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
            <p>{outcome.message}</p>
            <button
              type="button"
              onClick={() => setRetryCount((count) => count + 1)}
              className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
            >
              再試行
            </button>
          </div>
        )}

        {outcome?.kind === "success" && (
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
            <Stat label="投稿したお題" value={outcome.stats.posts_count} />
            <Stat label="挑戦" value={outcome.stats.attempts_count} />
            <Stat label="獲得いいね" value={outcome.stats.likes_received_count} />
          </dl>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex gap-1">
      <dt>{label}</dt>
      <dd className="font-medium text-ink tabular-nums">{value}</dd>
    </div>
  );
}
