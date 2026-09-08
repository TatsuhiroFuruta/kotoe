import { describe, expect, it } from "vitest";

import { deriveAuthState, type AuthStateInput } from "@/lib/auth/derive-auth-state";
import type { User } from "@/types/api";

const user: User = { id: 1, name: "つばき", email: "tsubaki@example.com" };

// 既定は「ハイドレーション済み・トークン無し」。各テストは必要な項目だけ上書きする。
const base: AuthStateInput = {
  hydrated: true,
  token: null,
  session: null,
  restoreFailedFor: null,
};

describe("deriveAuthState", () => {
  it("ハイドレーション前は、トークンがあっても loading を返す", () => {
    // 7-1 で実際に埋め込んだバグ。useSyncExternalStore はハイドレーション中に
    // getServerSnapshot（= null）を返すため、hydrated を先に見ないと、有効な
    // トークンを持つ人を「未ログイン」と誤判定して /login へ飛ばしてしまう。
    expect(deriveAuthState({ ...base, hydrated: false, token: "t1" })).toEqual({
      status: "loading",
    });
  });

  it("トークンが無ければ unauthenticated を返す", () => {
    expect(deriveAuthState({ ...base, token: null })).toEqual({ status: "unauthenticated" });
  });

  it("セッションが現在のトークンのものなら authenticated とユーザーを返す", () => {
    expect(deriveAuthState({ ...base, token: "t1", session: { token: "t1", user } })).toEqual({
      status: "authenticated",
      user,
    });
  });

  it("現在のトークンで復元に失敗していたら unreachable を返す（unauthenticated ではない）", () => {
    // ここを unauthenticated にすると、ヘッダーが「ログイン」を出す一方で
    // tokenStore にはトークンが残り、api.ts は Authorization を載せ続ける。
    expect(deriveAuthState({ ...base, token: "t1", restoreFailedFor: "t1" })).toEqual({
      status: "unreachable",
    });
  });

  it("別のトークンでの復元失敗は引きずらず、loading を返す", () => {
    // 再ログインでトークンが差し替わったケース。restoreFailedFor !== null だけで
    // 判定すると、新しいトークンでの復元が始まる前に unreachable になってしまう。
    expect(deriveAuthState({ ...base, token: "t2", restoreFailedFor: "t1" })).toEqual({
      status: "loading",
    });
  });

  it("別のトークンのセッションは authenticated にせず、loading を返す", () => {
    // session !== null だけで判定すると、トークンが差し替わった直後に
    // 古いユーザーを認証済みとして表示してしまう。
    expect(deriveAuthState({ ...base, token: "t2", session: { token: "t1", user } })).toEqual({
      status: "loading",
    });
  });
});
