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

/** 挑戦の状態。published と failed が終端（4-2）。 */
export type AttemptStatus = "draft" | "generating" | "published" | "failed";

/**
 * 挑戦 1 件（AttemptSerializer）。お題詳細の一覧・表彰台と、挑戦 API で共通。
 * お題詳細に出るのは published だけ（Attempt.listing_for）。
 */
export type Attempt = {
  id: number;
  description: string;
  /** published 以外は null。表示には必ず cloudinaryUrl() を通す */
  generated_image_public_id: string | null;
  status: AttemptStatus;
  /** failed のときだけ値が入る。7-3c でリテラル型に絞る */
  failure_reason: string | null;
  /** 8-4（CLIP）まで常に null。描画しない */
  similarity_score: number | null;
  user: PublicUser;
  likes_count: number;
  /** リクエストした本人がいいね済みか。7-4 まで描画しない */
  liked: boolean;
  /** ISO 8601（UTC） */
  created_at: string;
};

/**
 * GET /api/posts/:id。
 * meta は attempts のページングだけを指す。best_attempts はページングを持たず、
 * sort・page によらず常にいいね上位 3 件（6-1）。同じ挑戦が両方に現れうる。
 */
export type PostDetailResponse = {
  post: PostSummary;
  best_attempts: Attempt[];
  attempts: Attempt[];
  meta: PaginationMeta;
};

/** POST / DELETE /api/posts/:id/favorite。どちらも冪等で、更新後の favorited を含む。 */
export type FavoriteResponse = {
  post: PostSummary;
};
