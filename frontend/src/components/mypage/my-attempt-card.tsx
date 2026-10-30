import Link from "next/link";

import { DeleteAttemptButton } from "@/components/attempts/delete-attempt-button";
import { myAttemptCardLabel } from "@/lib/attempts/attempt-card-label";
import { attemptDetailHref } from "@/lib/attempts/attempt-detail-query";
import { cloudinaryUrlOrNull } from "@/lib/cloudinary";
import type { MyAttempt } from "@/types/api";

// AttemptCard と同じ変換にして、Cloudinary の派生画像を増やさない。
const IMAGE_WIDTH = 640;

const CARD_CLASSES = "overflow-hidden rounded-card border border-line bg-surface";

/**
 * 自分の挑戦カード。投稿者は常に本人なので名前は出さない。
 *
 * お題が削除済みのときはリンクにしない。挑戦詳細 API が Post.kept.find で 404 を返すため、
 * 押せるようにすると行き先が「見つかりません」になる。
 */
export function MyAttemptCard({
  attempt,
  onDeleted,
}: {
  attempt: MyAttempt;
  onDeleted: () => void;
}) {
  const publicId = attempt.generated_image_public_id;
  const src =
    publicId === null ? null : cloudinaryUrlOrNull(publicId, { width: IMAGE_WIDTH, aspect: "1:1" });
  const alt = "あなたの再現画像";
  const { post } = attempt;

  const body = (
    <>
      {src === null ? (
        <div role="img" aria-label={alt} className="aspect-square w-full bg-line" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="aspect-square w-full bg-line object-cover"
        />
      )}
      <div className="p-4">
        {/* 公開 UGC。{value} のまま置く（React が自動でエスケープする）。 */}
        <p className="line-clamp-3 text-sm whitespace-pre-wrap wrap-break-word text-ink">
          {attempt.description}
        </p>
        <div className="mt-3 flex items-center justify-between gap-2 text-sm text-ink-muted">
          {post.discarded ? (
            <span className="truncate">お題は削除されました</span>
          ) : (
            <span className="truncate">お題：{post.title}</span>
          )}
          <span className="shrink-0">
            いいね <span className="font-medium text-ink">{attempt.likes_count}</span>
          </span>
        </div>
      </div>
    </>
  );

  // 削除の行はリンクの外に置く。<a> の中にボタンを入れると、押せる要素の入れ子になり、
  // 押すと削除と同時に挑戦詳細へ移る（7-6b 設計書 決定 3）。
  const footer = (
    <div className="mt-auto flex justify-end border-t border-line px-4 py-3">
      <DeleteAttemptButton attemptId={attempt.id} kind="attempt" onDeleted={onDeleted} />
    </div>
  );

  if (post.discarded) {
    return (
      <article className={`${CARD_CLASSES} flex h-full flex-col`}>
        <div>{body}</div>
        {footer}
      </article>
    );
  }

  return (
    // 枠の強調は、リンクに乗ったときだけにする（削除の行に乗っても挑戦詳細へは移らないため）。
    <article
      className={`${CARD_CLASSES} flex h-full flex-col transition-colors has-[a:hover]:border-accent`}
    >
      <Link
        href={attemptDetailHref(attempt.id)}
        aria-label={myAttemptCardLabel(attempt)}
        className="block focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        {body}
      </Link>
      {footer}
    </article>
  );
}
