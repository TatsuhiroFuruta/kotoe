import { expect, test, type Page } from "@playwright/test";

import { loginViaUi, readToken, writeToken } from "../support/auth";
import { API_BASE_URL, APP_BASE_URL } from "../support/env";
import { createUser } from "../support/factories";

// ヘッダー右側のナビ（aria-label="アカウント"）。loading 以外では常に存在するので、
// 中身（ユーザー名のリンク・ログアウト・再試行）で状態を見分ける。
function accountNav(page: Page) {
  return page.getByRole("navigation", { name: "アカウント" });
}

test("登録 → ログイン → ログアウト", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const name = `e2e-signup-${suffix}`;
  const email = `e2e-signup-${suffix}@example.com`;
  const password = "password123";

  await page.goto("/signup");
  await page.getByLabel("名前").fill(name);
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード（6文字以上）").fill(password);
  await page.getByRole("button", { name: "登録する" }).click();

  await expect(accountNav(page).getByRole("link", { name })).toBeVisible();
  expect(await readToken(page)).not.toBeNull();

  await accountNav(page).getByRole("button", { name: "ログアウト" }).click();
  await expect(accountNav(page).getByRole("link", { name: "ログイン" })).toBeVisible();
  expect(await readToken(page)).toBeNull();

  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(accountNav(page).getByRole("link", { name })).toBeVisible();
});

test("未ログインでガード付きページを開くと /login?next= へ送られ、ログイン後に戻る", async ({
  page,
  request,
}) => {
  const user = await createUser(request);

  await page.goto("/mypage");
  await expect(page).toHaveURL(/\/login\?next=%2Fmypage$/);

  await page.getByLabel("メールアドレス").fill(user.email);
  await page.getByLabel("パスワード", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  await expect(page).toHaveURL(/\/mypage$/);
  await expect(page.getByRole("heading", { level: 1, name: user.name })).toBeVisible();
});

test("ログイン済みでガード付きページを直接ロード・リロードしても /login へ飛ばされない", async ({
  page,
  request,
}) => {
  const user = await createUser(request);
  await loginViaUi(page, user);

  // Link を使わない（クライアント遷移ではハイドレーション経路が露出しない）。
  await page.goto("/mypage");
  await expect(page.getByRole("heading", { level: 1, name: user.name })).toBeVisible();
  await expect(page).toHaveURL(/\/mypage$/);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: user.name })).toBeVisible();
  await expect(page).toHaveURL(/\/mypage$/);

  await page.goto("/posts/new");
  await expect(page.getByRole("heading", { level: 1, name: "お題を投稿" })).toBeVisible();
  await expect(page).toHaveURL(/\/posts\/new$/);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "お題を投稿" })).toBeVisible();
  await expect(page).toHaveURL(/\/posts\/new$/);
});

test("ログアウトしたトークンを戻すと 401 になり、フロントが破棄する", async ({
  page,
  request,
}) => {
  const user = await createUser(request);
  await loginViaUi(page, user);

  const oldToken = await readToken(page);
  expect(oldToken).not.toBeNull();

  await accountNav(page).getByRole("button", { name: "ログアウト" }).click();
  await expect(accountNav(page).getByRole("link", { name: "ログイン" })).toBeVisible();

  const response = await request.get(`${API_BASE_URL}/api/me`, {
    headers: { Authorization: `Bearer ${oldToken}` },
  });
  expect(response.status()).toBe(401);

  await writeToken(page, oldToken!);
  await page.goto("/mypage");
  await expect(page).toHaveURL(/\/login/);
  await expect.poll(() => readToken(page)).toBeNull();
});

test.describe("バックエンドに届かない状態からの復帰", () => {
  const blockApi = (page: Page) =>
    page.route(`${API_BASE_URL}/**`, (route) => route.abort());

  async function reachUnreachable(page: Page, request: Parameters<typeof createUser>[0]) {
    const user = await createUser(request);
    await loginViaUi(page, user);
    await blockApi(page);
    await page.goto("/mypage");
    return user;
  }

  test("(a) /login へ飛ばされず、ヘッダーに「再試行」が出る", async ({ page, request }) => {
    await reachUnreachable(page, request);

    await expect(accountNav(page).getByRole("button", { name: "再試行" })).toBeVisible();
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readToken(page)).not.toBeNull();
  });

  test("(b) ヘッダーの「再試行」でログイン状態へ戻る", async ({ page, request }) => {
    const user = await reachUnreachable(page, request);
    await expect(accountNav(page).getByRole("button", { name: "再試行" })).toBeVisible();

    await page.unroute(`${API_BASE_URL}/**`);
    await accountNav(page).getByRole("button", { name: "再試行" }).click();

    await expect(accountNav(page).getByRole("link", { name: user.name })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: user.name })).toBeVisible();
  });

  test("(b) ページ側の「再試行」でもログイン状態へ戻る", async ({ page, request }) => {
    const user = await reachUnreachable(page, request);
    const pageRetry = page.getByRole("main").getByRole("button", { name: "再試行" });
    await expect(pageRetry).toBeVisible();

    await page.unroute(`${API_BASE_URL}/**`);
    await pageRetry.click();

    await expect(page.getByRole("heading", { level: 1, name: user.name })).toBeVisible();
    await expect(accountNav(page).getByRole("link", { name: user.name })).toBeVisible();
  });

  test("(c) 届かないままヘッダーの「ログアウト」で未ログインへ抜けられる", async ({
    page,
    request,
  }) => {
    await reachUnreachable(page, request);
    await expect(accountNav(page).getByRole("button", { name: "再試行" })).toBeVisible();

    await accountNav(page).getByRole("button", { name: "ログアウト" }).click();

    await expect(accountNav(page).getByRole("link", { name: "ログイン" })).toBeVisible();
    expect(await readToken(page)).toBeNull();
  });
});

for (const next of ["//evil.example", "%2F%09%2Fevil.example"]) {
  test(`?next=${next} でログインしても外へ出ない`, async ({ page, request }) => {
    const user = await createUser(request);

    await page.goto(`/login?next=${next}`);
    await page.getByLabel("メールアドレス").fill(user.email);
    await page.getByLabel("パスワード", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "ログイン", exact: true }).click();

    await expect(accountNav(page).getByRole("link", { name: user.name })).toBeVisible();
    await expect(page).toHaveURL(`${APP_BASE_URL}/`);
    const url = new URL(page.url());
    expect(url.origin).toBe(new URL(APP_BASE_URL).origin);
    expect(url.pathname).toBe("/");
  });
}
