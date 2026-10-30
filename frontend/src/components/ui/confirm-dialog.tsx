"use client";

import { useEffect, useId, useRef } from "react";

import { buttonClasses } from "@/components/ui/button";

/**
 * 確認ダイアログ。ネイティブの <dialog> を showModal() で開き、フォーカスの閉じ込めと
 * 背後の操作の無効化をブラウザに任せる（7-6b 設計書 決定 5）。ブラウザの confirm() は使わない。
 *
 * 開閉の正は open prop。Esc（cancel イベント）も既定の閉じる動作を止めて onCancel に渡すので、
 * React の state と <dialog> の開閉がずれない。pending の間は Esc でも閉じない
 * （送信中に閉じると、結果を見せる場所が無くなる）。
 */
export function ConfirmDialog({
  open,
  title,
  note,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  note?: string;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      // preventDefault が効かずにブラウザが閉じることがある。ユーザー操作を挟まずに Esc を 2 回押すと、
      // 2 回目の cancel は取り消せない（Chrome で実測、2026-10-30）。open が真のまま閉じると、
      // 送信の失敗が閉じたダイアログの中に出て見えず、次に「削除」を押しても開かない。
      // 送信中なら開き直し、そうでなければ「やめる」と同じに扱って state を揃える。
      onClose={() => {
        if (!open) return;
        if (pending) dialogRef.current?.showModal();
        else onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-card border border-line bg-surface p-6 text-ink backdrop:bg-ink/40"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        {title}
      </h2>
      {note !== undefined && <p className="mt-2 text-sm text-ink-muted">{note}</p>}
      {error !== null && (
        <p role="alert" className="mt-3 rounded-card border border-danger p-3 text-sm text-danger">
          {error}
        </p>
      )}
      {/* 「やめる」を先に置く。showModal() は最初の押せる要素にフォーカスするので、Enter の連打で消えない。 */}
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className={buttonClasses({ variant: "secondary" })}
        >
          やめる
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className={buttonClasses({ variant: "primary" })}
        >
          {pending ? "処理中…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
