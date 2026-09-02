import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch, apiRequest } from "@/lib/api";
import { tokenStore } from "@/lib/auth/token-store";

/**
 * fetch を差し替え、渡された引数を検査できるようにする。
 *
 * vi.fn に `typeof fetch` を渡すのは、省くと mock.calls が空タプル型になり、
 * calls[0][1] の参照が `npx tsc --noEmit` で型エラーになるため。
 */
function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** fetch に渡された Authorization ヘッダを取り出す。 */
function sentAuthorization(fetchMock: ReturnType<typeof stubFetch>): string | null {
  const init = fetchMock.mock.calls[0]?.[1];
  // new Headers(undefined) は空のヘッダになるので、呼ばれていない場合も落ちない。
  return new Headers(init?.headers).get("Authorization");
}

describe("apiRequest", () => {
  beforeEach(() => {
    window.localStorage.clear();
    tokenStore.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("トークンがあれば Authorization ヘッダを載せる", async () => {
    tokenStore.set("jwt-abc");
    const fetchMock = stubFetch(jsonResponse({ id: 1 }));

    await apiFetch("/api/me");

    expect(sentAuthorization(fetchMock)).toBe("Bearer jwt-abc");
  });

  it("トークンが無ければ Authorization ヘッダを載せない", async () => {
    const fetchMock = stubFetch(jsonResponse({ posts: [] }));

    await apiFetch("/api/posts");

    expect(sentAuthorization(fetchMock)).toBeNull();
  });

  // sign_up / sign_in はログイン中に叩かれても Authorization を載せてはいけない。
  // 載せると、下の「載せた 401 だけ破棄する」判定が崩れる。
  it("skipAuth: true ならトークンがあっても載せない", async () => {
    tokenStore.set("jwt-abc");
    const fetchMock = stubFetch(jsonResponse({ id: 1 }));

    await apiFetch("/api/auth/sign_in", { method: "POST", skipAuth: true });

    expect(sentAuthorization(fetchMock)).toBeNull();
  });

  it("Authorization を載せたリクエストが 401 を返すとトークンを破棄する", async () => {
    tokenStore.set("jwt-abc");
    stubFetch(jsonResponse({ error: "unauthorized" }, 401));

    await expect(apiFetch("/api/me")).rejects.toBeInstanceOf(ApiError);

    expect(tokenStore.get()).toBeNull();
  });

  // ログインのパスワード間違いも Rails は 401 で返す。ここで破棄すると、
  // ログインに失敗するたびに強制ログアウト処理が走る。
  it("Authorization を載せていないリクエストが 401 を返してもトークンを破棄しない", async () => {
    tokenStore.set("jwt-abc");
    stubFetch(jsonResponse({ error: "invalid_credentials" }, 401));

    await expect(
      apiFetch("/api/auth/sign_in", { method: "POST", skipAuth: true }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(tokenStore.get()).toBe("jwt-abc");
  });

  it("204 の空ボディで例外にならない", async () => {
    stubFetch(new Response(null, { status: 204 }));

    await expect(apiFetch("/api/posts/1/favorite", { method: "DELETE" })).resolves.toBeNull();
  });

  // DELETE /api/auth/sign_out は 204 ではなく「ボディが空の 200」を返す
  // （head :ok, content_type: "application/json"）。status === 204 だけを見ていると
  // 空文字列を JSON.parse して SyntaxError になり、ログアウトが必ず失敗する。
  it("ボディが空の 200 で例外にならない", async () => {
    tokenStore.set("jwt-abc");
    stubFetch(new Response(null, { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(apiFetch("/api/auth/sign_out", { method: "DELETE" })).resolves.toBeNull();
  });

  it("2xx 以外では status と body を持つ ApiError を投げる", async () => {
    stubFetch(jsonResponse({ errors: { email: ["taken"] } }, 422));

    await expect(
      apiFetch("/api/auth/sign_up", { method: "POST", skipAuth: true }),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      body: { errors: { email: ["taken"] } },
    });
  });

  it("apiRequest は Response も返す（JWT はヘッダに載って来る）", async () => {
    stubFetch(
      new Response(JSON.stringify({ id: 1, name: "太郎", email: "a@example.com" }), {
        status: 200,
        headers: { "Content-Type": "application/json", Authorization: "Bearer jwt-abc" },
      }),
    );

    const { data, response } = await apiRequest<{ id: number }>("/api/auth/sign_in", {
      method: "POST",
      skipAuth: true,
    });

    expect(data.id).toBe(1);
    expect(response.headers.get("Authorization")).toBe("Bearer jwt-abc");
  });
});
