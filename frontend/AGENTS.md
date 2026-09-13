<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

> 上のブロックは自動生成。以下は Kotoe 固有の追記。

**補足：`node_modules/next/dist/docs/` は、現在インストールされている next 16.2.10 には存在しない。**
API の確認は型定義（`node_modules/next/dist/**/*.d.ts`）とコンパイル済みの実装を直接読むこと。
設定キーは改名されていることがある（例：`experimental.turbopackPersistentCaching` は
`turbopackFileSystemCacheForDev` / `...ForBuild` に分割・改名済み）。

## 「動くけれど見た目だけ古い」ときは Turbopack の dev キャッシュを疑う

**症状**：ソースを読むと正しいのに、ブラウザの表示だけが古い。2026-09-08 と 09-13 に 2 回踏んでいる。
どちらも `globals.css` の変更が反映されず、7-2 で削除したはずの `prefers-color-scheme: dark` が
配信され続けて、背景が黒くなった。

**なぜ厄介か**：ソースは正しいので、コードを読んでも原因に辿り着けない。**実装ミスと誤診しやすい**。
スクリーンショットでも判断できない（「色が変わらない」としか分からない）。
ブラウザのキャッシュでもないので、スーパーリロードでも直らない。

**切り分け**：配信されている CSS を直接見る。これが唯一確実。

```bash
CSS=$(curl -s http://localhost:3001/ | grep -oE '/_next/static/[^"]*\.css' | head -1)
curl -s "http://localhost:3001$CSS" | grep -oE -- '--color-canvas:[^;]*'
```

ソース（`src/app/globals.css`）の値と食い違えばキャッシュ、一致すれば実装側の問題。

**対処**：`.next` ごと消して再起動する。**単なる再起動では直らないことがある**
（09-13 のケースは、コンテナを作り直した直後でも古いままだった）。

```bash
docker compose exec frontend rm -rf .next && docker compose restart frontend
```

**分かっていないこと**：確実な再現手順は特定できていない。「サーバー停止中にファイルを変更」
「稼働中に変更して元に戻す」のどちらも、意図的に再現させようとすると正常に反映されることが多い。
`experimental.turbopackFileSystemCacheForDev: false` も試したが、**防げる証拠は得られず**
（唯一観測できた stale はこのフラグを入れた状態で起きた）、初回リクエストが 0.42 秒から 2.0 秒に
延びるだけだったので採用していない。**機構が分からないまま設定で塞ごうとせず、上の対処で直すこと。**
