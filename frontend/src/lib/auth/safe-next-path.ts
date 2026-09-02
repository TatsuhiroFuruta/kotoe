export const DEFAULT_NEXT_PATH = "/";

/**
 * `?next=` に載っていた戻り先を、遷移して安全な形に正規化する。
 *
 * `?next=` は URL に載る＝攻撃者が自由に書ける値なので、そのまま
 * router.replace() へ渡してはいけない。Next.js のドキュメント（use-router.md）に
 * 「未検証の URL を router.push / router.replace に渡すと `javascript:` URL が
 * ページのコンテキストで実行される」と明記されている。外部サイトへの
 * オープンリダイレクトも同じ経路で成立する。
 *
 * 判定に URL パーサを使わず、通す形を列挙するホワイトリスト方式にする。
 * パーサは受理する形が広く実装差もあるため、「拒否したい形」を数え上げる
 * 方式にすると数え漏れがそのまま穴になる。
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return DEFAULT_NEXT_PATH;

  // 判定の前に、URL パーサと同じ前処理を自分でも行う。これをしないと
  // 下の startsWith が全部空振りする。
  //
  //   1. パーサは解析の前に ASCII のタブ・LF・CR を「取り除く」。
  //      "/\t/evil.example" は "//evil.example" として解釈され、別オリジンへ飛ぶ。
  //      ?next=%2F%09%2Fevil.example がデコードされてこの形になる。
  //   2. パーサはバックスラッシュをスラッシュとして扱う。
  //
  // つまり「攻撃者が書いた文字列」ではなく「パーサが最終的に見る文字列」を
  // 検査しないと、ホワイトリストの意味が無くなる。
  const normalized = next.replace(/[\t\n\r]/g, "").replace(/\\/g, "/");

  // 「/」で始まらないものは全部拒否する（javascript: も https:// もここで落ちる）。
  if (!normalized.startsWith("/")) return DEFAULT_NEXT_PATH;

  // 「/」で始まるが別オリジンへ飛ぶ形（protocol-relative）。
  if (normalized.startsWith("//")) return DEFAULT_NEXT_PATH;

  // 認証画面自身は戻り先にしない。ログイン成功直後にログイン画面へ戻す
  // ことになり、ユーザーには「ログインできていない」ように見える。
  // 判定はクエリ・フラグメントを落としたパス部分で行う。
  const pathname = normalized.split(/[?#]/)[0];
  if (pathname === "/login" || pathname === "/signup") return DEFAULT_NEXT_PATH;

  // 検査した文字列そのものを返す。元の値を返すと「検査した対象」と
  // 「実際に遷移する対象」が食い違い、同じ穴が開き直る。
  return normalized;
}
