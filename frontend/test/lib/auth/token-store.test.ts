import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tokenStore } from "@/lib/auth/token-store";

describe("tokenStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // モジュール内のフォールバック変数も初期化する。
    tokenStore.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("保存したトークンを読み出せる", () => {
    tokenStore.set("jwt-abc");

    expect(tokenStore.get()).toBe("jwt-abc");
  });

  it("clear すると null を返す", () => {
    tokenStore.set("jwt-abc");

    tokenStore.clear();

    expect(tokenStore.get()).toBeNull();
  });

  it("set / clear で購読者に通知する", () => {
    const listener = vi.fn();
    const unsubscribe = tokenStore.subscribe(listener);

    tokenStore.set("jwt-abc");
    tokenStore.clear();

    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    tokenStore.set("jwt-def");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  // プライベートモードや「サイトデータを拒否」設定のブラウザでは
  // localStorage へのアクセス自体が例外を投げる。ここで落とすと、
  // AuthProvider はルートレイアウトに入るのでサイト全体が壊れる。
  it("読み出しが例外を投げる環境でも null を返す", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });

    expect(() => tokenStore.get()).not.toThrow();
    expect(tokenStore.get()).toBeNull();
  });

  // 書き込めない環境でメモリに退避していないと、ログイン直後に
  // 「トークンが読めない＝未ログイン」に戻り、何度ログインしても入れなくなる。
  it("書き込みが例外を投げる環境でも、同じセッション内では読み出せる", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    tokenStore.set("jwt-abc");

    expect(tokenStore.get()).toBe("jwt-abc");
  });
});
