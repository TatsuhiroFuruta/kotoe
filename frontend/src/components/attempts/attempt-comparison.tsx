import { cloudinaryUrlOrNull } from "@/lib/cloudinary";
import type { Attempt, PostSummary } from "@/types/api";

// 再現画像はカード・結果パネルと同じ変換にし、Cloudinary の派生画像を共有する（7-3b 設計書「決定 4」）。
// 元画像も同じ幅にそろえる（枠の大きさが同じなので、片方だけ細かくしても見比べる役に立たない）。
const IMAGE_WIDTH = 640;

/**
 * 元画像と再現画像を、同じ幅の正方形枠 2 つで並べる（7-4 設計書「決定 4」）。
 * 順番は元画像 → 再現画像（お題 → 再現の時系列。お題詳細と同じ並び）。
 *
 * 元画像は縦横比が自由で、切り抜かない（描写の対象そのもののため。7-3b 決定 4）。
 * 枠に object-contain で収め、余白は bg-line の帯になる。再現画像は 1:1 なので枠いっぱいになる。
 */
export function AttemptComparison({ post, attempt }: { post: PostSummary; attempt: Attempt }) {
  const originalSrc = cloudinaryUrlOrNull(post.image_public_id, { width: IMAGE_WIDTH });
  const publicId = attempt.generated_image_public_id;
  const generatedSrc =
    publicId === null ? null : cloudinaryUrlOrNull(publicId, { width: IMAGE_WIDTH, aspect: "1:1" });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ComparisonFigure caption="お題" src={originalSrc} alt={post.title} fit="contain" />
      {/* alt に描写文を入れない。長文になりうるうえ、画像の中身ではなく「当てようとした言葉」のため（カードと同じ）。 */}
      <ComparisonFigure
        caption="再現"
        src={generatedSrc}
        alt={`${attempt.user.name} さんの再現画像`}
        fit="cover"
      />
    </div>
  );
}

function ComparisonFigure({
  caption,
  src,
  alt,
  fit,
}: {
  caption: string;
  src: string | null;
  alt: string;
  fit: "contain" | "cover";
}) {
  const fitClass = fit === "contain" ? "object-contain" : "object-cover";

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-sm font-semibold text-ink-muted">{caption}</figcaption>
      {/*
        next/image ではなく <img>（7-3a 設計書「決定 4」）。loading="lazy" にしない（ページの主役で、
        最初に見える画像のため）。URL を組み立てられないときは同じ寸法の空枠を出す（カードと同じ）。
      */}
      {src === null ? (
        <div role="img" aria-label={alt} className="aspect-square w-full rounded-card bg-line" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className={`aspect-square w-full rounded-card bg-line ${fitClass}`}
        />
      )}
    </figure>
  );
}
