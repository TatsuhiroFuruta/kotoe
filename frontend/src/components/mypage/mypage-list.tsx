"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { DraftCard } from "@/components/mypage/draft-card";
import { MyAttemptCard } from "@/components/mypage/my-attempt-card";
import { PostCard } from "@/components/posts/post-card";
import { buttonClasses } from "@/components/ui/button";
import { CardGridSkeleton } from "@/components/ui/card-grid-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { RetryableError } from "@/components/ui/retryable-error";
import { apiFetch } from "@/lib/api";
import { mypageApiPath, mypageHref, type MypageQuery, type MypageTab } from "@/lib/mypage/mypage-query";
import { toRequestErrorMessage } from "@/lib/request-error-messages";
import type { MyAttemptsResponse, PostsIndexResponse } from "@/types/api";

/** 応答の形はタブで分かれる。tab から kind を決めて詰め、描画は kind で分岐する。 */
type ListData =
  | { kind: "posts"; data: PostsIndexResponse }
  | { kind: "attempts"; data: MyAttemptsResponse };

type Outcome = { kind: "success"; list: ListData } | { kind: "error"; message: string };

const EMPTY_STATES: Record<MypageTab, { message: string; label: string; href: string }> = {
  posts: { message: "まだお題を投稿していません", label: "お題を投稿", href: "/posts/new" },
  attempts: { message: "まだ挑戦していません", label: "お題を探す", href: "/posts" },
  drafts: { message: "保存した下書きはありません", label: "お題を探す", href: "/posts" },
  favorites: { message: "お気に入りしたお題はありません", label: "お題を探す", href: "/posts" },
};

async function fetchList(tab: MypageTab, apiPath: string, signal: AbortSignal): Promise<ListData> {
  if (tab === "posts" || tab === "favorites") {
    return { kind: "posts", data: await apiFetch<PostsIndexResponse>(apiPath, { signal }) };
  }
  return { kind: "attempts", data: await apiFetch<MyAttemptsResponse>(apiPath, { signal }) };
}

/**
 * マイページのタブの中身。取得の形は PostList と同じ。
 *
 * requestKey に API パスを含めるので、タブを素早く切り替えて前のタブの応答が
 * 後から届いても key が一致せず描画されない（cleanup の abort が間に合わない場合の保険）。
 */
export function MypageList({ query }: { query: MypageQuery }) {
  const { tab } = query;
  const apiPath = mypageApiPath(query);
  const [retryCount, setRetryCount] = useState(0);
  const requestKey = `${apiPath}#${retryCount}`;
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchList(tab, apiPath, controller.signal)
      .then((list) => setResult({ key: requestKey, outcome: { kind: "success", list } }))
      .catch((error: unknown) => {
        // 自分で中断した（タブが変わった／アンマウントした）ものは失敗ではない。
        if (controller.signal.aborted) return;
        setResult({
          key: requestKey,
          outcome: { kind: "error", message: toRequestErrorMessage(error) },
        });
      });

    return () => controller.abort();
  }, [tab, apiPath, requestKey]);

  const outcome = result?.key === requestKey ? result.outcome : null;

  return (
    <div className="flex flex-col gap-6">
      {/* 挑戦カードの画像は正方形、お題・下書きのカードは 4:3。 */}
      {outcome === null && <CardGridSkeleton aspect={tab === "attempts" ? "1:1" : "4:3"} />}

      {outcome?.kind === "error" && (
        <RetryableError
          message={outcome.message}
          onRetry={() => setRetryCount((count) => count + 1)}
        />
      )}

      {outcome?.kind === "success" && <ListResults query={query} list={outcome.list} />}
    </div>
  );
}

function ListResults({ query, list }: { query: MypageQuery; list: ListData }) {
  const meta = list.data.meta;
  const itemCount = list.kind === "posts" ? list.data.posts.length : list.data.attempts.length;

  // 範囲外のページ（?page=99）。件数は 0 でないので、空状態の文言とは分ける。
  if (itemCount === 0 && meta.total_count > 0) {
    return (
      <EmptyState message="このページには何もありません">
        <Link href={mypageHref({ tab: query.tab })} className="text-accent hover:text-accent-strong">
          1 ページ目へ
        </Link>
      </EmptyState>
    );
  }

  if (meta.total_count === 0) {
    const empty = EMPTY_STATES[query.tab];
    return (
      <EmptyState message={empty.message}>
        <Link href={empty.href} className={buttonClasses()}>
          {empty.label}
        </Link>
      </EmptyState>
    );
  }

  return (
    <>
      <p className="text-sm text-ink-muted">全 {meta.total_count} 件</p>
      {list.kind === "posts" ? (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.posts.map((post) => (
            <li key={post.id}>
              <PostCard post={post} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.attempts.map((attempt) => (
            <li key={attempt.id}>
              {query.tab === "drafts" ? (
                <DraftCard draft={attempt} />
              ) : (
                <MyAttemptCard attempt={attempt} />
              )}
            </li>
          ))}
        </ul>
      )}
      <Pagination
        page={query.page}
        totalPages={meta.total_pages}
        hrefFor={(page) => mypageHref({ tab: query.tab, page })}
      />
    </>
  );
}
