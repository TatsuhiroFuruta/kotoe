/**
 * 本番ビルドに必須の NEXT_PUBLIC_* が揃っているかを確かめる。next.config.ts が
 * 本番ビルドのときだけ呼ぶ。
 *
 * NEXT_PUBLIC_* はビルド時にバンドルへ埋め込まれるので、未設定のままビルドすると
 * 実行時には直しようがない。cloud name が無いと cloudinaryUrl() が**描画中に**
 * 例外を投げ、error boundary が無いのでヘッダーごとアプリ全体が落ちる。しかも
 * お題が 0 件のあいだは描画されないので、プレビューの確認をすり抜けやすい。
 * PR のチェックリストだけに頼らず、ビルドを止める。
 *
 * NEXT_PUBLIC_API_BASE_URL をここに入れていないのは、api.ts が非同期の取得の中で
 * 例外を投げ、画面側が文言と再試行に変えるため（アプリは落ちない）。
 */
const REQUIRED_KEYS = ["NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME"] as const;

export function assertRequiredPublicEnv(env: Record<string, string | undefined>): void {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]?.trim());
  if (missing.length === 0) return;

  throw new Error(
    `本番ビルドに必要な環境変数が設定されていません: ${missing.join(", ")}` +
      "（Vercel なら Production と Preview の両方に設定する。frontend/.env.example を参照）",
  );
}
