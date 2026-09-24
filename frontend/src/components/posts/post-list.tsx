"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Pagination } from "@/components/posts/pagination";
import { PostCard } from "@/components/posts/post-card";
import { PostSearchForm } from "@/components/posts/post-search-form";
import { PostSortToggle } from "@/components/posts/post-sort-toggle";
import { buttonClasses } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { postsApiPath, postsHref, type PostsQuery } from "@/lib/posts/posts-query";
import { toRequestErrorMessage } from "@/lib/request-error-messages";
import type { PostsIndexResponse } from "@/types/api";

const SKELETON_COUNT = 12; // サーバーの 1 ページの件数と同じ。レイアウトが跳ねないように

type Outcome =
  | { kind: "success"; data: PostsIndexResponse }
  | { kind: "error"; message: string };

/**
 * お題一覧。取得はクライアントで行う（設計書「決定 1」）。
 *
 * 結果は「どのリクエストに対する結果か」を表す key と一緒に持ち、今の key と
 * 一致しないものは表示しない（＝取得中として扱う）。effect の中で同期的に
 * setState({ kind: "loading" }) を呼ぶ形にしないのは 2 つの理由から。
 *   1. eslint-plugin-react-hooks 7 の set-state-in-effect に当たる
 *   2. 並び替えを素早く切り替えたとき、古いクエリの応答が後から届いても
 *      key が違うので画面に出ない（cleanup の abort が間に合わなかった場合の保険）
 *
 * 一覧 API は認証不要で、期限切れのトークンを付けても 200 を返す（2026-09-23 実測）。
 * そのため auth.status の確定を待たずに取得を始めてよい。
 */
export function PostList({ query }: { query: PostsQuery }) {
  const apiPath = postsApiPath(query);
  const [retryCount, setRetryCount] = useState(0);
  const requestKey = `${apiPath}#${retryCount}`;
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    apiFetch<PostsIndexResponse>(apiPath, { signal: controller.signal })
      .then((data) => setResult({ key: requestKey, outcome: { kind: "success", data } }))
      .catch((error: unknown) => {
        // 自分で中断した（クエリが変わった／アンマウントした）ものは失敗ではない。
        if (controller.signal.aborted) return;
        setResult({
          key: requestKey,
          outcome: { kind: "error", message: toRequestErrorMessage(error) },
        });
      });

    return () => controller.abort();
  }, [apiPath, requestKey]);

  const outcome = result?.key === requestKey ? result.outcome : null;

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PostSearchForm query={query} />
        <PostSortToggle query={query} />
      </div>

      {outcome === null && <PostGridSkeleton />}

      {outcome?.kind === "error" && (
        <div className="flex flex-col items-center gap-4 rounded-card border border-line bg-surface p-8 text-center">
          <p className="text-ink">{outcome.message}</p>
          <button
            type="button"
            onClick={() => setRetryCount((count) => count + 1)}
            className={buttonClasses({ variant: "secondary" })}
          >
            再試行
          </button>
        </div>
      )}

      {outcome?.kind === "success" && <PostResults query={query} data={outcome.data} />}
    </div>
  );
}

function PostGridSkeleton() {
  return (
    <ul
      aria-busy="true"
      aria-label="読み込み中"
      className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <li key={index} className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="aspect-4/3 w-full animate-pulse bg-line" />
          <div className="flex flex-col gap-2 p-4">
            <div className="h-5 w-3/4 animate-pulse rounded bg-line" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-line" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function PostResults({ query, data }: { query: PostsQuery; data: PostsIndexResponse }) {
  const { posts, meta } = data;

  // 範囲外のページ（?page=99）。posts は空だが、お題自体は存在する。
  // 「お題がありません」と出すと嘘になるので分ける。
  if (posts.length === 0 && meta.total_count > 0) {
    return (
      <EmptyState message="このページにはお題がありません">
        <Link href={postsHref({ ...query, page: 1 })} className="text-accent hover:text-accent-strong">
          1 ページ目へ
        </Link>
      </EmptyState>
    );
  }

  if (posts.length === 0 && query.q !== "") {
    return (
      // 検索語は公開 UGC ではないが URL から誰でも書ける値。{value} のまま置く。
      <EmptyState message={`「${query.q}」に一致するお題はありません。条件を変えて探してみましょう`}>
        <Link href={postsHref({ sort: query.sort })} className="text-accent hover:text-accent-strong">
          検索をクリア
        </Link>
      </EmptyState>
    );
  }

  if (posts.length === 0) {
    // 投稿への導線は置かない。/posts/new は 7-5 で作る（存在しないルートにリンクしない）。
    return <EmptyState message="まだお題がありません" />;
  }

  return (
    <>
      <p className="text-sm text-ink-muted">全 {meta.total_count} 件</p>
      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <li key={post.id}>
            <PostCard post={post} />
          </li>
        ))}
      </ul>
      <Pagination query={query} totalPages={meta.total_pages} />
    </>
  );
}

function EmptyState({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-10 text-center">
      <p className="wrap-break-word text-ink-muted">{message}</p>
      {children}
    </div>
  );
}
