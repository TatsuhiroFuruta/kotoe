"use client";

import { useSyncExternalStore } from "react";

import { toast, toastStore, type ToastType } from "@/lib/toast/toast-store";

/**
 * 読み上げ用の種別の接頭辞。
 *
 * 視覚的にはアイコンの色と形が種別を伝えるが、読み上げ環境ではこれが唯一の
 * 手がかりになる。色だけで種別を区別しないという決定の、音声側の担保。
 */
const TYPE_LABEL: Record<ToastType, string> = {
  success: "成功：",
  error: "エラー：",
};

/** 種別のアイコン。読み上げは TYPE_LABEL が担うので aria-hidden でよい。 */
function ToastIcon({ type }: { type: ToastType }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className={`mt-0.5 size-5 shrink-0 ${type === "success" ? "text-accent" : "text-danger"}`}
    >
      {type === "success" ? (
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z"
        />
      ) : (
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 6a1 1 0 112 0v5a1 1 0 11-2 0V6zm1 9.5a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5z"
        />
      )}
    </svg>
  );
}

/**
 * トーストの表示先。ルートレイアウトに 1 つだけ置く。
 *
 * createPortal は使わない。ポータルが要るのは祖先に transform / filter /
 * contain があって position: fixed の基準がずれる場合だが、body にも
 * SiteHeader / SiteFooter にもそれらは無いので fixed がそのまま効く。
 * ポータルを足すと SSR とハイドレーションの整合を自前で面倒みることになる。
 */
export function ToastViewport() {
  const toasts = useSyncExternalStore(
    toastStore.subscribe,
    toastStore.get,
    toastStore.getServerSnapshot,
  );

  return (
    /*
      ライブリージョンは <ol> ではなく外側の <div> に置く。role を明示すると
      その要素本来のロールが**置き換わる**ため、<ol role="status"> は list で
      なくなり、中の <li> が list を持たない listitem として浮く（ARIA の
      required context 違反）。実際にアクセシビリティツリーを見ると、
      <ol role="status"> では status > listitem となって list が消え、
      <div role="status"><ol> では status > list > listitem になる。
      読み上げを担保するのがこの issue の要件なので、そこを壊さない形にする。

      空のときも描き続ける。スクリーンリーダーはライブリージョンを DOM に
      見つけた時点で監視を始めるため、リージョンと中身が同時に現れると
      読み上げを取りこぼす。

      aria-atomic="false" の明示が要点。role="status" の既定値は true で、
      そのままだと 2 件目が出たときに領域全体（＝ 1 件目も含めて）読み直される。

      pointer-events-none は、この領域が常時 DOM に居ることの裏返し。
      付けないと画面右下がずっとクリック不能になる。
    */
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50"
    >
      <ol className="flex flex-col gap-2 sm:ml-auto sm:w-96">
        {toasts.map((item) => (
          <li
            key={item.id}
            className="animate-toast-in pointer-events-auto flex items-start gap-2.5 rounded-card border border-line bg-surface p-3 shadow-md"
          >
            <ToastIcon type={item.type} />
            {/* 文言はフロントの辞書（固定文字列）。UGC は入らない */}
            <p className="flex-1 text-sm text-ink">
              <span className="sr-only">{TYPE_LABEL[item.type]}</span>
              {item.message}
            </p>
            <button
              type="button"
              onClick={() => toast.dismiss(item.id)}
              aria-label="通知を閉じる"
              className="-m-1 shrink-0 rounded-card p-1 text-ink-muted hover:text-ink"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="size-4">
                <path d="M6.3 5A.9.9 0 005 6.3L8.7 10 5 13.7A.9.9 0 006.3 15L10 11.3l3.7 3.7a.9.9 0 001.3-1.3L11.3 10 15 6.3A.9.9 0 0013.7 5L10 8.7 6.3 5z" />
              </svg>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
