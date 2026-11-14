import { expect, test, type Locator } from "@playwright/test";

import { loginViaUi } from "../support/auth";
import { APP_BASE_URL } from "../support/env";
import { createPost, createUser, POST_IMAGE_PATH, uniqueSuffix } from "../support/factories";

// Cloudinary の配信 URL で始まること。ドットはエスケープする（素のままだと任意の 1 文字に一致する）。
const CLOUDINARY_SRC = /^https:\/\/res\.cloudinary\.com\//;

// Cloudinary を通る待ち（アップロード・初回の変換画像の生成）の上限。既定の 5 秒では足りない。
// アプリ側の投稿の待ち上限（post-form.tsx の POST_TIMEOUT_MS）より短く、テストの上限より短くする。
const CLOUDINARY_WAIT_MS = 60_000;

// 正規表現の中で特別な意味を持つ文字をエスケープする（APP_BASE_URL のドットなど）。
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 画像が Cloudinary から実際に読み込めたか。URL の形だけでは 404 でも通ってしまう。
async function expectImageLoaded(img: Locator) {
  await img.scrollIntoViewIfNeeded();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
      timeout: CLOUDINARY_WAIT_MS,
    })
    .toBe(true);
}

// お題の投稿画面（/posts/new）。コアループの前提となるお題を、画面から作れることを確かめる。
// 2026-11-11 にユーザーの判断で追加（設計書のシナリオ E2E② の補足）。
test("ヘッダーの「お題を投稿」から画像とタイトルでお題を投稿できる", async ({ page, request }) => {
  // 既定のテストタイムアウト（30 秒）は、Cloudinary を通る待ち（CLOUDINARY_WAIT_MS）より短い。
  test.setTimeout(120_000);

  const owner = await createUser(request);
  // お題のタイトルの上限は 30 文字（backend の Post・frontend の TITLE_MAX_LENGTH）。今は 27 文字で収まる。
  const title = `E2E 投稿 ${uniqueSuffix()}`.slice(0, 30);

  await loginViaUi(page, owner);
  // ページ本文に同じ名前のリンク（トップの CTA など）ができても取り違えないよう、ヘッダーの中に絞る。
  await page.getByRole("banner").getByRole("link", { name: "お題を投稿" }).click();
  await expect(page).toHaveURL(`${APP_BASE_URL}/posts/new`);

  await page.getByLabel(/画像を選ぶ/).setInputFiles(POST_IMAGE_PATH);
  await expect(page.getByRole("img", { name: "選んだ画像のプレビュー" })).toBeVisible();
  await page.getByLabel("タイトル（任意）").fill(title);
  await page.getByRole("button", { name: "投稿する" }).click();

  // トーストは POST（Rails → Cloudinary へのアップロード）が成功した後に出る。
  await expect(page.getByText("お題を投稿しました")).toBeVisible({ timeout: CLOUDINARY_WAIT_MS });
  await expect(page).toHaveURL(new RegExp(`^${escapeRegExp(APP_BASE_URL)}/posts/\\d+$`));
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  const hero = page.getByRole("img", { name: title, exact: true });
  await expect(hero).toHaveAttribute("src", CLOUDINARY_SRC);
  await expectImageLoaded(hero);
});

test("お題を見て描写し、生成して公開され、別のユーザーがいいねする", async ({
  page,
  request,
  browser,
}) => {
  // 既定のテストタイムアウト（30 秒）は、生成完了を待つ 60 秒の expect より短く、そちらに届く前に
  // テスト全体が打ち切られる。生成を通すのはこのテストだけなので、設定全体ではなくここで延ばす。
  test.setTimeout(120_000);

  // 前提データは API で作る（出題者・お題・挑戦者）。検証したい流れだけを画面で操作する。
  const owner = await createUser(request);
  const title = `E2E ${Date.now()}`;
  const post = await createPost(request, owner, title);
  const challenger = await createUser(request);

  await loginViaUi(page, challenger);

  // トップ → 「お題を探す」→ お題の一覧 → 詳細
  await page.goto("/");
  await page.getByRole("link", { name: "お題を探す" }).click();
  await expect(page).toHaveURL(`${APP_BASE_URL}/posts`);
  // カードは <a> の中に <article> が入る形で、リンク自体にはアクセシブルネームが付かない。
  // タイトルの見出しを含むリンクを選ぶ。
  await page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name: title }) })
    .click();
  await expect(page).toHaveURL(`${APP_BASE_URL}/posts/${post.id}`);

  // 描写を書いて「保存」（下書き）
  await page.getByLabel("描写文").fill("青い空の下に、白い猫が一匹すわっている。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("下書きを保存しました")).toBeVisible();

  // 「画像を生成」→ 生成中 → 公開（Solid Queue のジョブとフロントのポーリングを実際に通す）
  await page.getByRole("button", { name: "画像を生成" }).click();
  await expect(page.getByText("生成中…").first()).toBeVisible();
  await expect(page.getByText("画像が完成し、みんなの挑戦に公開されました")).toBeVisible({
    timeout: 60_000,
  });

  // 比較ビュー
  await page.getByRole("link", { name: "お題と見比べる" }).click();
  await expect(page).toHaveURL(new RegExp(`^${escapeRegExp(APP_BASE_URL)}/attempts/\\d+$`));
  const attemptUrl = page.url();

  const original = page.getByRole("img", { name: title, exact: true });
  const generated = page.getByRole("img", { name: `${challenger.name} さんの再現画像` });
  await expect(original).toBeVisible();
  await expect(generated).toBeVisible();
  await expect(original).toHaveAttribute("src", CLOUDINARY_SRC);
  await expect(generated).toHaveAttribute("src", CLOUDINARY_SRC);
  for (const img of [original, generated]) await expectImageLoaded(img);

  // 別のユーザー（出題者）として、同じ挑戦にいいねする。自分の挑戦には押せない（422）ため。
  const context = await browser.newContext();
  try {
    const ownerPage = await context.newPage();
    await loginViaUi(ownerPage, owner);
    await ownerPage.goto(attemptUrl);

    await expect(ownerPage.getByText("いいね 0", { exact: true })).toBeVisible();
    const like = ownerPage.getByRole("button", { name: "いいね" });
    await like.click();
    await expect(like).toHaveAttribute("aria-pressed", "true");
    await expect(ownerPage.getByText("いいね 1", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
