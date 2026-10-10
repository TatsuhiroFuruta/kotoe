// お題画像を送る前の確認。
//
// **ルールの正はバック（backend/lib/images/validation.rb）。ここはその写し**で、
// 目的は「早く知らせる」ことだけ。バックはファイルを最後まで受け取ってから判定するので、
// 15MB の写真を弱い回線で送ると、数分待ったあとに弾かれる（7-5 設計書「決定 2」）。
// 値がずれてもバックが最終的に弾くので、安全側に倒れる。バックの値を変えたらここも直すこと。
//
// 返すのはバックと同じエラーコード。翻訳の辞書（post-messages.ts）を 1 つで済ませるため。

/** Images::Validation::MAX_BYTES（5.megabytes = 5 * 1024 * 1024） */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Images::Validation::ALLOWED_CONTENT_TYPES */
export const ALLOWED_IMAGE_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

/**
 * `<input type="file" accept>` に渡す値。ファイル選択画面の絞り込みであって判定ではない
 * （ドラッグ＆ドロップは accept を通らない）。判定は checkImageFile が担う。
 */
export const IMAGE_ACCEPT = ALLOWED_IMAGE_TYPES.join(",");

export type ImageFileErrorCode = "image_too_large" | "image_type_not_allowed";

/**
 * 送ってよいファイルなら null、だめならエラーコード。
 *
 * サイズを先に見るのはバックと同じ順序にするため（同じファイルに同じコードを返す）。
 *
 * **type が空なら形式は判定しない。** Chrome・Firefox は HEIC の type を空にすることが多く、
 * 弾くと正しい HEIC を拒否してしまう。そもそも file.type は拡張子から決まる値で、
 * バックのマジックバイト判定とは一致しない。分からないものはバックに任せる。
 */
export function checkImageFile(file: Pick<File, "size" | "type">): ImageFileErrorCode | null {
  if (file.size > IMAGE_MAX_BYTES) return "image_too_large";
  if (file.type !== "" && !ALLOWED_IMAGE_TYPES.includes(file.type)) return "image_type_not_allowed";
  return null;
}
