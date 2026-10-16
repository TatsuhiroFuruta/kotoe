import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestSignOut } from "@/lib/auth/sign-out-request";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/session-expiry";
import { tokenStore } from "@/lib/auth/token-store";
import { toast, toastStore } from "@/lib/toast/toast-store";

function stubFetch(status: number) {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(status === 200 ? null : JSON.stringify({ error: "unauthorized" }), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("requestSignOut", () => {
  beforeEach(() => {
    window.localStorage.clear();
    tokenStore.clear();
    for (const item of toastStore.get()) toast.dismiss(item.id);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // サーバー側でトークンを失効させるには、どのトークンかを伝える必要がある。
  it("今のトークンを Authorization に載せて DELETE する", async () => {
    tokenStore.set("jwt-abc");
    const fetchMock = stubFetch(200);

    await requestSignOut();

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("DELETE");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer jwt-abc");
  });

  // 前日から開いたままのタブでログアウトを押すと、トークンは既に失効していて 401 が返る。
  // 自分から抜けようとした人に「もう一度ログインしてください」と出してはいけない
  // （7-2.6 設計書「経路ごとの見え方」：ログアウトは何も出ない）。
  it("失効したトークンで 401 が返っても、失効のトーストを出さず、失効として記録しない", async () => {
    tokenStore.set("jwt-expired");
    stubFetch(401);

    await expect(requestSignOut()).rejects.toThrow();

    expect(toastStore.get().filter((item) => item.message === SESSION_EXPIRED_MESSAGE)).toHaveLength(0);
    expect(tokenStore.wasExpired()).toBe(false);
  });

  it("トークンが無ければリクエストを出さない", async () => {
    const fetchMock = stubFetch(200);

    await requestSignOut();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
