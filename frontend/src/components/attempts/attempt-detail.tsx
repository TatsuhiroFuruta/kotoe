"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AttemptComparison } from "@/components/attempts/attempt-comparison";
import { CopyLinkButton } from "@/components/attempts/copy-link-button";
import { LikeButton } from "@/components/attempts/like-button";
import { buttonClasses } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { attemptDetailHref } from "@/lib/attempts/attempt-detail-query";
import { useAuth } from "@/lib/auth/auth-context";
import { cloudinaryDownloadUrlOrNull } from "@/lib/cloudinary";
import { postDetailHref } from "@/lib/posts/post-detail-query";
import { postsHref } from "@/lib/posts/posts-query";
import { toRequestErrorMessage } from "@/lib/request-error-messages";
import type { Attempt, AttemptShowResponse } from "@/types/api";

type Outcome =
  | { kind: "success"; data: AttemptShowResponse }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

/** いいねの操作結果。取得した値より新しいので、こちらを優先する。 */
type LikeOverride = { attemptId: number; liked: boolean; likesCount: number };

/**
 * 挑戦詳細・比較ビュー。取得はクライアントで 1 本だけ行う（7-4 設計書「決定 1」）。
 *
 * 結果は 7-3b の PostDetail と同じく「どのリクエストの結果か」を表す key と一緒に持ち、
 * 今の key と一致しないものは表示しない（effect の中で同期的に setState しない）。
 *
 * 認証状態の確定は待たずに取得を始める。apiFetch は tokenStore のトークンを同期的に載せるので、
 * liked も「本人にだけ見える未公開の挑戦」も正しく返る。
 */
export function AttemptDetail({ attemptId }: { attemptId: number }) {
  const auth = useAuth();
  const [retryCount, setRetryCount] = useState(0);
  const requestKey = `${attemptId}#${retryCount}`;
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);
  const [likeOverride, setLikeOverride] = useState<LikeOverride | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    apiFetch<AttemptShowResponse>(`/api/attempts/${attemptId}`, { signal: controller.signal })
      .then((data) => setResult({ key: requestKey, outcome: { kind: "success", data } }))
      .catch((error: unknown) => {
        // 自分で中断した（アンマウントした）ものは失敗ではない。
        if (controller.signal.aborted) return;
        // 404 は削除済み・存在しない・他人の未公開・お題が削除済み。待っても変わらないので再試行を出さない。
        const outcome: Outcome =
          error instanceof ApiError && error.status === 404
            ? { kind: "not_found" }
            : { kind: "error", message: toRequestErrorMessage(error) };
        setResult({ key: requestKey, outcome });
      });

    return () => controller.abort();
  }, [attemptId, requestKey]);

  const outcome = result?.key === requestKey ? result.outcome : null;

  if (outcome === null) return <AttemptDetailSkeleton />;
  if (outcome.kind === "not_found") return <AttemptNotFound />;
  if (outcome.kind === "error") {
    return (
      <ErrorPanel message={outcome.message} onRetry={() => setRetryCount((count) => count + 1)} />
    );
  }

  const { post } = outcome.data;
  const fetched = outcome.data.attempt;

  // 本人にだけ返る draft / generating / failed は比較ビューにしない（決定 2）。
  if (fetched.status !== "published") return <AttemptNotPublished postId={post.id} />;

  const attempt: Attempt =
    likeOverride?.attemptId === fetched.id
      ? { ...fetched, liked: likeOverride.liked, likes_count: likeOverride.likesCount }
      : fetched;

  // ダウンロードは本人の挑戦にだけ出す（決定 7。2026-09-30 決定）。
  const isOwner = auth.status === "authenticated" && auth.user.id === attempt.user.id;
  const downloadHref =
    isOwner && attempt.generated_image_public_id !== null
      ? cloudinaryDownloadUrlOrNull(attempt.generated_image_public_id, {
          filename: `kotoe-attempt-${attempt.id}`,
        })
      : null;

  return (
    <article className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={postDetailHref(post.id)}
          className="self-start text-sm text-accent hover:text-accent-strong"
        >
          ← お題に戻る
        </Link>
        {/* 公開 UGC。{value} のまま置く。長い英数字がはみ出さないよう wrap-break-word。 */}
        <h1 className="text-2xl font-semibold tracking-tight wrap-break-word text-ink">
          {post.title}
        </h1>
      </div>

      <AttemptComparison post={post} attempt={attempt} />

      <section aria-labelledby="attempt-description-heading" className="flex flex-col gap-2">
        <h2
          id="attempt-description-heading"
          className="text-sm font-semibold wrap-break-word text-ink-muted"
        >
          {attempt.user.name} さんの描写
        </h2>
        {/* 改行は whitespace-pre-wrap で反映する。<br> に置き換えると XSS になる（CLAUDE.md）。 */}
        <p className="whitespace-pre-wrap wrap-break-word text-ink">{attempt.description}</p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink-muted">
          いいね <span className="font-medium text-ink">{attempt.likes_count}</span>
        </p>
        <LikeButton
          attempt={attempt}
          onChange={(updated) =>
            setLikeOverride({
              attemptId: updated.id,
              liked: updated.liked,
              likesCount: updated.likes_count,
            })
          }
        />
        <CopyLinkButton href={attemptDetailHref(attempt.id)} />
        {downloadHref !== null && (
          // download 属性は付けない（別オリジンでは効かない）。fl_attachment で保存させる。
          <a
            href={downloadHref}
            className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
          >
            ダウンロード（PNG）
          </a>
        )}
      </div>
    </article>
  );
}

function AttemptDetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="読み込み中" className="flex flex-col gap-6">
      <div className="h-8 w-2/3 animate-pulse rounded bg-line" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="aspect-square w-full animate-pulse rounded-card bg-line" />
        <div className="aspect-square w-full animate-pulse rounded-card bg-line" />
      </div>
      <div className="h-4 w-full animate-pulse rounded bg-line" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-line" />
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

function AttemptNotFound() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-10 text-center">
      <p className="text-ink">挑戦が見つかりませんでした。削除された可能性があります</p>
      <Link href={postsHref()} className="text-accent hover:text-accent-strong">
        お題を探す
      </Link>
    </div>
  );
}

function AttemptNotPublished({ postId }: { postId: number }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-10 text-center">
      <p className="text-ink">この挑戦はまだ公開されていません</p>
      <Link href={postDetailHref(postId)} className="text-accent hover:text-accent-strong">
        お題に戻る
      </Link>
    </div>
  );
}
