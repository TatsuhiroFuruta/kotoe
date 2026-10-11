// お題画像を送る前の確認。
//
// **ルールの正はバック（backend/lib/images/validation.rb）。ここはその写し**で、
// 目的は「早く知らせる」ことだけ。バックはファイルを最後まで受け取ってから判定するので、
// 15MB の写真を弱い回線で送ると、数分待ったあとに弾かれる（7-5 設計書「決定 2」）。
// 値がずれてもバックが最終的に弾くので、安全側に倒れる。バックの値を変えたらここも直すこと。
//
// 返すのは基本的にバックと同じエラーコード。翻訳の辞書（post-messages.ts）を 1 つで済ませるため。
// 0 バイトの image_empty だけはフロント専用（ImageFileErrorCode の説明を参照）。

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
 *
 * HEIC / HEIF は拡張子も並べる。選択画面は MIME から拡張子を逆引きして絞り込むので、
 * OS が .heic を image/heic に対応付けていない環境では、MIME だけだと HEIC が一覧に出ない。
 */
export const IMAGE_ACCEPT = [...ALLOWED_IMAGE_TYPES, ".heic", ".heif"].join(",");

/** ブラウザが種類を判断できなかったときの type。checkImageFile の説明を参照 */
const UNKNOWN_TYPES: readonly string[] = ["", "application/octet-stream"];

/**
 * image_empty だけはフロント専用のコード。バックは 0 バイトを image_missing（「画像を選んでください」）に
 * するが、ファイルを選んだ直後の人にその文言は通じないので、選んだ時点では別の文言で知らせる。
 */
export type ImageFileErrorCode = "image_empty" | "image_too_large" | "image_type_not_allowed";

/**
 * 送ってよいファイルなら null、だめならエラーコード。
 *
 * 0 バイト → サイズ → 形式の順に見るのは、バックと同じ順序にするため。0 バイトも弾くのはバック
 * （missing?）と同じで、通すと、送ってから「画像を選んでください」と返ってくる。
 *
 * **type が「分からない」なら形式は判定しない。** 空文字と application/octet-stream がそれに当たる。
 * ブラウザは拡張子から type を決めるので、OS が知らない拡張子（環境によっては HEIC）では
 * どちらかになる。弾くと正しい HEIC を拒否してしまう（2026-10-10、Chrome で octet-stream を実測）。
 * そもそも file.type はバックのマジックバイト判定とは一致しない。分からないものはバックに任せる。
 */
export function checkImageFile(file: Pick<File, "size" | "type">): ImageFileErrorCode | null {
  if (file.size === 0) return "image_empty";
  if (file.size > IMAGE_MAX_BYTES) return "image_too_large";
  if (!UNKNOWN_TYPES.includes(file.type) && !ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return "image_type_not_allowed";
  }
  return null;
}
