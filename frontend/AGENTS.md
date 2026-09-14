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

**症状**：ソースを読むと正しいのに、ブラウザの表示だけが古い。2026-09-08・09-13・09-14（2 回）の計 4 回踏んでいる。
**4 件すべて `globals.css` の変更で起きている。** 最初の 2 件は 7-2 で削除したはずの `prefers-color-scheme: dark` が
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

## 2026-09-14 の観測（1 日に 2 回。どちらも `globals.css`）

7-2.5（トースト）の作業中に 2 回踏んだ。**どちらも配信物とソースが食い違い、
`rm -rf .next` ＋ restart で解消**した。

| # | 直前の操作 | 症状 |
|---|---|---|
| 1 | `globals.css` の**末尾に追記**（サーバー稼働中・ブランチ切り替えなし） | 追記した `@keyframes` が配信 CSS に出ない |
| 2 | PR マージ後に `git switch` でブランチ切り替え（サーバー稼働中） | 配信 CSS の `toast-in` が **0 件**、ソースは 5 件 |

**「ブランチ切り替えが原因」とは言えない。** 1 が単発の追記で起きている以上、切り替えは
必要条件ではない。ただし 2 は多数のファイルが一度に入れ替わるぶん**気づきにくい**
（自分が編集した覚えのないファイルまで古くなるため、どこを疑えばいいか分からなくなる）。

**分かっているのは「これまでの 4 件すべてが `globals.css` の変更で起きている」ことだけ。**
JS 側の stale は一度も観測していない。CSS だけの問題なのか、単に CSS の方が目で気づき
やすいだけなのかは区別できていない。

**実務上の構え**：

- **`globals.css` を触った直後は、配信物を 1 回 curl で確認してから先に進む。** 上の切り分け
  コマンドを使う。症状が実装ミスに見えるので、後から疑うのは難しい
- **dev サーバーを動かしたまま別ブランチの作業をするなら、切り替えではなく worktree を使う。**
  現在のチェックアウトのファイルが動かないので 2 の状況自体が発生しない

```bash
git worktree add -b docs/xxx /path/to/scratch origin/main
#   … そこで編集・コミット・push …
git worktree remove /path/to/scratch
```

**分かっていないこと**：確実な再現手順は依然として特定できていない。「サーバー停止中にファイルを変更」
「稼働中に変更して元に戻す」のどちらも、意図的に再現させようとすると正常に反映されることが多い。
`experimental.turbopackFileSystemCacheForDev: false` も試したが、**防げる証拠は得られず**
（当時観測できた stale はこのフラグを入れた状態で起きていた）、初回リクエストが 0.42 秒から 2.0 秒に
延びるだけだったので採用していない。**機構が分からないまま設定で塞ごうとせず、上の対処で直すこと。**
