import type { NextConfig } from "next";

// `@/` エイリアスではなく相対パスで import すること。コンテナの Node は
// process.features.typescript が有効なため、Next は next.config.ts を
// Node のネイティブ TypeScript 解決で読み込む。この経路では tsconfig.json の
// paths が効かず、`@/lib/...` は解決できない。
import { parseAllowedDevHosts } from "./src/lib/dev/allowed-dev-hosts";

// スマホ実機から開発サーバーを開くときだけ設定する（手順は AGENTS.md）。
// 未設定なら allowedDevOrigins ごと省くので、従来どおりの挙動になる。
// dev サーバー専用の設定で、本番ビルドには影響しない。
const allowedDevHosts = parseAllowedDevHosts(process.env.DEV_ALLOWED_HOSTS);

const nextConfig: NextConfig = {
  ...(allowedDevHosts.length > 0 ? { allowedDevOrigins: allowedDevHosts } : {}),
};

export default nextConfig;
