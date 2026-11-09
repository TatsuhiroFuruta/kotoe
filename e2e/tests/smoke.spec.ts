import { expect, test } from "@playwright/test";

import { API_BASE_URL } from "../support/env";

test("API の health が 200", async ({ request }) => {
  const response = await request.get(`${API_BASE_URL}/api/health`);
  expect(response.ok()).toBe(true);
});

test("トップが開き、お題を探すへ進める", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "お題を探す" }).first().click();
  await expect(page).toHaveURL(/\/posts$/);
});
