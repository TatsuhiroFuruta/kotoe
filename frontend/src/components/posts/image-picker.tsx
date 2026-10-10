"use client";

import { useEffect, useRef, useState, type DragEvent, type Ref } from "react";

import { buttonClasses } from "@/components/ui/button";
import { IMAGE_ACCEPT } from "@/lib/posts/image-file-check";

/**
 * 選んだファイルのプレビュー。
 *
 * object URL は effect で作って img に直接入れ、effect の後片づけで解放する。
 * - state に入れると effect の中で setState することになる（react-hooks の set-state-in-effect）
 * - useMemo で作って effect で解放すると、開発時の StrictMode が「アンマウント → 再マウント」を
 *   模擬したときに解放だけが走り、memo は作り直されないのでプレビューが壊れる
 * effect で作れば、再マウントのたびに作り直されるのでどちらも起きない。
 *
 * 親は選び直すたびに key を変えるので、previewFailed は新しいファイルで必ず false から始まる。
 */
function FilePreview({ file }: { file: File }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (imageRef.current !== null) imageRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (previewFailed) {
    // Safari 以外は HEIC を <img> で描けない。壊れた画像のアイコンを出さずに、プレビューできないことを伝える。
    // ファイル名は利用者が自由に付けられる文字列なので、{value} で出すだけにする（属性・URL に入れない）。
    return (
      <div className="flex flex-col items-center gap-1 rounded-card bg-line px-4 py-8 text-center text-sm">
        <p className="text-ink">この画像はプレビューできません</p>
        <p className="max-w-full truncate text-ink-muted">{file.name}</p>
        {/*
          このファイルについて「投稿できる」とは言わない。種類の分からないファイルは確認を
          素通りする（image-file-check.ts）ので、名前で判断して約束するとバックの 422 と食い違う。
          HEIC を選んだ人が不安にならないよう、一般的な事実として添えるだけにする。
        */}
        <p className="text-ink-muted">HEIC・HEIF はブラウザによってプレビューできませんが、そのまま投稿できます</p>
      </div>
    );
  }

  return (
    // next/image ではなく <img>（7-3a 決定 4）。枠は画像そのものの縦横比にする（PostHero と同じ）。
    // 固定の枠に object-contain で収めると、縦長・正方形の写真で左右に帯が出る。
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imageRef}
      alt="選んだ画像のプレビュー"
      onError={() => setPreviewFailed(true)}
      className="mx-auto block h-auto max-h-80 w-auto max-w-full rounded-card"
    />
  );
}

/**
 * 画像欄。クリックで選ぶ・ドラッグ＆ドロップ・プレビュー。
 *
 * ファイルを受け取ったら onSelect に渡すだけで、確認（サイズ・形式）はしない。
 * 確認は PostForm が checkImageFile で行う（選択とドロップを同じ確認に通すため）。
 *
 * <input type="file"> は見た目を隠し（sr-only）、<label htmlFor> を押せる範囲にする。
 * input 自体はフォーカスを受けられるので、キーボードでも Enter / Space で選べる。
 * フォーカスの見た目は、外枠の focus-within で出す。
 */
export function ImagePicker({
  inputId,
  inputRef,
  selection,
  disabled,
  error,
  onSelect,
}: {
  inputId: string;
  inputRef: Ref<HTMLInputElement>;
  /** 確認を通ったファイル。id は選び直すたびに変わる（プレビューの key） */
  selection: { file: File; id: number } | null;
  disabled: boolean;
  error: string | null;
  onSelect: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    // これを止めないと drop が発火せず、ブラウザがファイルを開いて画面を離れる。
    event.preventDefault();
    if (!disabled) setDragging(true);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    // 複数落とされたら先頭の 1 枚だけを使う。
    const file = event.dataTransfer.files[0];
    if (file !== undefined) onSelect(file);
  }

  const describedBy = [error !== null ? errorId : null, hintId]
    .filter((id): id is string => id !== null)
    .join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">画像</span>

      <div
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center gap-3 rounded-card border-2 border-dashed p-4 focus-within:ring-2 focus-within:ring-accent ${
          dragging ? "border-accent" : error !== null ? "border-danger" : "border-line"
        }`}
      >
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // 値を空に戻す。戻さないと、弾かれたファイルと同じものを選び直したときに
            // change が発火せず、何も起きないように見える。
            event.target.value = "";
            if (file !== undefined) onSelect(file);
          }}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={describedBy}
          className="sr-only"
        />

        {selection === null ? (
          <label
            htmlFor={inputId}
            className="flex w-full cursor-pointer flex-col items-center gap-1 py-8 text-center"
          >
            <span className={buttonClasses({ variant: "secondary", size: "sm" })}>画像を選ぶ</span>
            <span className="text-sm text-ink-muted">またはここにドロップ</span>
          </label>
        ) : (
          <>
            <FilePreview key={selection.id} file={selection.file} />
            <label
              htmlFor={inputId}
              className={`cursor-pointer text-sm ${buttonClasses({ variant: "secondary", size: "sm" })}`}
            >
              選び直す
            </label>
          </>
        )}
      </div>

      <p id={hintId} className="text-sm text-ink-muted">
        JPEG・PNG・WebP・HEIC、5MB まで
      </p>
      {error !== null && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
