import type { Metadata } from "next";

import { PostList } from "@/components/posts/post-list";
import { parsePostsQuery, type RawSearchParams } from "@/lib/posts/posts-query";

export const metadata: Metadata = {
  title: "お題を探す",
};

/**
 * サーバーコンポーネントのまま、searchParams を正規化して渡すだけにする。
 * 取得はしない（Render がスリープしていると HTML ごと最大約 60 秒待たされるため。
 * 設計書「決定 1」）。
 *
 * useSearchParams() ではなく searchParams prop を使う。前者は <Suspense> 境界を
 * 要求し、ローカルでは通るのに Vercel の本番ビルドだけ落ちる（7-2 の規約）。
 * 同じ /posts のクエリだけが変わる <Link> 遷移でもこのコンポーネントが再描画され、
 * 新しい query が PostList に降りる。
 */
export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = parsePostsQuery(await searchParams);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">お題を探す</h1>
      <PostList query={query} />
    </main>
  );
}
