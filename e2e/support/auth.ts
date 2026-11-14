import type { Page } from "@playwright/test";

import type { TestUser } from "./factories";

// frontend/src/lib/auth/token-store.ts の STORAGE_KEY。値は JWT の文字列そのもの
// （JSON ではなく、"Bearer " も付かない）。
const TOKEN_STORAGE_KEY = "kotoe.auth.token";

export async function readToken(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), TOKEN_STORAGE_KEY);
}

export async function writeToken(page: Page, token: string): Promise<void> {
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [
    TOKEN_STORAGE_KEY,
    token,
  ]);
}

// ヘッダー右側のナビ（aria-label="アカウント"）。ユーザー名のリンク・「お題を投稿」・ログアウト・
// 再試行が入る。loading 以外では常に存在するので、中身で状態を見分ける。
export function accountNav(page: Page) {
  return page.getByRole("navigation", { name: "アカウント" });
}

// 開いているログインフォームに入力して送信する。送信後の状態は待たない（呼び出し側が確かめる）。
export async function submitLogin(
  page: Page,
  user: Pick<TestUser, "email" | "password">,
): Promise<void> {
  await page.getByLabel("メールアドレス").fill(user.email);
  await page.getByLabel("パスワード", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
}

// /login で入力して送信し、ヘッダーにユーザー名のリンクが出る（ログイン状態になる）まで待つ。
export async function loginViaUi(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await submitLogin(page, user);
  await accountNav(page)
    .getByRole("link", { name: user.name })
    .waitFor();
}
