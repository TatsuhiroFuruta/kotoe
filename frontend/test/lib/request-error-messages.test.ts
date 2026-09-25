import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, ApiTimeoutError } from "@/lib/api";
import {
  NETWORK_MESSAGE,
  SERVER_MESSAGE,
  TIMEOUT_MESSAGE,
  toRequestErrorMessage,
} from "@/lib/request-error-messages";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toRequestErrorMessage", () => {
  it("タイムアウトを通信断とは別の文言にする", () => {
    // Render のコールドスタートで必ず通る経路。通信断の文言（通信環境を疑わせる）を
    // 出すと、ユーザーの回線は正常なのに誤診させることになる。
    expect(toRequestErrorMessage(new ApiTimeoutError(15_000))).toBe(TIMEOUT_MESSAGE);
  });

  it("2xx 以外の応答はサーバーエラーの文言にする", () => {
    expect(toRequestErrorMessage(new ApiError(500, "<html>Bad Gateway</html>"))).toBe(
      SERVER_MESSAGE,
    );
  });

  it("fetch 自体の失敗（TypeError）は通信断の文言にする", () => {
    expect(toRequestErrorMessage(new TypeError("Failed to fetch"))).toBe(NETWORK_MESSAGE);
  });

  it("想定外の例外も空文字にせず文言を返し、原文を console.error に残す", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");

    const message = toRequestErrorMessage(error);

    expect(message).not.toBe("");
    expect([TIMEOUT_MESSAGE, NETWORK_MESSAGE, SERVER_MESSAGE]).not.toContain(message);
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), error);
  });

  it("文言は auth の辞書と同じものを指す（同じ文を 2 箇所に持たない）", async () => {
    const { toAuthFormErrors } = await import("@/lib/auth/error-messages");

    expect(toAuthFormErrors(new ApiTimeoutError(15_000)).formError).toBe(TIMEOUT_MESSAGE);
    expect(toAuthFormErrors(new TypeError("Failed to fetch")).formError).toBe(NETWORK_MESSAGE);
    expect(toAuthFormErrors(new ApiError(500, null)).formError).toBe(SERVER_MESSAGE);
  });
});
