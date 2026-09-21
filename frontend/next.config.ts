import type { NextConfig } from "next";

// `@/` エイリアスではなく相対パスで import している。
//
// 既定の経路（`next/dist/build/next-config-ts/transpile-config.js` が SWC で変換して
// require フックで読む）では tsconfig の paths が渡されるので `@/` でも解決できる。
// 一方 `--experimental-next-config-strip-types` を付けたときに使われる Node の
// ネイティブ TypeScript 解決では paths が効かない。拡張子の省略もできないため、
// その経路ではどちらの書き方でも解決に失敗し、警告を出して既定の経路へ
// フォールバックする（`.ts` を付ければネイティブ側は解決できるが、今度は
// tsc が TS5097 で落ちるので付けていない）。
import { parseAllowedDevHosts } from "./src/lib/dev/allowed-dev-hosts";

// スマホ実機から開発サーバーを開くときだけ設定する（手順は AGENTS.md）。
// 未設定なら allowedDevOrigins ごと省くので、従来どおりの挙動になる。
// dev サーバー専用の設定で、本番ビルドには影響しない。
const allowedDevHosts = parseAllowedDevHosts(process.env.DEV_ALLOWED_HOSTS);

const nextConfig: NextConfig = {
  ...(allowedDevHosts.length > 0 ? { allowedDevOrigins: allowedDevHosts } : {}),
};

export default nextConfig;
