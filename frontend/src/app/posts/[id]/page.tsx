import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PostDetail } from "@/components/posts/post-detail";
import { parseDraftParam, parsePostDetailQuery, parsePostId } from "@/lib/posts/post-detail-query";
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

  const rawSearchParams = await searchParams;
  const query = parsePostDetailQuery(rawSearchParams);
  // マイページの下書きカードからの受け口（7-6b）。描写フォームに文面を入れて開く。
  const draftId = parseDraftParam(rawSearchParams);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <PostDetail postId={postId} query={query} draftId={draftId} />
    </main>
  );
}
