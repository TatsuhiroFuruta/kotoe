import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";

/**
 * 「前へ｜2 / 5｜次へ」。番号の列は作らない（7-3a 設計書「決定 5」）。
 *
 * URL の組み立ては呼び出し側に任せる（hrefFor）。お題一覧とお題詳細で
 * クエリの形が違う（q の有無・sort の値）ため。
 *
 * 端では <Link> を出さず <span aria-disabled> にする。<Link> には disabled が無く、
 * 見た目だけ薄くしても押せてしまうため。範囲外のページ（?page=99）では
 * 呼び出し側がこの部品を描画しない。totalPages は 0 件のとき 0 で来るが、
 * 下の条件でそのまま何も描かない。
 */
export function Pagination({
  page,
  totalPages,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  const linkClass = `${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`;
  const disabledClass = `${linkClass} pointer-events-none opacity-60`;

  return (
    <nav aria-label="ページ送り" className="flex items-center justify-center gap-4">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={linkClass}>
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
        <Link href={hrefFor(page + 1)} className={linkClass}>
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
