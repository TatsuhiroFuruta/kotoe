import Link from "next/link";

import { DeleteAttemptButton } from "@/components/attempts/delete-attempt-button";
import { PostTitleText } from "@/components/posts/post-title-text";
import { buttonClasses } from "@/components/ui/button";
import { cloudinaryUrlOrNull } from "@/lib/cloudinary";
import { draftResumeHref } from "@/lib/posts/post-detail-query";
import { postImageAlt } from "@/lib/posts/post-title";
import type { MyAttempt } from "@/types/api";

// PostCard と同じ変換にして、Cloudinary の派生画像を増やさない。
const THUMBNAIL_WIDTH = 640;

/**
 * 下書きカード。カード自体はリンクにせず、下端の「続きを書く」「削除」で操作する（7-6b 設計書 決定 1）。
 *
 * 「続きを書く」は受け口（/posts/[id]?draft=<id>）へ移り、描写フォームに文面を入れて開く。
 * 生成もそこで行う（元の画像を見ないまま生成させない。7-6a 設計書 決定 2）。
 * お題が削除済みなら「削除」だけを出す。保存も生成も 404 になる（4-4）。
 */
export function DraftCard({ draft, onDeleted }: { draft: MyAttempt; onDeleted: () => void }) {
  const { post } = draft;
  const publicId = post.image_public_id;
  const src =
    post.discarded || publicId === null
      ? null
      : cloudinaryUrlOrNull(publicId, { width: THUMBNAIL_WIDTH, aspect: "4:3" });

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface">
      {src === null ? (
        <div
          role="img"
          aria-label={post.discarded ? "削除されたお題" : postImageAlt(post.title)}
          className="aspect-4/3 w-full bg-line"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={postImageAlt(post.title)}
          loading="lazy"
          className="aspect-4/3 w-full bg-line object-cover"
        />
      )}
      <div className="p-4">
        {/* 公開 UGC。{value} のまま置く（React が自動でエスケープする）。 */}
        <p className="truncate text-sm text-ink-muted">
          {post.discarded ? (
            "お題は削除されました"
          ) : (
            <>
              お題：<PostTitleText title={post.title} />
            </>
          )}
        </p>
        <p className="mt-2 line-clamp-3 text-sm whitespace-pre-wrap wrap-break-word text-ink">
          {draft.description}
        </p>
      </div>
      <div className="mt-auto flex items-center justify-end gap-2 border-t border-line px-4 py-3">
        {!post.discarded && (
          <Link
            href={draftResumeHref(post.id, draft.id)}
            className={`${buttonClasses({ variant: "primary", size: "sm" })} text-sm`}
          >
            続きを書く
          </Link>
        )}
        <DeleteAttemptButton attemptId={draft.id} kind="draft" onDeleted={onDeleted} />
      </div>
    </article>
  );
}
