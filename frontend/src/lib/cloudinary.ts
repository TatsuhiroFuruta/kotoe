/**
 * Cloudinary の配信 URL を組み立てる。お題画像・生成画像の URL はすべてここを通す
 * （7-3a の一覧が最初。7-3b・7-4・7-6 が使い回す）。
 *
 * next/image を使わず <img> にこの URL を入れる。next/image の Vercel 最適化は
 * Cloudinary と二重に処理して 2 つの無料枠を両方消費し、カスタムローダーは
 * 幅ごとの srcset で変換数が約 8 倍になる。Cloudinary の無料枠は超過すると
 * 翌月まで全画像が止まるので、変換は 1 画像 1 サイズに抑える（設計書「決定 4」）。
 *
 * ダウンロード用の URL（WebP で保存しているため f_png + fl_attachment が要る。
 * 4-3 からの申し送り）は、使う issue（7-3b / 7-4）で足す。
 */

// 固定する。img の src に入る値なので、public_id がどんな文字列でも
// このオリジンの外へ出られないようにする（CLAUDE.md の XSS：href / src）。
const ORIGIN = "https://res.cloudinary.com";

/**
 * 縦横比はリテラル型に絞り、変換文字列を呼び出し側に書かせない。
 * 自由に書けると、呼び出しごとに少しずつ違う変換が生まれ、それぞれが
 * 別の派生画像として変換数を消費する。
 */
export type CloudinaryAspect = "4:3" | "1:1";

export function cloudinaryUrl(
  publicId: string,
  { width, aspect }: { width: number; aspect: CloudinaryAspect },
): string {
  // 関数の中で読む（モジュールの先頭で読まない）。Next は
  // process.env.NEXT_PUBLIC_* という字面をビルド時に値へ置き換えるので
  // どちらでも本番は動くが、中で読めばテストが vi.stubEnv で差し替えられる。
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!cloudName) {
    throw new Error("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME が設定されていません");
  }

  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`cloudinaryUrl: 幅は正の整数で指定してください（${width}）`);
  }

  // public_id は kotoe/<env>/posts/<id> のように / を含む。/ はパスの区切りとして
  // 残し、セグメントごとにエンコードする（? や # が残ると public_id が途中で切れる）。
  //
  // 空・. ・.. のセグメントは拒否する。encodeURIComponent はこれらをそのまま残すので、
  // URL の正規化でパスを上へ辿られる。バックエンドが発行する public_id には
  // 現れないので、来たらデータの異常として落とす。
  const segments = publicId.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("cloudinaryUrl: public_id の形式が不正です");
  }
  const path = segments.map(encodeURIComponent).join("/");

  // f_auto で配信形式（AVIF / WebP など）をブラウザに合わせ、q_auto で画質を自動にする。
  const transformation = `c_fill,ar_${aspect},w_${width},f_auto,q_auto`;

  return `${ORIGIN}/${encodeURIComponent(cloudName)}/image/upload/${transformation}/${path}`;
}

/**
 * 描画中に使う版。組み立てられないときは例外にせず null を返す。
 *
 * cloudinaryUrl() の例外を描画中に投げると、error boundary が無いのでヘッダーごと
 * アプリ全体が落ちる。お題 1 件の public_id が壊れているだけで、残りの 11 件まで
 * 見られなくなる。画面側は null のときプレースホルダを描く。
 *
 * cloudinaryUrl() 自体は例外のままにしておく。黙って壊れた URL を配らないという
 * 性質は変えず、「落とすか・伏せるか」の判断だけを呼び出し側に移す。原因は
 * console.error に残す（握り潰すと、画像が出ない理由がどこにも残らない）。
 */
export function cloudinaryUrlOrNull(
  publicId: string,
  options: { width: number; aspect: CloudinaryAspect },
): string | null {
  try {
    return cloudinaryUrl(publicId, options);
  } catch (error) {
    console.error("画像の URL を組み立てられませんでした", error);
    return null;
  }
}
