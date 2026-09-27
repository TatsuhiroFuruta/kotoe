import { FavoriteButton } from "@/components/posts/favorite-button";
import { cloudinaryUrlOrNull } from "@/lib/cloudinary";
import type { PostSummary } from "@/types/api";

// 本文の最大幅（max-w-5xl ≒ 1024px）に対し、Retina で少し足りない程度の 1 本に抑える。
// 幅を増やすほど変換と転送量が増える（7-3a 設計書「決定 4」の「1 画像 1 サイズ」）。
const HERO_WIDTH = 1280;

/**
 * 元画像・タイトル・投稿者・お気に入り。
 *
 * 元画像は aspect を渡さず切り抜かない（7-3b 設計書「決定 4」）。描写の対象そのものなので、
 * 一覧のサムネイルのように 4:3 に切ると描写すべき部分が見えなくなる。
 *
 * 表示の枠は画像そのものの縦横比にする（w-auto h-auto）。横幅は本文の幅まで、高さは 70vh
 * までに縮めて中央に置く。枠を本文の幅に固定して object-contain で収めると、横長の画像以外
 * （4:3・正方形・縦長の写真）では左右に枠の背景が帯になって見えるため。
 * 小さい画像も c_fit が 1280 の枠まで拡大して配信するので、切手大にはならない。
 */
export function PostHero({
  post,
  favorited,
  onFavoritedChange,
}: {
  post: PostSummary;
  favorited: boolean;
  onFavoritedChange: (favorited: boolean) => void;
}) {
  const src = cloudinaryUrlOrNull(post.image_public_id, { width: HERO_WIDTH });

  return (
    <section className="flex flex-col gap-4">
      {/*
        next/image ではなく <img>（7-3a 設計書「決定 4」）。loading="lazy" にしない
        （ページの主役で、最初に見える画像のため）。
      */}
      {src === null ? (
        <div role="img" aria-label={post.title} className="aspect-4/3 w-full rounded-card bg-line" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={post.title}
          className="mx-auto block h-auto max-h-[70vh] w-auto max-w-full rounded-card"
        />
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {/* 公開 UGC。{value} のまま置く。長い英数字のタイトルがはみ出さないよう wrap-break-word。 */}
          <h1 className="text-2xl font-semibold tracking-tight wrap-break-word text-ink">
            {post.title}
          </h1>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
            <div className="flex min-w-0 gap-1">
              <dt>投稿者</dt>
              <dd className="truncate font-medium text-ink">{post.user.name}</dd>
            </div>
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
        <FavoriteButton postId={post.id} favorited={favorited} onChange={onFavoritedChange} />
      </div>
    </section>
  );
}
