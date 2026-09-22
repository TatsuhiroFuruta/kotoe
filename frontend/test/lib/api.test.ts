import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, ApiTimeoutError, apiFetch, apiRequest } from "@/lib/api";
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

/** fetch に渡されたヘッダを取り出す。 */
function sentHeader(fetchMock: ReturnType<typeof stubFetch>, name: string): string | null {
  const init = fetchMock.mock.calls[0]?.[1];
  // new Headers(undefined) は空のヘッダになるので、呼ばれていない場合も落ちない。
  return new Headers(init?.headers).get(name);
}

function sentAuthorization(fetchMock: ReturnType<typeof stubFetch>): string | null {
  return sentHeader(fetchMock, "Authorization");
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

  // ベース URL の連結を検査しないと、fetch(path) と書き換えても全部 green の
  // ままになる（相対 URL は Next のオリジンに解決されるので、テストでは
  // 気づけない）。
  it("NEXT_PUBLIC_API_BASE_URL を前に付けて叩く", async () => {
    const fetchMock = stubFetch(jsonResponse({ posts: [] }));

    await apiFetch("/api/posts");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:3000/api/posts");
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

  // token は送信時にキャプチャした値。応答が返るまでの間に再ログインで
  // 差し替わっていた場合、古い 401 で新しいトークンを消してはいけない。
  it("応答が返るまでに別のトークンへ差し替わっていたら破棄しない", async () => {
    tokenStore.set("jwt-old");
    const fetchMock = vi.fn<typeof fetch>(async () => {
      // 送信後・応答前に再ログインが完了した状況を作る。
      tokenStore.set("jwt-new");
      return jsonResponse({ error: "unauthorized" }, 401);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/api/me")).rejects.toBeInstanceOf(ApiError);

    expect(tokenStore.get()).toBe("jwt-new");
  });

  // 無条件に Content-Type を付けると、FormData でブラウザが付ける
  // multipart の boundary 付きヘッダを潰す（7-3 / 7-5 の画像アップロード）。
  // ボディの無い GET に付けると CORS のプリフライトも毎回増える。
  it("ボディの無いリクエストには Content-Type を付けない", async () => {
    const fetchMock = stubFetch(jsonResponse({ posts: [] }));

    await apiFetch("/api/posts");

    expect(sentHeader(fetchMock, "Content-Type")).toBeNull();
  });

  it("JSON のボディがあれば Content-Type を付ける", async () => {
    const fetchMock = stubFetch(jsonResponse({ id: 1 }, 201));

    await apiFetch("/api/posts", { method: "POST", body: JSON.stringify({ title: "x" }) });

    expect(sentHeader(fetchMock, "Content-Type")).toBe("application/json");
  });

  it("FormData には Content-Type を付けない（boundary はブラウザが決める）", async () => {
    const fetchMock = stubFetch(jsonResponse({ id: 1 }, 201));
    const body = new FormData();
    body.append("post[image]", new Blob(["dummy"]), "image.png");

    await apiFetch("/api/posts", { method: "POST", body });

    expect(sentHeader(fetchMock, "Content-Type")).toBeNull();
  });

  it("呼び出し側が指定した Content-Type を上書きしない", async () => {
    const fetchMock = stubFetch(jsonResponse({ ok: true }));

    await apiFetch("/api/posts", {
      method: "POST",
      body: "raw",
      headers: { "Content-Type": "text/plain" },
    });

    expect(sentHeader(fetchMock, "Content-Type")).toBe("text/plain");
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

/**
 * 応答を返さない fetch のスタブ。signal を尊重し、中断されたら本物の fetch と
 * 同じく signal.reason で reject する。
 *
 * 既存の stubFetch は signal を無視して即座に解決するので、timeout の検査には
 * 使えない（タイマーが発火する前に応答が返ってしまう）。
 */
function stubHangingFetch() {
  const fetchMock = vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("apiRequest の timeout", () => {
  // 上の describe と同じ前処理を置く。今は最後のテストがトークンを残さないので
  // 無くても通るが、そこに依存すると、上にトークンを残すテストが 1 つ増えた
  // だけでこちらのリクエストに Authorization が漏れる。
  beforeEach(() => {
    window.localStorage.clear();
    tokenStore.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // vi.useFakeTimers() は AbortSignal.timeout を制御できない（Node 側の
  // ネイティブ実装が動くため）。15 秒待つテストは書けないので、既定値が
  // 渡されていることだけを引数で検査する。
  it("既定で 15 秒を AbortSignal.timeout に渡す", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    stubFetch(jsonResponse({ posts: [] }));

    await apiFetch("/api/posts");

    expect(spy).toHaveBeenCalledWith(15_000);
  });

  // 実際に時間を経過させる検査は、小さな timeoutMs に上書きして実時間で行う。
  it("応答が返らなければ timeoutMs で ApiTimeoutError を投げる", async () => {
    stubHangingFetch();

    await expect(apiFetch("/api/posts", { timeoutMs: 20 })).rejects.toMatchObject({
      name: "ApiTimeoutError",
      timeoutMs: 20,
    });
  });

  // 合成の片方向。呼び出し側の signal だけを fetch へ渡す実装にすると、
  // signal を渡したリクエストだけが無限に待つようになる。
  it("呼び出し側が signal を渡していても timeout は効く", async () => {
    stubHangingFetch();
    const controller = new AbortController();

    await expect(
      apiFetch("/api/posts", { timeoutMs: 20, signal: controller.signal }),
    ).rejects.toBeInstanceOf(ApiTimeoutError);
  });

  // 合成のもう片方向。呼び出し側のキャンセルは失敗ではないので、
  // ApiTimeoutError に変換してはいけない（7-3b のポーリングがアンマウントの
  // たびにエラー文言を出すことになる）。
  it("呼び出し側が中断したときは AbortError がそのまま流れる", async () => {
    stubHangingFetch();
    const controller = new AbortController();

    const promise = apiFetch("/api/posts", { timeoutMs: 5_000, signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    await expect(promise).rejects.not.toBeInstanceOf(ApiTimeoutError);
  });

  // 呼び出し側が自前の AbortSignal.timeout を渡すと、その中断も name は
  // "TimeoutError" になる。name だけで判定すると、呼び出し側の意図的な
  // 打ち切りを利用者向けの失敗に化けさせ、しかも timeoutMs には無関係な
  // 値（ここでは 5000）が入る。
  it("呼び出し側が渡した AbortSignal.timeout の中断は変換しない", async () => {
    stubHangingFetch();

    const promise = apiFetch("/api/posts", {
      timeoutMs: 5_000,
      signal: AbortSignal.timeout(20),
    });

    await expect(promise).rejects.toMatchObject({ name: "TimeoutError" });
    await expect(promise).rejects.not.toBeInstanceOf(ApiTimeoutError);
  });
});
