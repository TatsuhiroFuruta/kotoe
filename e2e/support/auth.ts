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

// /login で入力して送信し、ヘッダーにユーザー名のリンクが出る（ログイン状態になる）まで待つ。
export async function loginViaUi(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(user.email);
  await page.getByLabel("パスワード", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page
    .getByRole("navigation", { name: "アカウント" })
    .getByRole("link", { name: user.name })
    .waitFor();
}
