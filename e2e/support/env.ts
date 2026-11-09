// E2E が叩く Rails API と Next.js のオリジン。ローカルの E2E 用 compose サービス
// （backend-e2e :3100 / frontend-e2e :3101）が既定。CI などでは環境変数で差し替える。
export const API_BASE_URL: string =
  process.env.E2E_API_BASE_URL ?? "http://localhost:3100";

export const APP_BASE_URL: string =
  process.env.E2E_APP_BASE_URL ?? "http://localhost:3101";
