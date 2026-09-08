import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { toAuthFormErrors } from "@/lib/auth/error-messages";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toAuthFormErrors", () => {
  it("401 invalid_credentials をフォーム全体のエラーに翻訳する", () => {
    const result = toAuthFormErrors(new ApiError(401, { error: "invalid_credentials" }));

    expect(result.formError).toBe("メールアドレスまたはパスワードが正しくありません");
    expect(result.fieldErrors).toEqual({});
  });

  it("422 のフィールド別エラーコードを翻訳する", () => {
    const result = toAuthFormErrors(new ApiError(422, { errors: { email: ["taken"] } }));

    expect(result.formError).toBeNull();
    expect(result.fieldErrors).toEqual({
      email: "このメールアドレスは既に登録されています",
    });
  });

  it("未知のエラーコードでも、空文字ではなくコードが分かる文言を返す", () => {
    // Rails 側にバリデーションが増えたとき、画面から何も出ない
    //（「押しても何も起きない」）状態にしないための保険。
    const result = toAuthFormErrors(new ApiError(422, { errors: { password: ["too_weak"] } }));

    expect(result.fieldErrors.password).toContain("password");
    expect(result.fieldErrors.password).toContain("too_weak");
  });

  it("fetch 自体の失敗（TypeError）を通信エラーとして扱う", () => {
    const result = toAuthFormErrors(new TypeError("Failed to fetch"));

    expect(result.formError).toBe("サーバーに接続できませんでした。通信環境を確認してください");
    expect(result.fieldErrors).toEqual({});
  });

  it("500 で JSON でないボディが返ってもサーバーエラーとして扱う", () => {
    // Render のプロキシや Vercel のエラーページは HTML を返す。
    // api.ts はそれを生の文字列のまま body に入れる（parseBody）。
    const result = toAuthFormErrors(new ApiError(500, "<html>Internal Server Error</html>"));

    expect(result.formError).toBe("サーバーでエラーが発生しました。時間をおいて再度お試しください");
  });

  it("想定外の例外は文言を返しつつ、原文を console.error に残す", () => {
    // extractToken が投げる Error（CORS の expose 設定が壊れている）がここに来る。
    // 握り潰すと「ログインは成功しているのに入れない」の原因が追えなくなる。
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("Authorization ヘッダから JWT を取得できませんでした");

    const result = toAuthFormErrors(error);

    expect(result.formError).toBe("認証に失敗しました。時間をおいて再度お試しください");
    expect(spy).toHaveBeenCalledWith(expect.any(String), error);
  });
});
