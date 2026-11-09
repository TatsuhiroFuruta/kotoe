// E2E が叩く Rails API と Next.js のオリジン。ローカルは compose の backend-e2e（:3100）と
// frontend-e2e（:3101）、CI はジョブの手順で同じポートに立てたもの。
//
// 環境変数で差し替えられるようにはしない。差し替わるのはテスト側だけで、フロントのビルドに
// 埋め込む NEXT_PUBLIC_API_BASE_URL や Rails の CORS_ALLOWED_ORIGINS は変わらないため。
export const API_BASE_URL = "http://localhost:3100";

export const APP_BASE_URL = "http://localhost:3101";
