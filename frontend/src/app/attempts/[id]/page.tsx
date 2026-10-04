import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AttemptDetail } from "@/components/attempts/attempt-detail";
import { parseAttemptId } from "@/lib/attempts/attempt-detail-query";

// 挑戦の中身（お題のタイトルなど）を入れるにはサーバーでの取得（generateMetadata）が要り、
// クライアント取得（7-4 設計書「決定 1」）と衝突する。OGP とあわせて 8-3 で扱う。
export const metadata: Metadata = {
  title: "挑戦",
};

/**
 * サーバーコンポーネントのまま、id を正規化して渡すだけにする。取得はしない
 * （Render がスリープしていると HTML ごと最大約 60 秒待たされるため。7-3a・7-3b と同じ）。
 *
 * id が正の整数でなければ API を呼ばずに 404。存在しない id は API の 404 を
 * AttemptDetail が画面内で出す。
 */
export default async function AttemptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const attemptId = parseAttemptId((await params).id);
  if (attemptId === null) notFound();

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <AttemptDetail attemptId={attemptId} />
    </main>
  );
}
