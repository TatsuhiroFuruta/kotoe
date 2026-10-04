"use client";

import { buttonClasses } from "@/components/ui/button";
import { toast } from "@/lib/toast/toast-store";

const COPIED_MESSAGE = "リンクをコピーしました";
const COPY_FAILED_MESSAGE = "リンクをコピーできませんでした。アドレスバーの URL をコピーしてください";

/**
 * 比較ビューのパーマリンクをコピーする（7-4 設計書「決定 6」）。
 *
 * location.href ではなく、渡されたパスから組み立てる。? や # 付きで開かれたとき、それまで
 * 共有されてしまうため。
 */
export function CopyLinkButton({ href }: { href: string }) {
  async function copy() {
    try {
      // clipboard は https か localhost でしか生えない。LAN 経由の dev サーバー（http、0-6）では
      // undefined になる。その場合も失敗として同じ文言を出す。
      if (typeof navigator.clipboard?.writeText !== "function") {
        throw new Error("Clipboard API is unavailable");
      }
      await navigator.clipboard.writeText(new URL(href, window.location.origin).toString());
      toast.success(COPIED_MESSAGE);
    } catch {
      toast.error(COPY_FAILED_MESSAGE);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
    >
      リンクをコピー
    </button>
  );
}
