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

## スマホ実機から開発サーバーを開く（issue 0-6）

モバイル幅を実機で確認するときの手順。**普段の開発では何も設定しない**（設定しなければ
従来どおり動く）。

### 何もしないとどうなるか

Next.js は `/_next/*` へのクロスオリジンアクセスを既定でブロックする。HTML は SSR される
ので画面は出るが、クライアント JS が動かずハイドレーションが完了しない。

| 見え方 | 実際 |
|---|---|
| ボタンをタップしても無反応 | `onClick` が繋がっていない |
| 「確認中…」のまま（エラー表示にもならない） | `useEffect` が走っていない |

**どちらも実装が壊れているようにしか見えない。** 切り分けは下の「症状から原因へ」を見る。

### 手順

1. Mac 側で**ホスト名か IP を調べる**（コンテナ内では取れない。docker のブリッジ IP しか返らない）

   ```bash
   scutil --get LocalHostName   # → <名前>.local で到達できる。DHCP で変わらないのでこちらを推奨
   ipconfig getifaddr en0       # → IP。スマホが .local を解決できないときはこちら
   ```

   `.local`（mDNS）は iOS / Safari なら標準で解決する。Android は端末とブラウザによる。
   解決できないときは「サーバーが見つかりません」と出るだけなので、IP に切り替えればよい。

2. 調べたホストを **3〜4 か所**に書く（`.env.development` は gitignore 済み。実値をコミットしない）

   | ファイル | 変数 | 値の例 |
   |---|---|---|
   | `frontend/.env.development` | `DEV_ALLOWED_HOSTS` | `my-mac.local` |
   | `frontend/.env.development` | `NEXT_PUBLIC_API_BASE_URL` | `http://my-mac.local:3000` |
   | `.env.development` | `CORS_ALLOWED_ORIGINS` | `http://localhost:3001,http://my-mac.local:3001` |
   | `.env.development` | `RAILS_DEVELOPMENT_HOSTS` | `my-mac.local`（**`.local` のときだけ**。IP なら不要） |

3. 作り直す。**`restart` では `env_file` の変更が反映されない**

   ```bash
   docker compose up -d frontend backend
   ```

4. スマホで `http://my-mac.local:3001/` を開く

確認が終わったら `NEXT_PUBLIC_API_BASE_URL` を `http://localhost:3000` に戻す
（`DEV_ALLOWED_HOSTS` と `CORS_ALLOWED_ORIGINS` は残しても普段の開発に影響しない）。

### 症状から原因へ

| 症状 | 原因 | 直し方 |
|---|---|---|
| 画面は出るがタップしても無反応 | Next のクロスオリジンブロック | dev ログに `⚠ Blocked cross-origin request to Next.js dev resource /_next/... from "<host>"` が出る。その `<host>` と `DEV_ALLOWED_HOSTS` が一致しているか見る |
| API だけ 403（Rails の例外ページが返る） | Rails のホスト認証 | `RAILS_DEVELOPMENT_HOSTS` を足す。`config.hosts` は `.localhost` / `.test` と任意の IP しか許していない |
| API が CORS エラー | 許可オリジン不足 | `CORS_ALLOWED_ORIGINS` に `http://<host>:3001` を足す |
| サーバーが見つかりません | mDNS を解決できない端末 | IP に切り替える |
| 設定したのに変わらない | `restart` で env が反映されていない | `docker compose up -d` で作り直す |
| dev サーバーが起動しない | `DEV_ALLOWED_HOSTS` の値を解釈できない | ログにその値が出る。ホスト名かオリジンの形で書き直す |

### スマホを出さずに確認する

ブロックの判定は `Origin` / `Referer` ヘッダだけを見るので、**`curl` で再現できる**。
`/_next/` 配下の存在しないパスを叩き、**403 ならブロック中・404 なら許可済み**と読む
（ブロックはルーティングより前に効くため）。

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Origin: http://my-mac.local:3001" -H "Referer: http://my-mac.local:3001/" \
  http://localhost:3001/_next/static/chunks/does-not-exist.js
```

**ヘッダを付けない `curl` では再現しない**（既定で `Origin` も `Referer` も送らないため 200 が返る）。
7-2.5 の実機確認では、これで「問題なし」と誤判定した。

### 値の書式

`DEV_ALLOWED_HOSTS` は **ホスト名**で比較される（Next が `Origin` を URL パースして
`hostname` だけを見る）。`src/lib/dev/allowed-dev-hosts.ts` が `http://host:3001` や
`host:3001` もホスト名へ正規化するので、隣の `NEXT_PUBLIC_API_BASE_URL` からコピペしても効く。
`192.168.*.*` のようなワイルドカードも書ける（同じ LAN 上の任意のホストが発信元として
許可される点は理解した上で使うこと）。解釈できない値を書くと dev サーバーの起動時に落ちる。
