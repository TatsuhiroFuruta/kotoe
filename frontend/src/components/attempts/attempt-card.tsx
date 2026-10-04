import Link from "next/link";

import { attemptCardLabel } from "@/lib/attempts/attempt-card-label";
import { attemptDetailHref } from "@/lib/attempts/attempt-detail-query";
import { cloudinaryUrlOrNull } from "@/lib/cloudinary";
import type { Attempt } from "@/types/api";

// 生成画像は 1024×1024 の正方形（4-3）。表彰台と一覧で同じ変換にすると、同じ挑戦が
// 両方に出ても Cloudinary の派生画像は 1 つで済む（7-3b 設計書「決定 4」）。
const IMAGE_WIDTH = 640;

/**
 * 挑戦カード。全体が比較ビューへのリンク（7-4 設計書「決定 3」）。
 *
 * いいねボタンは置かない。<a> の中に <button> は置けず、同じ挑戦が表彰台とみんなの挑戦の
 * 両方に出るので、置くなら状態の同期も要る。いいねは比較ビューで元画像と見比べてから押す。
 */
export function AttemptCard({ attempt }: { attempt: Attempt }) {
  const publicId = attempt.generated_image_public_id;
  const src =
    publicId === null ? null : cloudinaryUrlOrNull(publicId, { width: IMAGE_WIDTH, aspect: "1:1" });
  // alt に描写文を入れない。長文になりうるうえ、画像の中身ではなく「当てようとした言葉」のため。
  const alt = `${attempt.user.name} さんの再現画像`;

  return (
    // href は id（API が返す整数）から組み立てた値だけ。
    // aria-label で読み上げの名前を短くする（理由は attemptCardLabel）。
    <Link
      href={attemptDetailHref(attempt.id)}
      aria-label={attemptCardLabel(attempt)}
      className="group block rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <article className="overflow-hidden rounded-card border border-line bg-surface transition-colors group-hover:border-accent">
        {/*
          next/image ではなく <img>（7-3a 設計書「決定 4」）。URL を組み立てられないときは
          同じ寸法の空枠を出す（1 件の不正なデータで一覧ごと落とさないため。PostCard と同じ）。
        */}
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
          {/*
            公開 UGC。{value} のまま置く（React が自動でエスケープする）。
            改行は whitespace-pre-wrap で反映する。<br> に置き換えると XSS になる（CLAUDE.md）。
            wrap-break-word は、空白を含まない長い英数字がカードの外へはみ出さないため。
          */}
          <p className="line-clamp-3 text-sm whitespace-pre-wrap wrap-break-word text-ink">
            {attempt.description}
          </p>
          <div className="mt-3 flex items-center justify-between gap-2 text-sm text-ink-muted">
            <span className="truncate">{attempt.user.name}</span>
            <span className="shrink-0">
              いいね <span className="font-medium text-ink">{attempt.likes_count}</span>
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
