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
