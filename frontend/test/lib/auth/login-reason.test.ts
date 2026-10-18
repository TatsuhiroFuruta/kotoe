import { describe, expect, it } from "vitest";

import { LOGIN_REASON_EXPIRED, loginPathFor, parseLoginReason } from "@/lib/auth/login-reason";

describe("parseLoginReason", () => {
  it('"expired" だけを通す', () => {
    expect(parseLoginReason("expired")).toBe("expired");
  });

  // ?reason= は誰でも書ける。完全に一致しないものは、それらしく見えても通さない。
  it.each([
    ["未指定", undefined],
    ["空文字", ""],
    ["大文字", "EXPIRED"],
    ["前後の空白", " expired "],
    ["別の値", "foo"],
    ["同じキーが 2 つ（配列で来る）", ["expired", "expired"]],
  ])("%s は null", (_label, raw) => {
    expect(parseLoginReason(raw)).toBeNull();
  });
});

describe("loginPathFor", () => {
  it("失効でなければ next だけを付ける（今までの URL と同じ）", () => {
    expect(loginPathFor("/posts/new", false)).toBe("/login?next=%2Fposts%2Fnew");
  });

  it("失効なら reason=expired を付ける", () => {
    expect(loginPathFor("/posts/new", true)).toBe("/login?reason=expired&next=%2Fposts%2Fnew");
  });

  // 戻り先のクエリが /login のクエリに混ざると、next が途中で切れ、reason を上書きされる。
  it("戻り先のクエリはエンコードして next の中に閉じ込める", () => {
    const path = loginPathFor("/posts/1?sort=likes&reason=x", true);
    const params = new URLSearchParams(path.split("?")[1]);

    expect(params.get("next")).toBe("/posts/1?sort=likes&reason=x");
    expect(params.getAll("reason")).toEqual([LOGIN_REASON_EXPIRED]);
  });

  // 送る側（RequireAuth）と受ける側（ログイン画面）の文字列が食い違うと、枠が二度と出ない。
  it("組み立てた URL の reason は parseLoginReason を通る", () => {
    const params = new URLSearchParams(loginPathFor("/posts/new", true).split("?")[1]);

    expect(parseLoginReason(params.get("reason") ?? undefined)).toBe("expired");
  });
});
