/**
 * `DEV_ALLOWED_HOSTS` を Next.js の `allowedDevOrigins` に渡す形へ正規化する。
 *
 * Next の dev サーバーは `/_next/*` へのクロスオリジンアクセスを既定でブロックする。
 * 突き合わせは「オリジン」ではなく **ホスト名** で行われる
 * （`node_modules/next/dist/server/lib/router-utils/block-cross-site-dev.js` が
 * `Origin` / `Referer` を URL パースし、`hostname` だけを比較する）。
 *
 * つまり `http://192.168.1.10:3001` のようなオリジン形式を渡すと、エラーも警告も
 * 出ないまま一致せず、ブロックが続く。SSR された HTML は表示されるのに
 * クライアント JS だけが動かないため、症状は「実装が壊れている」ようにしか見えない。
 * その事故を防ぐため、ホスト名・`host:port`・オリジンのどれで書かれても
 * 同じ結果になるよう URL パーサ 1 本に寄せる。
 *
 * この値が効くのは dev サーバーだけで、本番ビルドには影響しない。
 */
export function parseAllowedDevHosts(raw: string | undefined): string[] {
  if (!raw) return [];

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "")
    .map(toHostname);
}

function toHostname(value: string): string {
  // スキームが無ければ補う。"my-mac.local:3001" をそのまま URL に渡すと
  // "my-mac.local:" がスキームとして解釈され、hostname が空文字になる。
  const withScheme = value.includes("://") ? value : `http://${value}`;

  try {
    return new URL(withScheme).hostname;
  } catch {
    throw new Error(
      `DEV_ALLOWED_HOSTS の値を解釈できません: ${JSON.stringify(value)}。` +
        "ホスト名（192.168.1.10 / my-mac.local）か、" +
        "オリジン（http://192.168.1.10:3001）の形で書いてください。",
    );
  }
}
