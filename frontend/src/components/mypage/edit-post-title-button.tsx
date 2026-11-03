"use client";

import { useId, useRef, useState, type FormEvent } from "react";

import { buttonClasses } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { TextField } from "@/components/ui/text-field";
import { apiFetch } from "@/lib/api";
import {
  POST_GONE_MESSAGE,
  POST_TITLE_UPDATED_MESSAGE,
  TITLE_EDIT_HINT,
  TITLE_MAX_LENGTH,
  toTitleEditFailure,
} from "@/lib/posts/post-messages";
import { toast } from "@/lib/toast/toast-store";
import type { PostSummary } from "@/types/api";

/**
 * マイページの「投稿したお題」で、お題のタイトルを変えるボタンとダイアログ（3-3）。
 *
 * 文字数の判定はサーバーの 422 に任せる（ルールの正はバック）。空欄はそのまま送り、
 * サーバーが NULL（無題）にする。
 */
export function EditPostTitleButton({
  postId,
  title,
  onUpdated,
  onGone,
}: {
  postId: number;
  title: string | null;
  /** 保存できたあと。一覧を取り直してカードに反映する */
  onUpdated: () => void;
  /** お題が削除されていたとき。一覧から外す */
  onGone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // state の pending は再描画まで反映されないので、同じタスク内の連打は ref で止める（DeleteAttemptButton と同じ）。
  const sendingRef = useRef(false);
  const headingId = useId();
  const inputId = useId();

  function openDialog() {
    // 開くたびに今のタイトルから始める。前回の入力やエラーを持ち越さない。
    setValue(title ?? "");
    setFieldError(null);
    setFormError(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setFieldError(null);
    setFormError(null);
    // 「タイトルを編集」へのフォーカスの復元は <dialog> の close() に任せる（7-6b で確認済み）。
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendingRef.current) return;
    sendingRef.current = true;
    setPending(true);
    setFieldError(null);
    setFormError(null);

    try {
      await apiFetch<{ post: PostSummary }>(`/api/posts/${postId}`, {
        method: "PATCH",
        body: JSON.stringify({ post: { title: value } }),
      });
    } catch (caught: unknown) {
      sendingRef.current = false;
      setPending(false);
      const failure = toTitleEditFailure(caught);
      switch (failure.kind) {
        case "field":
          setFieldError(failure.message);
          return;
        case "form":
          setFormError(failure.message);
          return;
        case "gone":
          close();
          toast.error(POST_GONE_MESSAGE);
          onGone();
          return;
        case "session_expired":
          // 理由のトーストは api.ts が出している（7-2.6）。ダイアログに残しても押し直せない。
          close();
          return;
      }
    }

    sendingRef.current = false;
    setPending(false);
    close();
    toast.success(POST_TITLE_UPDATED_MESSAGE);
    onUpdated();
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={buttonClasses({ variant: "secondary" })}
      >
        タイトルを編集
      </button>
      <ModalDialog open={open} pending={pending} labelledBy={headingId} onCancel={close}>
        <h2 id={headingId} className="text-lg font-semibold">
          タイトルを編集
        </h2>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-2">
          {formError !== null && (
            <p role="alert" className="rounded-card border border-danger p-3 text-sm text-danger">
              {formError}
            </p>
          )}
          {/* 入力欄を「やめる」より前に置く。showModal() は最初の押せる要素にフォーカスする。 */}
          <TextField
            id={inputId}
            label="タイトル（任意）"
            type="text"
            required={false}
            counter={{ length: value.length, max: TITLE_MAX_LENGTH }}
            value={value}
            onChange={(next) => {
              setValue(next);
              // 直している最中に、もう当てはまらないエラーと aria-invalid を残さない。
              if (fieldError !== null) setFieldError(null);
            }}
            autoComplete="off"
            error={fieldError ?? undefined}
          />
          <p className="text-sm text-ink-muted">{TITLE_EDIT_HINT}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              disabled={pending}
              className={buttonClasses({ variant: "secondary" })}
            >
              やめる
            </button>
            <button
              type="submit"
              disabled={pending}
              className={buttonClasses({ variant: "primary" })}
            >
              {pending ? "保存中…" : "保存する"}
            </button>
          </div>
        </form>
      </ModalDialog>
    </>
  );
}
