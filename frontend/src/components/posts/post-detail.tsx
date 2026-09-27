"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AttemptList, type AttemptListState } from "@/components/attempts/attempt-list";
import { BestAttempts } from "@/components/attempts/best-attempts";
import { PostHero } from "@/components/posts/post-hero";
import { buttonClasses } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { postDetailApiPath, type PostDetailQuery } from "@/lib/posts/post-detail-query";
import { postsHref } from "@/lib/posts/posts-query";
import { toRequestErrorMessage } from "@/lib/request-error-messages";
import type { PostDetailResponse } from "@/types/api";

type Outcome =
  | { kind: "success"; data: PostDetailResponse }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

/**
 * お題詳細。取得はクライアントで 1 本だけ行う（7-3b 設計書「決定 1」）。
 *
 * 結果は 7-3a の PostList と同じく「どのリクエストの結果か」を表す key と一緒に持ち、
 * 今の key と一致しないものは表示しない（effect の中で同期的に setState しない。
 * react-hooks の set-state-in-effect と、古い応答による上書きの両方を避ける）。
 *
 * それに加えて、最後に成功した応答をお題 id と一緒に持つ（決定 2）。同じお題の再取得中
 * （並び替え・ページ送り・再試行）は、それでヒーローと表彰台を出し続け、みんなの挑戦だけを
 * 読み込み中にする。7-3c の描写フォームは書きかけの文面と生成中のポーリングを持つので、
 * 並び替えのたびにアンマウントされると両方が消える。
 *
 * 詳細 API は認証不要で、期限切れのトークンを付けても 200 を返す（2026-09-27 実測）。
 * そのため auth.status の確定を待たずに取得を始めてよい。favorited は tokenStore の
 * トークンで判定されるので、確定を待たなくても正しい値が返る。
 */
export function PostDetail({ postId, query }: { postId: number; query: PostDetailQuery }) {
  const apiPath = postDetailApiPath(postId, query);
  const [retryCount, setRetryCount] = useState(0);
  const requestKey = `${apiPath}#${retryCount}`;
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);
  const [lastSuccess, setLastSuccess] = useState<{ postId: number; data: PostDetailResponse } | null>(
    null,
  );
  // お気に入りの操作結果。取得し直した応答より新しいので、こちらを優先する。
  // 別のお題の値を持ち越さないよう、お題 id と一緒に持つ。
  const [favoritedOverride, setFavoritedOverride] = useState<{ postId: number; value: boolean } | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();

    apiFetch<PostDetailResponse>(apiPath, { signal: controller.signal })
      .then((data) => {
        setResult({ key: requestKey, outcome: { kind: "success", data } });
        setLastSuccess({ postId, data });
      })
      .catch((error: unknown) => {
        // 自分で中断した（クエリが変わった／アンマウントした）ものは失敗ではない。
        if (controller.signal.aborted) return;
        // 404 は削除済み・存在しないお題。待っても変わらないので再試行を出さない。
        const outcome: Outcome =
          error instanceof ApiError && error.status === 404
            ? { kind: "not_found" }
            : { kind: "error", message: toRequestErrorMessage(error) };
        setResult({ key: requestKey, outcome });
      });

    return () => controller.abort();
  }, [apiPath, requestKey, postId]);

  const outcome = result?.key === requestKey ? result.outcome : null;
  const retry = () => setRetryCount((count) => count + 1);

  if (outcome?.kind === "not_found") return <PostNotFound />;

  // 今のリクエストが成功していればそれを、まだ（または失敗）なら同じお題の直前のデータを使う。
  const current =
    outcome?.kind === "success"
      ? outcome.data
      : lastSuccess?.postId === postId
        ? lastSuccess.data
        : null;

  if (current === null) {
    // 初回の失敗はページ全体に出す（出せるデータが何も無い）。
    if (outcome?.kind === "error") {
      return <ErrorPanel message={outcome.message} onRetry={retry} />;
    }
    return <PostDetailSkeleton />;
  }

  const listState: AttemptListState =
    outcome === null
      ? { kind: "loading" }
      : outcome.kind === "error"
        ? { kind: "error", message: outcome.message }
        : { kind: "ready", attempts: outcome.data.attempts, meta: outcome.data.meta };

  const favorited =
    favoritedOverride?.postId === postId ? favoritedOverride.value : current.post.favorited;

  return (
    <div className="flex flex-col gap-10">
      <PostHero
        post={current.post}
        favorited={favorited}
        onFavoritedChange={(value) => setFavoritedOverride({ postId, value })}
      />
      <BestAttempts attempts={current.best_attempts} />
      {/*
        7-3c：描写フォームはここに入る。current が確定した後はこの位置が再取得で
        アンマウントされないので、書きかけの文面と生成中のポーリングが保たれる。
      */}
      <AttemptList postId={postId} query={query} state={listState} onRetry={retry} />
    </div>
  );
}

function PostDetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="読み込み中" className="flex flex-col gap-4">
      <div className="aspect-4/3 w-full animate-pulse rounded-card bg-line" />
      <div className="h-8 w-2/3 animate-pulse rounded bg-line" />
      <div className="h-4 w-1/3 animate-pulse rounded bg-line" />
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-line bg-surface p-8 text-center">
      <p className="text-ink">{message}</p>
      <button type="button" onClick={onRetry} className={buttonClasses({ variant: "secondary" })}>
        再試行
      </button>
    </div>
  );
}

function PostNotFound() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-10 text-center">
      <p className="text-ink">お題が見つかりませんでした。削除された可能性があります</p>
      <Link href={postsHref()} className="text-accent hover:text-accent-strong">
        お題を探す
      </Link>
    </div>
  );
}
