import { cloudinaryUrl } from "@/lib/cloudinary";
import type { PostSummary } from "@/types/api";

// カードは最大 3 列・幅 320px 程度。Retina でも 640px の 1 本で足りる。
// 幅を増やすと派生画像が増えて Cloudinary の変換数を消費する（設計書「決定 4」）。
const THUMBNAIL_WIDTH = 640;

export function PostCard({ post }: { post: PostSummary }) {
  // 7-3b：この <article> を <Link href={`/posts/${post.id}`}> で包む。
  // /posts/[id] が実在しないうちにリンクにすると、main を追跡している本番で 404 になる。
  return (
    <article className="overflow-hidden rounded-card border border-line bg-surface">
      {/*
        next/image ではなく <img>。変換は cloudinaryUrl() が Cloudinary 側で済ませており、
        next/image を通すと Vercel の最適化枠まで消費する（設計書「決定 4」）。
        alt のタイトルは公開 UGC だが、属性値も React がエスケープする。
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cloudinaryUrl(post.image_public_id, { width: THUMBNAIL_WIDTH, aspect: "4:3" })}
        alt={post.title}
        loading="lazy"
        className="aspect-4/3 w-full bg-line object-cover"
      />
      <div className="p-4">
        {/*
          公開 UGC。{value} のまま置く（React が自動でエスケープする）。
          wrap-break-word は、空白を含まない長い英数字のタイトルがカードの外へはみ出さないため。
        */}
        <h2 className="line-clamp-2 font-semibold wrap-break-word text-ink">{post.title}</h2>
        <p className="mt-1 truncate text-sm text-ink-muted">{post.user.name}</p>
        <dl className="mt-3 flex gap-4 text-sm text-ink-muted">
          <div className="flex gap-1">
            <dt>挑戦</dt>
            <dd className="font-medium text-ink">{post.attempts_count}</dd>
          </div>
          <div className="flex gap-1">
            <dt>いいね</dt>
            <dd className="font-medium text-ink">{post.likes_count}</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
