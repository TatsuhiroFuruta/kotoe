import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";
import { postsHref, type PostsQuery } from "@/lib/posts/posts-query";

/**
 * 「前へ｜2 / 5｜次へ」。番号の列は作らない（設計書「決定 5」）。
 *
 * 端では <Link> を出さず <span aria-disabled> にする。<Link> には disabled が無く、
 * 見た目だけ薄くしても押せてしまうため。範囲外のページ（?page=99）では
 * 呼び出し側がこの部品を描画しない。
 */
export function Pagination({ query, totalPages }: { query: PostsQuery; totalPages: number }) {
  if (totalPages <= 1) return null;

  const { page } = query;
  const linkClass = `${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`;
  const disabledClass = `${linkClass} pointer-events-none opacity-60`;

  return (
    <nav aria-label="ページ送り" className="flex items-center justify-center gap-4">
      {page > 1 ? (
        <Link href={postsHref({ ...query, page: page - 1 })} className={linkClass}>
          前へ
        </Link>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          前へ
        </span>
      )}

      {/* 「2 / 5」は記号だけだと読み上げで意味が伝わらないので、文で名前を付ける。 */}
      <span className="text-sm text-ink-muted" aria-label={`${totalPages} ページ中 ${page} ページ目`}>
        {page} / {totalPages}
      </span>

      {page < totalPages ? (
        <Link href={postsHref({ ...query, page: page + 1 })} className={linkClass}>
          次へ
        </Link>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          次へ
        </span>
      )}
    </nav>
  );
}
