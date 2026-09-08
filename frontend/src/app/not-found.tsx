import Link from "next/link";

/**
 * 404。自前で用意するのは、Next.js の組み込み 404 が
 * `prefers-color-scheme: dark` に反応する独自スタイルを持っており、
 * ライト固定にした Kotoe のヘッダー／フッターの間で本文だけが黒くなるため。
 * 組み込みページはこちらの globals.css を見ない。
 */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-5xl font-semibold tracking-tight text-ink">404</p>
      <p className="text-ink-muted">お探しのページは見つかりませんでした。</p>
      <Link href="/" className="text-accent hover:text-accent-strong">
        トップへ戻る
      </Link>
    </main>
  );
}
