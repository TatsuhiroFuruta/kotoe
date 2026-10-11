"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { ImagePicker } from "@/components/posts/image-picker";
import { buttonClasses } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { apiFetch } from "@/lib/api";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/error-messages";
import { checkImageFile } from "@/lib/posts/image-file-check";
import { postDetailHref } from "@/lib/posts/post-detail-query";
import {
  imageErrorMessage,
  isBlankTitle,
  POST_CREATED_MESSAGE,
  titleErrorMessage,
  toLeftPageFailureMessage,
  toPostFormErrors,
  unconfirmedMessage,
  type PostFormError,
  type PostFormErrors,
} from "@/lib/posts/post-messages";
import { toast } from "@/lib/toast/toast-store";
import type { PostCreateResponse } from "@/types/api";

/**
 * 送信の待ち上限。ブラウザ → Rails（5MB を 1Mbps で約 40 秒）と Rails → Cloudinary
 * （gem の既定 timeout 60 秒）を足して約 100 秒、余裕を見て 120 秒（設計書「決定 3」）。
 * 既定の 15 秒はコールドスタートを早く見切るための値だが、この画面は RequireAuth が
 * /api/me に成功してから出るので、送信の時点でサーバーは起きている。
 */
const POST_TIMEOUT_MS = 120_000;

type FocusField = "image" | "title";

/**
 * お題投稿のフォーム（7-5）。画像とタイトルを multipart で POST /api/posts へ送る。
 *
 * 進み具合（%）は出さない（設計書「決定 1」。fetch は送信の進み具合を取れない）。
 */
export function PostForm() {
  const router = useRouter();
  const baseId = useId();
  const imageInputId = `${baseId}-image`;
  const titleInputId = `${baseId}-title`;

  const [selection, setSelection] = useState<{ file: File; id: number } | null>(null);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<PostFormError | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // 選び直すたびに増やす。プレビューの key にして、前のファイルの状態を持ち越さない。
  const selectionCount = useRef(0);
  // フォーカスの移動先。描画の確定後（effect）に移すのは、エラーの id が aria-describedby に
  // 載ってからにするため（載る前に移すと、スクリーンリーダーがエラーを読まない。7-3c と同じ）。
  const [focusRequest, setFocusRequest] = useState<{ field: FocusField; count: number } | null>(
    null,
  );
  // 送信中に別のページへ移ったかどうか。移ったあとに成功しても、お題詳細へ連れ戻さない。
  const mountedRef = useRef(false);
  // 二重送信の防止。同じタスクの中で submit が 2 回呼ばれると（requestSubmit() の連続呼び出しで
  // 実測、2026-10-10）、state の submitting はまだ更新前で、POST が 2 本送られお題が 2 件できた。
  // ref は代入した時点で次の呼び出しから見える。state は disabled と「投稿中…」の表示に使う。
  const submittingRef = useRef(false);

  useEffect(() => {
    // StrictMode の模擬的な再マウントでも true に戻るよう、本体で立てる。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ドロップ枠の外にファイルやリンクを落とすと、ブラウザがそれを開いて画面を離れ、入力が消える。
  // フォームを表示している間は、枠の外へのドロップを受け付けない（dropEffect = "none" で
  // カーソルにも出す）。止めないのは、文字列をタイトル欄へ落とす操作だけ。
  // 枠の中は ImagePicker が先に preventDefault するので、defaultPrevented で見分ける。
  useEffect(() => {
    function refuseDrop(event: DragEvent) {
      if (event.defaultPrevented) return;
      const intoTextField =
        event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      const carriesFiles = event.dataTransfer?.types.includes("Files") ?? false;
      if (intoTextField && !carriesFiles) return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "none";
    }
    window.addEventListener("dragover", refuseDrop);
    window.addEventListener("drop", refuseDrop);
    return () => {
      window.removeEventListener("dragover", refuseDrop);
      window.removeEventListener("drop", refuseDrop);
    };
  }, []);

  useEffect(() => {
    if (focusRequest === null) return;
    (focusRequest.field === "image" ? imageInputRef : titleInputRef).current?.focus();
  }, [focusRequest]);

  function requestFocus(field: FocusField) {
    setFocusRequest((previous) => ({ field, count: (previous?.count ?? 0) + 1 }));
  }

  function handleSelect(file: File) {
    const code = checkImageFile(file);
    if (code !== null) {
      // 弾いたファイルは選んだ状態にしない（前に選んでいた画像も外す）。プレビューの下に
      // エラーが出ると、どちらの画像のことか分からなくなるため。
      setSelection(null);
      setImageError(imageErrorMessage(code));
      return;
    }
    selectionCount.current += 1;
    setSelection({ file, id: selectionCount.current });
    setImageError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;

    setFormError(null);
    const missingImage = selection === null;
    const blankTitle = isBlankTitle(title);
    // 画像のエラーは、選んだ時点で弾かれたもの（selection が null に戻っている）を上書きしない。
    if (missingImage && imageError === null) setImageError(imageErrorMessage("image_missing"));
    setTitleError(blankTitle ? titleErrorMessage("blank") : null);
    // missingImage ではなく selection を直接比べる。別名の条件だと、下の selection.file で
    // null の可能性が型から消えないことがある。
    if (selection === null || blankTitle) {
      requestFocus(missingImage ? "image" : "title");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    const body = new FormData();
    body.append("post[title]", title);
    body.append("post[image]", selection.file);

    // try は送信だけを包む。成功のあとの処理（応答の取り出し・遷移）まで包むと、そこで投げた例外が
    // 送信の失敗として表示され、作成済みのお題を押し直して二重にしてしまう。
    let response: PostCreateResponse;
    try {
      response = await apiFetch<PostCreateResponse>("/api/posts", {
        method: "POST",
        body,
        timeoutMs: POST_TIMEOUT_MS,
      });
    } catch (error: unknown) {
      showSubmitError(toPostFormErrors(error));
      return;
    }

    toast.success(POST_CREATED_MESSAGE);
    // replace：戻るボタンで空の投稿フォームに戻ると「投稿が消えた」ように見えるため（決定 6）。
    // submitting は戻さない。遷移が終わるまでの二重送信を防ぐ（ログイン画面と同じ）。
    if (mountedRef.current) router.replace(postDetailHref(response.post.id));
  }

  function showSubmitError(errors: PostFormErrors) {
    submittingRef.current = false;

    // 送信中に画面を離れていたら、フォームはもう無い。成功だけトーストが出て失敗が無言だと、
    // 投稿されたと受け取られるので、失敗もトーストで伝える。
    if (!mountedRef.current) {
      toast.error(toLeftPageFailureMessage(errors));
      return;
    }

    setSubmitting(false);

    if (errors.form?.kind === "session_expired") {
      // api.ts がトークンを捨てたので、RequireAuth がこのあとログイン画面へ送る。
      // 入力は消える（既知の制約。7-2.6・7-3d で扱う）。理由だけは伝える。
      toast.error(SESSION_EXPIRED_MESSAGE);
      return;
    }

    setImageError(errors.image);
    setTitleError(errors.title);
    setFormError(errors.form);
    if (errors.image !== null) {
      // サーバーが画像を弾いたら、選んだ時点で弾いたとき（handleSelect）と同じく選択を外す。
      // 残すとエラーがプレビューの下に出て、押し直すと同じファイルをまた送ってしまう。
      setSelection(null);
      requestFocus("image");
    } else if (errors.title !== null) {
      requestFocus("title");
    }
  }

  return (
    <div className="w-full max-w-lg rounded-card border border-line bg-surface p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-ink">お題を投稿</h1>

      {/*
        noValidate：ブラウザ標準の吹き出し（TextField は required を付ける）ではなく、
        欄の下に同じ見た目でエラーを出すため。画像とタイトルのエラーを同時に出せる。
      */}
      <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-5">
        {formError !== null && formError.kind !== "session_expired" && (
          <div role="alert" className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">
            {formError.kind === "unconfirmed" ? (
              <p>
                {unconfirmedMessage(formError.reason)}{" "}
                {/*
                  新しいタブで開く。同じタブで移ると、この画面の入力（画像・タイトル）が消え、
                  投稿されていなかったときに入れ直しになる。
                */}
                <Link href="/posts" target="_blank" rel="noopener" className="underline">
                  お題一覧を開く（新しいタブ）
                </Link>
              </p>
            ) : (
              <p>{formError.message}</p>
            )}
          </div>
        )}

        <ImagePicker
          inputId={imageInputId}
          inputRef={imageInputRef}
          selection={selection}
          disabled={submitting}
          error={imageError}
          onSelect={handleSelect}
        />

        <TextField
          id={titleInputId}
          ref={titleInputRef}
          label="タイトル"
          type="text"
          value={title}
          onChange={(value) => {
            setTitle(value);
            // 直している最中に、もう当てはまらないエラーと aria-invalid を残さない。
            if (titleError !== null) setTitleError(null);
          }}
          autoComplete="off"
          error={titleError ?? undefined}
        />

        <button type="submit" disabled={submitting} className={`mt-1 ${buttonClasses()}`}>
          {submitting ? "投稿中…" : "投稿する"}
        </button>
      </form>
    </div>
  );
}
