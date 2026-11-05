"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * モーダルの枠。ネイティブの <dialog> を showModal() で開き、フォーカスの閉じ込めと
 * 背後の操作の無効化をブラウザに任せる（7-6b 設計書 決定 5）。中身は呼び出し側が組む
 * （確認ダイアログ・タイトル編集で、Esc と送信中の扱いを 1 か所に揃えるために切り出した）。
 *
 * 開閉の正は open prop。Esc（cancel イベント）は既定の閉じる動作を止めて onCancel に渡す。
 * 止められずにブラウザが閉じた場合は onClose で揃える（下のコメント）。pending の間は Esc でも閉じない
 * （送信中に閉じると、結果を見せる場所が無くなる）。
 */
export function ModalDialog({
  open,
  pending,
  labelledBy,
  onCancel,
  children,
}: {
  open: boolean;
  pending: boolean;
  /** 見出しの id。aria-labelledby に渡す */
  labelledBy: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      // preventDefault が効かずにブラウザが閉じることがある。ユーザー操作を挟まずに Esc を 2 回押すと、
      // 2 回目の cancel は取り消せない（Chrome で実測、2026-10-30）。open が真のまま閉じると、
      // 送信の失敗が閉じたダイアログの中に出て見えず、次に開くボタンを押しても開かない。
      // 送信中なら開き直し、そうでなければ「やめる」と同じに扱って state を揃える。
      onClose={() => {
        if (!open) return;
        if (pending) dialogRef.current?.showModal();
        else onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-card border border-line bg-surface p-6 text-ink backdrop:bg-ink/40"
    >
      {children}
    </dialog>
  );
}
