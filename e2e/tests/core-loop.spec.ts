import { expect, test } from "@playwright/test";

import { loginViaUi } from "../support/auth";
import { APP_BASE_URL } from "../support/env";
import { createPost, createUser } from "../support/factories";

const CLOUDINARY_PREFIX = "https://res.cloudinary.com/";

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

  // お題の一覧 → 詳細
  await page.goto("/posts");
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
  await expect(page).toHaveURL(new RegExp(`^${APP_BASE_URL}/attempts/\\d+$`));
  const attemptUrl = page.url();

  const original = page.getByRole("img", { name: title, exact: true });
  const generated = page.getByRole("img", { name: `${challenger.name} さんの再現画像` });
  await expect(original).toBeVisible();
  await expect(generated).toBeVisible();
  await expect(original).toHaveAttribute("src", new RegExp(`^${CLOUDINARY_PREFIX}`));
  await expect(generated).toHaveAttribute("src", new RegExp(`^${CLOUDINARY_PREFIX}`));
  // URL の形だけでは、Cloudinary に画像が無い（404）ときも通ってしまう。実際に読み込めたかを見る。
  // 比較ビューの <img> は loading="lazy" ではないが、念のため表示領域に入れてから確かめる。
  for (const img of [original, generated]) {
    await img.scrollIntoViewIfNeeded();
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
      .toBe(true);
  }

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
