import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";

export type SortOption = { label: string; href: string; active: boolean };

/**
 * 並び替えは <Link>。状態を URL にだけ持たせるので、リロードや戻るボタンで
 * 並びが保たれる。href は呼び出し側が組み立てる（お題一覧とお題詳細で
 * クエリの形が違うため）。切り替えたら 1 ページ目に戻すこと
 * （別の並びの 3 ページ目は、元の 3 ページ目とは無関係な内容になるため）。
 */
export function SortToggle({ options }: { options: SortOption[] }) {
  return (
    <nav aria-label="並び替え" className="flex gap-2">
      {options.map(({ label, href, active }) => (
        <Link
          key={href}
          href={href}
          // "page" ではなく "true"。並び順は「今いるページ」ではなく、選ばれている選択肢のため。
          aria-current={active ? "true" : undefined}
          className={`${buttonClasses({ variant: active ? "primary" : "secondary", size: "sm" })} text-sm`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
