import type { Metadata } from "next";

import { MypageView } from "@/components/mypage/mypage-view";
import { RequireAuth } from "@/lib/auth/require-auth";
import { parseMypageQuery } from "@/lib/mypage/mypage-query";
import type { RawSearchParams } from "@/lib/search-params";

export const metadata: Metadata = {
  title: "マイページ",
};

/**
 * 認証必須。RequireAuth が未ログインなら /login?next=/mypage へ送る。
 *
 * /posts と同じく、useSearchParams() ではなく searchParams prop を使う
 * （前者は <Suspense> 境界を要求し、Vercel の本番ビルドだけ落ちる。7-2 の規約）。
 * <h1> はここに置かず、ProfileHeader の名前を見出しにする。
 */
export default async function MypagePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = parseMypageQuery(await searchParams);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <RequireAuth>
        <MypageView query={query} />
      </RequireAuth>
    </main>
  );
}
