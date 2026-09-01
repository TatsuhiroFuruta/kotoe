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

  // 「/」で始まらないものは全部拒否する（javascript: も https:// もここで落ちる）。
  if (!next.startsWith("/")) return DEFAULT_NEXT_PATH;

  // 「/」で始まるが別オリジンへ飛ぶ2つの形。
  if (next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_NEXT_PATH;

  return next;
}
