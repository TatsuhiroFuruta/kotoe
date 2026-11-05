"use client";

import { useId } from "react";

import { buttonClasses } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";

/**
 * 確認ダイアログ。ブラウザの confirm() は使わない（7-6b 設計書 決定 5）。
 * 開閉・Esc・送信中の扱いは ModalDialog が持つ。
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
  const titleId = useId();

  return (
    <ModalDialog open={open} pending={pending} labelledBy={titleId} onCancel={onCancel}>
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
    </ModalDialog>
  );
}
