import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, ApiTimeoutError, apiFetch, apiRequest } from "@/lib/api";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/session-expiry";
import { tokenStore } from "@/lib/auth/token-store";
import { toast, toastStore } from "@/lib/toast/toast-store";

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

/** 失効のトースト。ほかのトーストと混ざっても数を数えられるよう、文言で絞る。 */
function sessionExpiredToasts() {
  return toastStore.get().filter((item) => item.message === SESSION_EXPIRED_MESSAGE);
}

/** トーストのストアはモジュールスコープでテスト間に持ち越されるので、公開 API で空に戻す。 */
function dismissAllToasts() {
  for (const item of toastStore.get()) toast.dismiss(item.id);
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
    dismissAllToasts();
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
    dismissAllToasts();
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

describe("apiRequest の失効の通知", () => {
  beforeEach(() => {
    window.localStorage.clear();
    tokenStore.clear();
    dismissAllToasts();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Authorization を載せたリクエストの 401 で、失効のトーストを 1 件出して失効を記録する", async () => {
    tokenStore.set("jwt-abc");
    stubFetch(jsonResponse({ error: "unauthorized" }, 401));

    await expect(apiFetch("/api/me")).rejects.toBeInstanceOf(ApiError);

    expect(sessionExpiredToasts()).toHaveLength(1);
    expect(tokenStore.wasExpired()).toBe(true);
  });

  // 起動時の復元が開発時の StrictMode で 2 回走る、マイページが並行で叩く、などで起きる。
  // 本数分出ると、同じ文言のトーストが画面の隅に積み上がる。
  it("並行した 401 が 3 本返っても、トーストは 1 件", async () => {
    tokenStore.set("jwt-abc");
    vi.stubGlobal(
      "fetch",
      // Response の本文は 1 回しか読めないので、呼ばれるたびに作る。
      vi.fn<typeof fetch>(async () => jsonResponse({ error: "unauthorized" }, 401)),
    );

    await Promise.allSettled([
      apiFetch("/api/me"),
      apiFetch("/api/posts/1/favorite", { method: "POST" }),
      apiFetch("/api/attempts/1/like", { method: "POST" }),
    ]);

    expect(sessionExpiredToasts()).toHaveLength(1);
  });

  // パスワードの誤り。失効ではない（ログイン画面の赤い枠が担当）。
  it("Authorization を載せていない 401 では出さない", async () => {
    stubFetch(jsonResponse({ error: "invalid_credentials" }, 401));

    await expect(
      apiFetch("/api/auth/sign_in", { method: "POST", skipAuth: true }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(sessionExpiredToasts()).toHaveLength(0);
    expect(tokenStore.wasExpired()).toBe(false);
  });

  // 再ログインで差し替わったあとに古い 401 が返った。今のセッションは生きているので、
  // 「期限切れ」と出すと、ログインし直したばかりの人に誤った指示を出すことになる。
  it("応答を待つ間に別のトークンへ差し替わっていたら出さない", async () => {
    tokenStore.set("jwt-old");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        tokenStore.set("jwt-new");
        return jsonResponse({ error: "unauthorized" }, 401);
      }),
    );

    await expect(apiFetch("/api/me")).rejects.toBeInstanceOf(ApiError);

    expect(sessionExpiredToasts()).toHaveLength(0);
    expect(tokenStore.get()).toBe("jwt-new");
  });

  // 7-2.7 設計書「後続への申し送り 2」。トークンは捨てたのに「応答がありません」と
  // 言われると、黙ってログアウトされたように見える。
  it("401 の本文を読む途中でタイムアウトしたら、ApiTimeoutError ではなく ApiError(401) を投げる", async () => {
    tokenStore.set("jwt-abc");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, init) => {
        // ヘッダまでは届き、本文が届かないまま中断される状況。本物の fetch と同じく、
        // signal が中断されたら本文の読み取りを signal.reason で失敗させる。
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
          },
        });
        return new Response(body, { status: 401 });
      }),
    );

    await expect(apiFetch("/api/me", { timeoutMs: 20 })).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
    });
    expect(sessionExpiredToasts()).toHaveLength(1);
  });

  // 上の変換は「このリクエストで失効させたとき」だけ。401 以外の本文の読み取り中の
  // タイムアウトまで 401 に化けさせてはいけない。
  it("401 以外の本文を読む途中のタイムアウトは ApiTimeoutError のまま", async () => {
    tokenStore.set("jwt-abc");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
          },
        });
        return new Response(body, { status: 200 });
      }),
    );

    await expect(apiFetch("/api/me", { timeoutMs: 20 })).rejects.toBeInstanceOf(ApiTimeoutError);
    expect(tokenStore.get()).toBe("jwt-abc");
  });
});
