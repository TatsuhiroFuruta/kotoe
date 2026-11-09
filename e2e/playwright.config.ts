import { defineConfig, devices } from "@playwright/test";

import { APP_BASE_URL } from "./support/env";

// サーバーの起動は設定に含めない。ローカルは scripts/run-local.sh、CI はジョブの手順で
// 用意したものに対して回す。
export default defineConfig({
  testDir: "./tests",
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: APP_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
