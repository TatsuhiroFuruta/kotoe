/**
 * お題のタイトルの表示。タイトルは任意で、無題のときバックエンドは title: null を返す（3-3）。
 * 「無題」の文言はフロントだけが持つ（バックは文言を持たない方針）。
 */

export const UNTITLED_LABEL = "無題";

const UNTITLED_IMAGE_ALT = "お題の画像";

export function postTitleText(title: string | null): string {
  return title ?? UNTITLED_LABEL;
}

/** 画像の alt / aria-label。無題のときに「無題」と読ませても画像の説明にならないので別の語にする。 */
export function postImageAlt(title: string | null): string {
  return title ?? UNTITLED_IMAGE_ALT;
}
