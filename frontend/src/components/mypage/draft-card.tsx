import { cloudinaryUrlOrNull } from "@/lib/cloudinary";
import type { MyAttempt } from "@/types/api";

// PostCard と同じ変換にして、Cloudinary の派生画像を増やさない。
const THUMBNAIL_WIDTH = 640;

/**
 * 下書きカード。リンクにしない。
 *
 * お題詳細へ移すと空の描写フォームが開き、保存した文面が消えたように見える。
 * 下書きを開く導線は、受け口（フォームへの復元）と一緒に 7-6b で作る。
 */
export function DraftCard({ draft }: { draft: MyAttempt }) {
  const { post } = draft;
  const publicId = post.image_public_id;
  const src =
    post.discarded || publicId === null
      ? null
      : cloudinaryUrlOrNull(publicId, { width: THUMBNAIL_WIDTH, aspect: "4:3" });

  return (
    <article className="overflow-hidden rounded-card border border-line bg-surface">
      {src === null ? (
        <div
          role="img"
          aria-label={post.discarded ? "削除されたお題" : (post.title ?? "お題の画像")}
          className="aspect-4/3 w-full bg-line"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={post.title ?? "お題の画像"}
          loading="lazy"
          className="aspect-4/3 w-full bg-line object-cover"
        />
      )}
      <div className="p-4">
        {/* 公開 UGC。{value} のまま置く（React が自動でエスケープする）。 */}
        <p className="truncate text-sm text-ink-muted">
          {post.discarded ? "お題は削除されました" : `お題：${post.title}`}
        </p>
        <p className="mt-2 line-clamp-3 text-sm whitespace-pre-wrap wrap-break-word text-ink">
          {draft.description}
        </p>
      </div>
    </article>
  );
}
