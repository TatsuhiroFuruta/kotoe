import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Vitest は Next.js のビルドを経由しないので、tsconfig.json の paths も
// NEXT_PUBLIC_* の埋め込みも効かない。どちらもここで自前に用意する。
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // token-store と api は localStorage と Response を触るため DOM が要る。
    // window が無い場合（SSR）の検査だけは、ファイル先頭の
    // `// @vitest-environment node` で node に切り替える。
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    env: {
      // api.ts はモジュール読み込み時にこれを読む。未設定だと全テストが落ちる。
      NEXT_PUBLIC_API_BASE_URL: "http://localhost:3000",
    },
  },
});
