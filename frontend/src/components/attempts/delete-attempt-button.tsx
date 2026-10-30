"use client";

import { useRef, useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ApiError, apiFetch } from "@/lib/api";
import {
  ATTEMPT_DELETED_MESSAGE,
  DELETE_ATTEMPT_NOTE,
  DELETE_ATTEMPT_TITLE,
  DELETE_DRAFT_TITLE,
  DRAFT_DELETED_MESSAGE,
  fallbackErrorMessage,
} from "@/lib/attempts/attempt-messages";
import { toast } from "@/lib/toast/toast-store";

const COPY = {
  attempt: { title: DELETE_ATTEMPT_TITLE, note: DELETE_ATTEMPT_NOTE, done: ATTEMPT_DELETED_MESSAGE },
  // 下書きはまだ生成回数を使っていないので、回数の注記を付けない（7-6b 設計書 決定 5）。
  draft: { title: DELETE_DRAFT_TITLE, note: undefined, done: DRAFT_DELETED_MESSAGE },
} as const;

/**
 * 挑戦・下書きの「削除」ボタンと確認ダイアログ。マイページの 2 タブと挑戦詳細で使う（決定 3）。
 *
 * 404 は成功と同じに扱う。別のタブで消した・既に消えている、のどちらでも「もう無い」ことに
 * 変わりはなく、失敗と見せると押し直しても直らないエラーが残る（決定 4）。
 */
export function DeleteAttemptButton({
  attemptId,
  kind,
  onDeleted,
}: {
  attemptId: number;
  kind: "attempt" | "draft";
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // state の pending は再描画まで反映されないので、同じタスク内の連打は ref で止める（7-5 と同じ）。
  const sendingRef = useRef(false);
  const copy = COPY[kind];

  function close() {
    setOpen(false);
    setError(null);
    // 開いた「削除」へのフォーカスの復元は、<dialog> の close() に任せる
    // （Esc・「やめる」のどちらでも戻ることを Chrome で確認、2026-10-30）。
  }

  async function handleConfirm() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setPending(true);
    setError(null);

    try {
      await apiFetch<unknown>(`/api/attempts/${attemptId}`, { method: "DELETE" });
    } catch (caught: unknown) {
      if (!(caught instanceof ApiError && caught.status === 404)) {
        sendingRef.current = false;
        setPending(false);
        // 失効。理由のトーストは api.ts が出している（7-2.6）。ダイアログに残しても押し直せない。
        if (caught instanceof ApiError && caught.status === 401) {
          close();
          return;
        }
        setError(fallbackErrorMessage(caught));
        return;
      }
    }

    toast.success(copy.done);
    // 挑戦詳細では、移り先の読み込みが終わるまでこのボタンが残る。送信中のままだと、
    // その間に押し直すと「処理中…」で閉じられないダイアログが開く。
    sendingRef.current = false;
    setPending(false);
    setOpen(false);
    onDeleted();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
      >
        削除
      </button>
      <ConfirmDialog
        open={open}
        title={copy.title}
        note={copy.note}
        confirmLabel="削除する"
        pending={pending}
        error={error}
        onConfirm={handleConfirm}
        onCancel={close}
      />
    </>
  );
}
