import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";
import { postsHref, type PostsQuery, type PostsSort } from "@/lib/posts/posts-query";

const SORT_OPTIONS: { sort: PostsSort; label: string }[] = [
  { sort: "recent", label: "新着順" },
  { sort: "popular", label: "人気順" },
];

/**
 * 並び替えは <Link>。状態を URL にだけ持たせるので、リロードや戻るボタンで
 * 並びが保たれる。切り替えたら 1 ページ目に戻す（page を渡さない）。
 * 別の並びの 3 ページ目は、元の 3 ページ目とは無関係な内容になるため。
 */
export function PostSortToggle({ query }: { query: PostsQuery }) {
  return (
    <nav aria-label="並び替え" className="flex gap-2">
      {SORT_OPTIONS.map(({ sort, label }) => {
        const active = query.sort === sort;
        return (
          <Link
            key={sort}
            href={postsHref({ q: query.q, sort })}
            // "page" ではなく "true"。並び順は「今いるページ」ではなく、選ばれている選択肢のため。
            aria-current={active ? "true" : undefined}
            className={`${buttonClasses({ variant: active ? "primary" : "secondary", size: "sm" })} text-sm`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
