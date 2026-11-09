// E2E が叩く Rails API と Next.js のオリジン。ローカルの E2E 用 compose サービス
// （backend-e2e :3100 / frontend-e2e :3101）が既定。CI などでは環境変数で差し替える。
//
// E2E はユーザーやお題を作り、画像を生成する。差し替えの設定ミスで本番などに向けないよう、
// localhost / 127.0.0.1 以外のオリジンは読み込みの時点で落とす。
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

function localBaseUrl(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  let hostname: string;
  try {
    hostname = new URL(value).hostname;
  } catch {
    throw new Error(`${name} が URL として読めません。E2E はローカル（localhost / 127.0.0.1）にだけ向けられます。`);
  }
  if (!LOCAL_HOSTNAMES.has(hostname)) {
    throw new Error(
      `${name} のホスト（${hostname}）はローカルではありません。E2E はデータを作るため、localhost / 127.0.0.1 にだけ向けられます。`,
    );
  }
  return value;
}

export const API_BASE_URL: string = localBaseUrl("E2E_API_BASE_URL", "http://localhost:3100");

export const APP_BASE_URL: string = localBaseUrl("E2E_APP_BASE_URL", "http://localhost:3101");
