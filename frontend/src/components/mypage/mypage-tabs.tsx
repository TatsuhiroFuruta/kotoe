import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";
import { MYPAGE_TABS, mypageHref, type MypageTab } from "@/lib/mypage/mypage-query";

/**
 * role="tablist" にしない。タブを押すと URL が変わるページ遷移であり、tablist の
 * 約束（矢印キーでの移動、Tab で選択中だけに入る）と合わないため。
 * ナビゲーションのリンク群として、選択中を aria-current="page" で示す。
 *
 * href に page を渡さない。タブを切り替えたら 1 ページ目に戻す
 * （別のタブの 3 ページ目は、元の 3 ページ目とは無関係な内容になるため）。
 */
export function MypageTabs({ current }: { current: MypageTab }) {
  return (
    <nav aria-label="マイページのタブ" className="flex flex-wrap gap-2">
      {MYPAGE_TABS.map(({ tab, label }) => {
        const active = tab === current;
        return (
          <Link
            key={tab}
            href={mypageHref({ tab })}
            aria-current={active ? "page" : undefined}
            className={`${buttonClasses({ variant: active ? "primary" : "secondary", size: "sm" })} text-sm`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
