import { expect, test, type Page } from "@playwright/test";

import { accountNav, loginViaUi, readToken, submitLogin, writeToken } from "../support/auth";
import { API_BASE_URL, APP_BASE_URL } from "../support/env";
import { createUser, uniqueSuffix, type TestUser } from "../support/factories";

// 呼んだ時点からのメインフレームの遷移先 URL を記録する。同一ドキュメント内の遷移
// （router.replace による履歴の書き換え）も framenavigated で拾える。
// 最終状態だけを見る toHaveURL / toBeVisible は、/login を経由して元の場所へ戻る往復を
// 見逃す（ログイン済みの人は /login から next へ送り返されるため）。経由した事実を直接見る。
function recordNavigations(page: Page): string[] {
  const urls: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url());
  });
  return urls;
}

// マイページの見出し（ProfileHeader の <h1>{name}</h1>）。ユーザー名で完全一致させる。
function mypageHeading(page: Page, user: Pick<TestUser, "name">) {
  return page.getByRole("heading", { level: 1, name: user.name, exact: true });
}

function expectNeverOnLogin(urls: string[]) {
  expect(urls.filter((url) => new URL(url).pathname === "/login")).toEqual([]);
}

test("登録 → ログイン → ログアウト", async ({ page }) => {
  const suffix = uniqueSuffix();
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
  await submitLogin(page, { email, password });
  await expect(accountNav(page).getByRole("link", { name })).toBeVisible();
});

for (const guarded of ["/mypage", "/posts/new"]) {
  test(`未ログインで ${guarded} を開くと /login?next= へ送られ、ログイン後に戻る`, async ({
    page,
    request,
  }) => {
    const user = await createUser(request);

    await page.goto(guarded);
    await expect(page).toHaveURL(`${APP_BASE_URL}/login?next=${encodeURIComponent(guarded)}`);

    await submitLogin(page, user);

    await expect(page).toHaveURL(`${APP_BASE_URL}${guarded}`);
  });
}

test("ログイン済みでガード付きページを直接ロード・リロードしても /login へ飛ばされない", async ({
  page,
  request,
}) => {
  const user = await createUser(request);
  await loginViaUi(page, user);
  const urls = recordNavigations(page);

  // Link を使わない（クライアント遷移ではハイドレーション経路が露出しない）。
  await page.goto("/mypage");
  await expect(mypageHeading(page, user)).toBeVisible();
  await expect(page).toHaveURL(/\/mypage$/);

  await page.reload();
  await expect(mypageHeading(page, user)).toBeVisible();
  await expect(page).toHaveURL(/\/mypage$/);

  await page.goto("/posts/new");
  await expect(page.getByRole("heading", { level: 1, name: "お題を投稿" })).toBeVisible();
  await expect(page).toHaveURL(/\/posts\/new$/);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "お題を投稿" })).toBeVisible();
  await expect(page).toHaveURL(/\/posts\/new$/);

  expectNeverOnLogin(urls);
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
  await expect(page).toHaveURL(/\/login\?reason=expired&next=%2Fmypage$/);
  await expect.poll(() => readToken(page)).toBeNull();
});

test.describe("バックエンドに届かない状態からの復帰", () => {
  const blockApi = (page: Page) =>
    page.route(`${API_BASE_URL}/**`, (route) => route.abort());

  async function reachUnreachable(page: Page, request: Parameters<typeof createUser>[0]) {
    const user = await createUser(request);
    await loginViaUi(page, user);
    await blockApi(page);
    const urls = recordNavigations(page);
    await page.goto("/mypage");
    return { user, urls };
  }

  test("(a) /login へ飛ばされず、ヘッダーに「再試行」が出る", async ({ page, request }) => {
    const { urls } = await reachUnreachable(page, request);

    // ヘッダーの「再試行」はレイアウトにあり、/login に飛ばされた後にも出る。/mypage の
    // RequireAuth だけが描く本文側の表示で、/mypage に留まっていることを確かめる。
    await expect(page.getByText("サーバーの応答がありません。")).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: "再試行" })).toBeVisible();
    await expect(accountNav(page).getByRole("button", { name: "再試行" })).toBeVisible();
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readToken(page)).not.toBeNull();
    expectNeverOnLogin(urls);
  });

  test("(b) ヘッダーの「再試行」でログイン状態へ戻る", async ({ page, request }) => {
    const { user } = await reachUnreachable(page, request);
    await expect(accountNav(page).getByRole("button", { name: "再試行" })).toBeVisible();

    await page.unroute(`${API_BASE_URL}/**`);
    await accountNav(page).getByRole("button", { name: "再試行" }).click();

    await expect(accountNav(page).getByRole("link", { name: user.name })).toBeVisible();
    await expect(mypageHeading(page, user)).toBeVisible();
  });

  test("(b) ページ側の「再試行」でもログイン状態へ戻る", async ({ page, request }) => {
    const { user } = await reachUnreachable(page, request);
    const pageRetry = page.getByRole("main").getByRole("button", { name: "再試行" });
    await expect(pageRetry).toBeVisible();

    await page.unroute(`${API_BASE_URL}/**`);
    await pageRetry.click();

    await expect(mypageHeading(page, user)).toBeVisible();
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
    await expect.poll(() => readToken(page)).toBeNull();
  });
});

// ログイン済みの人がフォームのページへ来たら、フォームに留まらせず戻り先へ送る
// （login-form.tsx・signup/page.tsx の router.replace(resolveNextPath())）。
test("ログイン済みで /login・/signup を開くと戻り先へ送られる", async ({ page, request }) => {
  const user = await createUser(request);
  await loginViaUi(page, user);

  // 着地先の中身まで確かめる（URL だけでなく、そのページが描かれていること）。
  const topHeading = page.getByRole("heading", { level: 1, name: "言葉だけで、その絵を伝えられますか。" });

  await page.goto("/login");
  await expect(page).toHaveURL(`${APP_BASE_URL}/`);
  await expect(topHeading).toBeVisible();

  await page.goto("/login?next=%2Fmypage");
  await expect(page).toHaveURL(`${APP_BASE_URL}/mypage`);
  await expect(mypageHeading(page, user)).toBeVisible();

  await page.goto("/signup");
  await expect(page).toHaveURL(`${APP_BASE_URL}/`);
  await expect(topHeading).toBeVisible();

  // /signup も ?next= を読んで戻り先へ送る（signup/page.tsx の resolveNextPath）。
  await page.goto("/signup?next=%2Fmypage");
  await expect(page).toHaveURL(`${APP_BASE_URL}/mypage`);
  await expect(mypageHeading(page, user)).toBeVisible();
});

for (const next of ["//evil.example", "%2F%09%2Fevil.example"]) {
  test(`?next=${next} でログインしても外へ出ない`, async ({ page, request }) => {
    const user = await createUser(request);

    await page.goto(`/login?next=${next}`);
    await submitLogin(page, user);

    await expect(accountNav(page).getByRole("link", { name: user.name })).toBeVisible();
    await expect(page).toHaveURL(`${APP_BASE_URL}/`);
    const url = new URL(page.url());
    expect(url.origin).toBe(new URL(APP_BASE_URL).origin);
    expect(url.pathname).toBe("/");
  });
}
