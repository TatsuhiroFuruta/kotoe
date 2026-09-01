// @vitest-environment node

import { describe, expect, it } from "vitest";

import { tokenStore } from "@/lib/auth/token-store";

// AuthProvider はルートレイアウトに入るため、認証不要ページを含む全ページの
// サーバーレンダリングでここが呼ばれる。落とすとサイト全体が 500 になる。
describe("tokenStore（window が無い環境）", () => {
  it("get は例外を投げず null を返す", () => {
    expect(() => tokenStore.get()).not.toThrow();
    expect(tokenStore.get()).toBeNull();
  });

  it("getServerSnapshot は null を返す", () => {
    expect(tokenStore.getServerSnapshot()).toBeNull();
  });
});
