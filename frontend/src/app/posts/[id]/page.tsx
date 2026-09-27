import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PostDetail } from "@/components/posts/post-detail";
import { parsePostDetailQuery, parsePostId } from "@/lib/posts/post-detail-query";
import type { RawSearchParams } from "@/lib/search-params";

// お題のタイトルを入れるにはサーバーでの取得（generateMetadata）が要り、
// クライアント取得（7-3b 設計書「決定 1」）と衝突する。OGP とあわせて 8-3 で扱う。
export const metadata: Metadata = {
  title: "お題",
};

/**
 * サーバーコンポーネントのまま、params と searchParams を正規化して渡すだけにする。
 * 取得はしない（Render がスリープしていると HTML ごと最大約 60 秒待たされるため。7-3a と同じ）。
 *
 * id が正の整数でなければ API を呼ばずに 404。存在しない id は API の 404 を
 * PostDetail が画面内で出す（どちらも「見つからない」ことに変わりはない）。
 */
export default async function PostDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const postId = parsePostId((await params).id);
  if (postId === null) notFound();

  const query = parsePostDetailQuery(await searchParams);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <PostDetail postId={postId} query={query} />
    </main>
  );
}
