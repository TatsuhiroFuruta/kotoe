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

  let hostname: string;
  try {
    hostname = new URL(withScheme).hostname;
  } catch {
    throw new Error(
      `DEV_ALLOWED_HOSTS の値を解釈できません: ${JSON.stringify(value)}。` +
        "ホスト名（192.168.1.10 / my-mac.local）か、" +
        "オリジン（http://192.168.1.10:3001）の形で書いてください。",
    );
  }

  // URL パーサは全部が数字のホストを IPv4 として「正規化」する。書き間違いや
  // 前方一致のつもりで書いた値は、拒否されずに別のホストへ書き換えられる
  // （"192.168.1" → "192.168.0.1"、"0x7f.1" → "127.0.0.1"）。黙って通すと
  // 「設定したのにブロックされ続ける」に戻るので、書き換わったら落とす。
  const written = hostWithoutPort(withScheme);
  if (hostname !== written.toLowerCase()) {
    throw new Error(
      `DEV_ALLOWED_HOSTS の値がホスト名として素直に解釈されません: ` +
        `${JSON.stringify(value)} は ${JSON.stringify(hostname)} と解釈されます。` +
        "ホスト名を省略せずに書いてください（前方一致が要るなら 192.168.*.* のように書けます）。",
    );
  }

  // Next 側の matchWildcardDomain（csrf-protection.js）は、1 セグメントだけの
  // "*" / "**" を明示的に拒否する（ドメイン全体にマッチさせないため）。
  // ここで通すと、何にも一致しない値が黙って許可リストに入る。
  if (hostname === "*" || hostname === "**") {
    throw new Error(
      `DEV_ALLOWED_HOSTS の ${JSON.stringify(value)} は Next 側で決して一致しません。` +
        "ワイルドカードは 192.168.*.* のように、セグメントを 2 つ以上にしてください。",
    );
  }

  return hostname;
}

// スキーム付き URL から、ポートとパスを除いたホスト部分をそのまま切り出す。
// URL パーサを通す前の「書かれたとおりの姿」が要るので、自前で切る。
function hostWithoutPort(url: string): string {
  const afterScheme = url.slice(url.indexOf("://") + "://".length);
  const host = afterScheme.split(/[/?#]/)[0];

  return host.replace(/:\d*$/, "");
}
