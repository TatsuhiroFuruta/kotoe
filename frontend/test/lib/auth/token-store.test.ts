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

  describe("expire", () => {
    it("中身が同じトークンなら捨てて true を返し、失効として記録する", () => {
      tokenStore.set("jwt-abc");

      expect(tokenStore.expire("jwt-abc")).toBe(true);

      expect(tokenStore.get()).toBeNull();
      expect(tokenStore.wasExpired()).toBe(true);
    });

    // 送信時のトークンと今のトークンが違う＝応答を待つ間に再ログインした。
    // 古い 401 で新しいトークンを消すと、ログイン直後に未ログインへ戻される。
    it("中身が別のトークンなら何もせず false を返す", () => {
      tokenStore.set("jwt-new");

      expect(tokenStore.expire("jwt-old")).toBe(false);

      expect(tokenStore.get()).toBe("jwt-new");
      expect(tokenStore.wasExpired()).toBe(false);
    });

    // 並行した 401 の 2 本目以降。ここで true を返すと、トーストが本数分出る。
    it("すでに捨てられていれば false を返す", () => {
      tokenStore.set("jwt-abc");
      tokenStore.expire("jwt-abc");

      expect(tokenStore.expire("jwt-abc")).toBe(false);
    });

    // AuthProvider は通知を受けて token と wasExpired を読み直す。記録を通知の後に
    // 書くと、「トークンは消えたが失効ではない」描画が 1 回挟まり、その描画で
    // RequireAuth が ?reason= 無しの URL へ送ってしまう。
    it("通知の時点で wasExpired() はすでに true", () => {
      tokenStore.set("jwt-abc");
      let seen: boolean | null = null;
      const unsubscribe = tokenStore.subscribe(() => {
        seen = tokenStore.wasExpired();
      });

      tokenStore.expire("jwt-abc");

      expect(seen).toBe(true);
      unsubscribe();
    });

    it("set（ログイン）で失効の記録を消す", () => {
      tokenStore.set("jwt-abc");
      tokenStore.expire("jwt-abc");

      tokenStore.set("jwt-new");

      expect(tokenStore.wasExpired()).toBe(false);
    });

    it("clear（ログアウト）で失効の記録を消す", () => {
      tokenStore.set("jwt-abc");
      tokenStore.expire("jwt-abc");

      tokenStore.clear();

      expect(tokenStore.wasExpired()).toBe(false);
    });

    // 失効の記録が残ったまま、別タブでログイン → ログアウトされると、
    // こちらのタブは「期限切れ」でログイン画面へ送ってしまう。
    it("ほかのタブがトークンを変えたら（storage イベント）失効の記録を消す", () => {
      const unsubscribe = tokenStore.subscribe(() => {});
      tokenStore.set("jwt-abc");
      tokenStore.expire("jwt-abc");

      window.dispatchEvent(new StorageEvent("storage", { key: "kotoe.auth.token" }));

      expect(tokenStore.wasExpired()).toBe(false);
      unsubscribe();
    });

    it("無関係なキーの storage イベントでは消さない", () => {
      const unsubscribe = tokenStore.subscribe(() => {});
      tokenStore.set("jwt-abc");
      tokenStore.expire("jwt-abc");

      window.dispatchEvent(new StorageEvent("storage", { key: "other.key" }));

      expect(tokenStore.wasExpired()).toBe(true);
      unsubscribe();
    });
  });
});
