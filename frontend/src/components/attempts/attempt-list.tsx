import Link from "next/link";

import { AttemptCard } from "@/components/attempts/attempt-card";
import { buttonClasses } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { SortToggle } from "@/components/ui/sort-toggle";
import {
  ATTEMPTS_HEADING_ID,
  attemptsSectionHref,
  type AttemptsSort,
  type PostDetailQuery,
} from "@/lib/posts/post-detail-query";
import type { Attempt, PaginationMeta } from "@/types/api";

const SKELETON_COUNT = 6;

const SORT_OPTIONS: { sort: AttemptsSort; label: string }[] = [
  { sort: "recent", label: "新着順" },
  // デザインブリーフの「再現度順（いいね順）」。API の値は likes。
  { sort: "likes", label: "再現度順" },
];

/**
 * 一覧部分の状態。取得は PostDetail が持ち、ここは描き分けだけを行う。
 * 再取得中も見出しと並び替えは出したままにする（失敗したときに別の並びへ逃げられるように）。
 */
export type AttemptListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; attempts: Attempt[]; meta: PaginationMeta };

export function AttemptList({
  postId,
  query,
  state,
  onRetry,
}: {
  postId: number;
  query: PostDetailQuery;
  state: AttemptListState;
  onRetry: () => void;
}) {
  return (
    <section aria-labelledby={ATTEMPTS_HEADING_ID} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-3">
          {/*
            tabIndex={-1}：並び替え・ページ送りの断片（attemptsSectionHref）で Next がここへ
            focus() を呼ぶ。見出しは既定ではフォーカスできないので、無いと押したリンク
            （再取得中はアンマウントされる）と一緒にフォーカスが body へ落ち、キーボードと
            読み上げの利用者は現在地を失う。Tab の巡回には入らない（-1）。
          */}
          <h2
            id={ATTEMPTS_HEADING_ID}
            tabIndex={-1}
            className="text-lg font-semibold text-ink"
          >
            みんなの挑戦
          </h2>
          {state.kind === "ready" && state.meta.total_count > 0 && (
            <p className="text-sm text-ink-muted">全 {state.meta.total_count} 件</p>
          )}
        </div>
        {/*
          並び替えたら 1 ページ目に戻す（page を渡さない）。URL は見出しへの断片付き
          （attemptsSectionHref。先頭のヒーローまで戻されないように）。
        */}
        <SortToggle
          options={SORT_OPTIONS.map(({ sort, label }) => ({
            label,
            href: attemptsSectionHref(postId, { sort }),
            active: query.sort === sort,
          }))}
        />
      </div>

      {state.kind === "loading" && <AttemptGridSkeleton />}

      {state.kind === "error" && (
        <div className="flex flex-col items-center gap-4 rounded-card border border-line bg-surface p-8 text-center">
          <p className="text-ink">{state.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className={buttonClasses({ variant: "secondary" })}
          >
            再試行
          </button>
        </div>
      )}

      {state.kind === "ready" && (
        <AttemptResults postId={postId} query={query} attempts={state.attempts} meta={state.meta} />
      )}
    </section>
  );
}

function AttemptGridSkeleton() {
  return (
    <ul
      aria-busy="true"
      aria-label="読み込み中"
      className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <li key={index} className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="aspect-square w-full animate-pulse bg-line" />
          <div className="flex flex-col gap-2 p-4">
            <div className="h-4 w-full animate-pulse rounded bg-line" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-line" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function AttemptResults({
  postId,
  query,
  attempts,
  meta,
}: {
  postId: number;
  query: PostDetailQuery;
  attempts: Attempt[];
  meta: PaginationMeta;
}) {
  // 範囲外のページ（?page=99）。挑戦自体は存在するので「まだ挑戦がありません」は嘘になる。
  if (attempts.length === 0 && meta.total_count > 0) {
    return (
      <EmptyState message="このページには挑戦がありません">
        <Link
          href={attemptsSectionHref(postId, { sort: query.sort })}
          className="text-accent hover:text-accent-strong"
        >
          1 ページ目へ
        </Link>
      </EmptyState>
    );
  }

  if (attempts.length === 0) {
    // 描写フォームはこのセクションのすぐ上にある（7-3c）。ここに別の導線は置かない。
    return <EmptyState message="まだ挑戦がありません" />;
  }

  return (
    <>
      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {attempts.map((attempt) => (
          <li key={attempt.id}>
            <AttemptCard attempt={attempt} />
          </li>
        ))}
      </ul>
      <Pagination
        page={query.page}
        totalPages={meta.total_pages}
        hrefFor={(page) => attemptsSectionHref(postId, { ...query, page })}
      />
    </>
  );
}

function EmptyState({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-10 text-center">
      <p className="text-ink-muted">{message}</p>
      {children}
    </div>
  );
}
