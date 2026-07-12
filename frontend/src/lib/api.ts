// Rails API を叩く共通クライアント。個別コンポーネントで直接 fetch しない。
// JWT を Authorization ヘッダに載せる処理は issue 7-1 でここに足す。

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

/** API が 2xx 以外を返したときのエラー。文言は呼び出し側（UI）が決める。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL が設定されていません");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  // 204 No Content にはボディがない。
  const body = response.status === 204 ? null : await response.json();

  if (!response.ok) {
    throw new ApiError(response.status, body);
  }

  return body as T;
}
