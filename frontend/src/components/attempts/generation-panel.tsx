import { buttonClasses } from "@/components/ui/button";
import { QUOTA_USED_NOTE, failureReasonMessage } from "@/lib/attempts/attempt-messages";
import { cloudinaryDownloadUrlOrNull, cloudinaryUrlOrNull } from "@/lib/cloudinary";
import type { Attempt } from "@/types/api";

// 一覧・表彰台と同じ変換にすると、Cloudinary の派生画像を共有できる（7-3b 設計書「決定 4」）。
const IMAGE_WIDTH = 640;

export type GenerationPanelState =
  | { kind: "generating" }
  | { kind: "published"; attempt: Attempt }
  | { kind: "failed"; attempt: Attempt }
  | { kind: "timed_out" }
  | { kind: "not_found" };

const LEAVE_NOTE = "ページを離れても生成は続きます。完成するとみんなの挑戦に表示されます";

/**
 * 生成の結果（7-3c 設計書「決定 8」）。表示だけを担当し、状態は AttemptComposer が持つ。
 *
 * 読み上げは AttemptComposer の role="status" が短い文で行う。パネル全体を live region に
 * すると、画像の代替テキストやボタンのラベルまで読み上げられるため。
 */
export function GenerationPanel({
  state,
  onStartOver,
  onRecheck,
}: {
  state: GenerationPanelState;
  onStartOver: () => void;
  onRecheck: () => void;
}) {
  return (
    <div className="rounded-card border border-line bg-canvas p-4">
      {state.kind === "generating" && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="aspect-square w-full animate-pulse rounded-card bg-line sm:w-48" />
          <div className="flex flex-col gap-1">
            <p className="font-medium text-ink">生成中…</p>
            <p className="text-sm text-ink-muted">{LEAVE_NOTE}</p>
          </div>
        </div>
      )}

      {state.kind === "published" && (
        <PublishedResult attempt={state.attempt} onStartOver={onStartOver} />
      )}

      {state.kind === "failed" && (
        <div className="flex flex-col gap-3">
          <p className="text-danger">{failureReasonMessage(state.attempt.failure_reason)}</p>
          <p className="text-sm text-ink-muted">{QUOTA_USED_NOTE}</p>
          <StartOverButton onClick={onStartOver} />
        </div>
      )}

      {state.kind === "timed_out" && (
        // 枠は消費済みで、生成は失敗していないかもしれない。「失敗」とは言わない。
        <div className="flex flex-col gap-3">
          <p className="text-ink">まだ生成しています。完成するとみんなの挑戦に表示されます</p>
          <div>
            <button
              type="button"
              onClick={onRecheck}
              className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
            >
              もう一度確認
            </button>
          </div>
        </div>
      )}

      {state.kind === "not_found" && (
        // 生成中の JWT 失効でも 404 になる（本人以外に generating は見えない）。
        // その場合も生成は進むので、完成すれば一覧に出ることを添える（設計書「決定 3」）。
        <div className="flex flex-col gap-3">
          <p className="text-ink">
            生成中の挑戦が見つかりませんでした。完成していればみんなの挑戦に表示されます
          </p>
          <StartOverButton onClick={onStartOver} />
        </div>
      )}
    </div>
  );
}

function PublishedResult({ attempt, onStartOver }: { attempt: Attempt; onStartOver: () => void }) {
  const publicId = attempt.generated_image_public_id;
  const src =
    publicId === null ? null : cloudinaryUrlOrNull(publicId, { width: IMAGE_WIDTH, aspect: "1:1" });
  const downloadHref =
    publicId === null
      ? null
      : cloudinaryDownloadUrlOrNull(publicId, { filename: `kotoe-attempt-${attempt.id}` });
  const alt = "あなたの再現画像";

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      {src === null ? (
        <div role="img" aria-label={alt} className="aspect-square w-full rounded-card bg-line sm:w-64" />
      ) : (
        // next/image ではなく <img>（7-3a 設計書「決定 4」）。
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="aspect-square w-full rounded-card bg-line object-cover sm:w-64"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="font-medium text-ink">画像が完成し、みんなの挑戦に公開されました</p>
        {/*
          自分が書いた描写文だが、公開 UGC と同じく {value} のまま置く。改行は whitespace-pre-wrap
          （<br> に置き換えると XSS になる。CLAUDE.md）。
        */}
        <p className="line-clamp-4 text-sm whitespace-pre-wrap wrap-break-word text-ink-muted">
          {attempt.description}
        </p>
        <div className="flex flex-wrap gap-2">
          {downloadHref !== null && (
            // download 属性は付けない（別オリジンでは効かない）。fl_attachment で保存させる。
            <a
              href={downloadHref}
              className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
            >
              ダウンロード（PNG）
            </a>
          )}
          <StartOverButton onClick={onStartOver} />
        </div>
      </div>
      {/* 7-4：/attempts/[id] ができたら、ここに比較ビューへのリンクを足す。 */}
    </div>
  );
}

function StartOverButton({ onClick }: { onClick: () => void }) {
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
      >
        新しく描写する
      </button>
    </div>
  );
}
