// Rails API のレスポンスの型。

/** GET /api/health */
export type HealthResponse = {
  status: "ok" | "error";
  database: "ok" | "error";
};

/** 認証系 API とユーザー表現。POST /api/auth/sign_in などが返す形。 */
export type User = {
  id: number;
  name: string;
  email: string;
};

/**
 * GET /api/me。User に統計が付く。
 * stats は AuthProvider では保持しない。ログイン時点のスナップショットにすぎず、
 * お題を投稿しても挑戦されても更新されないため、認証コンテキストに置くと
 * 7-6 のマイページヘッダーが必ず古い値を表示することになる。7-6 が自分で取る。
 */
export type MeResponse = User & {
  stats: {
    posts_count: number;
    attempts_count: number;
    likes_received_count: number;
  };
};

/** 401 のボディ（Warden の FailureApp）。文言ではなくコードが来る。 */
export type AuthErrorBody = {
  error: "invalid_credentials" | "unauthorized";
};

/** 422 のボディ。値は属性ごとのエラーコードの配列（"taken" / "blank" など）。 */
export type ValidationErrorBody = {
  errors: Record<string, string[]>;
};

/** 他人に見せるユーザーの表現（UserSerializer.public_profile）。email を含まない。 */
export type PublicUser = {
  id: number;
  name: string;
};

/**
 * お題 1 件（PostSerializer）。一覧・詳細・作成の応答で共通。
 * attempts_count / likes_count は公開済みの挑戦だけを数えた値。
 */
export type PostSummary = {
  id: number;
  title: string;
  /** Cloudinary の public_id。表示には必ず cloudinaryUrl() を通す */
  image_public_id: string;
  user: PublicUser;
  attempts_count: number;
  likes_count: number;
  /** リクエストした本人がお気に入り済みか。未ログインなら常に false。一覧では描画しない */
  favorited: boolean;
  /** ISO 8601（UTC） */
  created_at: string;
};

/** kaminari のページ情報（PaginationSerializer）。1 ページの件数はサーバーが 12 に固定している。 */
export type PaginationMeta = {
  current_page: number;
  total_pages: number;
  total_count: number;
};

/** GET /api/posts */
export type PostsIndexResponse = {
  posts: PostSummary[];
  meta: PaginationMeta;
};
