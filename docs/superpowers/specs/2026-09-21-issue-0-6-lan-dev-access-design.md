# issue 0-6 スマートフォン実機から開発サーバーを開けるようにする 設計

- 対象 issue：`docs/issues_backlog.md` 0-6（GitHub #107）
- 依存：0-3（Next.js プロジェクト作成）、2-2（CORS）
- 作成日：2026-09-21
- 前提：`frontend/AGENTS.md`（Next 16.2.10 の API は型定義とコンパイル済み実装を直接読む）
- 前提：CLAUDE.md「動作確認・デプロイの進め方」①（issue ごとの確認はローカルのブラウザで行う）

## この issue で作るもの

**同じ Wi-Fi のスマートフォンから、ローカルの開発サーバーを開いて動作確認できる状態。**
「画面が出る」だけでなく、**ログイン・一覧・詳細といった API を叩く画面まで動く**ところまでを対象にする。

実装コードの変更は `frontend/next.config.ts` と、そこから呼ぶ純粋関数 1 本だけ。
残りは環境変数の例と手順書で、**バックエンドのコードは 1 行も変更しない**。

## なぜ実装バグに見えるのか

Next.js は dev リソース（`/_next/*`）へのクロスオリジンアクセスを既定でブロックする。
HTML は SSR されるので画面は出るが、クライアント JS が落ちてハイドレーションが完了しない。
結果として「ボタンが無反応」「`useEffect` が走らない」という、**実装が壊れているとしか
見えない**症状になる。issue 本文のとおり、切り分けは dev サーバーのログで行う。

判定しているのは
`frontend/node_modules/next/dist/server/lib/router-utils/block-cross-site-dev.js`。
読んだ結果、設計に効く事実が 1 つある。

```js
const allowedOrigins = ['*.localhost', 'localhost', ...allowedDevOrigins ?? []];
if (hostname) { allowedOrigins.push(hostname); }
// ...
const parsedOrigin = originHeader && originHeader !== 'null' ? parseUrl(originHeader) : originHeader;
const originLowerCase = /* ... */ parsedOrigin.hostname.toLowerCase();
return originLowerCase !== undefined && !isCsrfOriginAllowed(originLowerCase, allowedOrigins) && blockRequest(...);
```

**`allowedDevOrigins` は「オリジン」ではなく「ホスト名」と比較される。**
`Origin`（無ければ `Referer`）を URL パースした `hostname` が比較対象なので、
`http://192.168.x.x:3001` のようなオリジン形式を書いても**エラーも警告も出ないまま
永久に一致しない**。症状は「設定する前」と区別が付かない。この罠への対処が下の決定 1。

`isCsrfOriginAllowed`（`server/app-render/csrf-protection.js`）はドット区切りの
ワイルドカードを解釈するため、`192.168.*.*` のような書き方も通る。

## 調べて分かったこと（2026-09-21 実測）

| 確認したこと | 結果 |
|---|---|
| Rails 開発環境の `config.hosts` | `[".localhost", ".test", 0.0.0.0/0, ::/0]` |
| `http://<IP>:3000/api/health` | **200**（任意の IP はホスト認証を通る） |
| `http://<mac>.local:3000/api/health` | **403**（`.local` は上のどれにも当たらない） |
| `RAILS_DEVELOPMENT_HOSTS=<mac>.local` | `config.hosts` に追加される（コード変更不要） |
| `http://<mac>.local:3001/`（Next dev） | 200 |
| コンテナの Node | v24.19.0 / `process.features.typescript === true` |
| `.env.development` 3 本 | すべて gitignore 済み。追跡されているのは `.env.example` 3 本だけ |

つまり **Rails 側に必要なのは env の追加だけ**で、`CORS_ALLOWED_ORIGINS` も
`RAILS_DEVELOPMENT_HOSTS` もコードを触らずに足せる。

## 決めたこと

### 1. env は `DEV_ALLOWED_HOSTS`（カンマ区切り）。書式は実装側で正規化する

issue 本文の案は `DEV_LAN_ORIGIN` だが、比較対象がホスト名である以上、オリジン形式の
値をそのまま渡すと無言で効かない。**どの書式で書いても同じ結果になるよう 1 本の経路に
寄せる**：`://` を含まなければ `http://` を前置し、`new URL(...).hostname` を取る。

| env に書いた値 | `allowedDevOrigins` に渡る値 |
|---|---|
| `192.168.x.x` | `192.168.x.x` |
| `http://192.168.x.x:3001` | `192.168.x.x` |
| `192.168.x.x:3001` | `192.168.x.x` |
| `192.168.*.*` | `192.168.*.*`（ワイルドカードは壊れない） |
| `<mac>.local` | `<mac>.local`（小文字化される） |
| `not a host` | 例外（決定 3） |

隣接する `NEXT_PUBLIC_API_BASE_URL` と `CORS_ALLOWED_ORIGINS` はオリジン形式なので、
**3 か所を書くときにコピペしても事故らない**ことを優先する。複数値を許すのは、
スマホとタブレットを並行で見る場合と、ワイルドカードと実 IP を併記する場合のため。

### 2. 未設定なら `allowedDevOrigins` を設定しない

空・未設定は空配列を返し、`next.config.ts` はキー自体を置かない。
他の開発者・CI・本番の挙動は現状と完全に同じになる。
`allowedDevOrigins` は dev サーバーでしか読まれないため、本番ビルドへの影響はそもそも無い。

### 3. 不正な値は dev サーバーの起動を止める

`new URL()` が投げたら、値を含むエラーにして再送出する。黙って捨てると、この issue が
警告している「無反応＝実装バグに見える」状態に戻ってしまう。**dev 専用の設定なので、
落として気づかせるほうが安い。**

### 4. `next.config.ts` からの import は相対パスで書く

コンテナの Node は v24.19.0 で `process.features.typescript === true` のため、Next は
`transpileConfig`（`build/next-config-ts/transpile-config.js`）の分岐で **Node ネイティブの
TypeScript 解決**を使い、`next.config.ts` をそのまま `import()` する。この経路では
`tsconfig.json` の `paths` が効かないので、`@/lib/...` ではなく
`./src/lib/dev/allowed-dev-hosts` と書く。

### 5. スマホから Mac を指すのは `<mac>.local` を第一、IP を代替とする（両対応）

IP は DHCP で変わりうるので、変わるたびに 3 か所を書き直すことになる。
Bonjour 名（`scutil --get LocalHostName` の値 + `.local`）は DHCP と無関係なので、
**一度書けば以降の書き換えが原則ゼロ**になる。実装は値をホスト名として扱うだけなので、
どちらでも同じコードで通る。

`.local` の唯一の不確実要素は、スマホ側が mDNS を解決できるかどうか（iOS / Safari は標準で
解決する。Android は端末とブラウザによる）。解決できない場合は「サーバーが見つかりません」と
出るだけで、今回の紛らわしい症状にはならないため、**手順書は「まず `.local`、ダメなら IP」の
順で書く**。

`.local` を使う場合は Rails 側に `RAILS_DEVELOPMENT_HOSTS` が追加で必要になる（上の実測表）。
これも無設定だと 403 が返るだけで原因が読み取りにくいので、手順書に症状とセットで書く。

### 6. 実 IP・実ホスト名を、コミットされる場所に書かない

`.env.development` は 3 本とも gitignore 済みなので、**設定値そのものは push されない**。
一方で `.env.example` / `AGENTS.md` / この設計書 / PR 本文は**コミットされる**。
これらには `192.168.x.x` や `<mac>.local` のプレースホルダのみを書く。

### 7. dev だけ Next 経由で API をプロキシする案は採らない

`rewrites` で `/api/*` を Rails に流せば同一オリジンになり、`NEXT_PUBLIC_API_BASE_URL` も
CORS も触らずに済む。採らないのは、**ローカルの通信経路が本番（Vercel ↔ Render の別オリジン）と
変わってしまう**ため。CLAUDE.md は CORS と JWT のつなぎ目をローカルで検証する前提で書かれており、
`health-panel` の疎通確認もその確認のために置かれている。実機確認のためだけに、
普段の開発が通る経路を本番と別物にするのは割に合わない。

### 8. LAN IP の自動解決スクリプトは作らない

`ipconfig getifaddr en0` をホスト側で叩いて 3 か所に配る仕組みは作れるが、
決定 5 で書き換え自体が原則ゼロになるため、スクリプト・生成 env・compose の
`env_file` 追加・`.gitignore` を増やす価値が無い。実機確認の頻度が上がって
`.local` も使えないと分かった時点で、別 issue として検討する。

## 実装の構え

### 追加するファイル

| ファイル | 役割 |
|---|---|
| `frontend/src/lib/dev/allowed-dev-hosts.ts` | env 文字列 → ホスト名配列の純粋関数 |
| `frontend/test/lib/dev/allowed-dev-hosts.test.ts` | 上の vitest |

`src/lib/dev/` に置くのは、`src/components/dev/health-panel.tsx` と同じ「開発時にだけ
意味がある部品」の並びに揃えるため。`test/` が `src/` を写す規約もそのまま満たせる。

### `allowed-dev-hosts.ts`

```ts
export function parseAllowedDevHosts(raw: string | undefined): string[]
```

- `undefined` / 空文字 / 空白のみ → `[]`
- カンマで分割 → trim → 空要素を捨てる
- 各要素：`://` を含まなければ `http://` を前置し、`new URL(...).hostname` を返す
- `new URL()` が投げたら、元の値を含むメッセージにして再送出する

### `next.config.ts`

```ts
import type { NextConfig } from "next";
import { parseAllowedDevHosts } from "./src/lib/dev/allowed-dev-hosts";

const allowedDevHosts = parseAllowedDevHosts(process.env.DEV_ALLOWED_HOSTS);

const nextConfig: NextConfig = {
  ...(allowedDevHosts.length > 0 ? { allowedDevOrigins: allowedDevHosts } : {}),
};

export default nextConfig;
```

### 手順書（`frontend/AGENTS.md` に足す節）

1. Mac 側で `scutil --get LocalHostName`（`.local` を使う場合）または
   `ipconfig getifaddr en0`（IP を使う場合）。**コンテナ内では取れない**（docker の
   ブリッジ IP しか返らない）ことも書く
2. 3 か所に同じホストを書く
   - `frontend/.env.development` … `DEV_ALLOWED_HOSTS`
   - `frontend/.env.development` … `NEXT_PUBLIC_API_BASE_URL`（`:3000`）
   - `.env.development` … `CORS_ALLOWED_ORIGINS` に追記（`:3001`）
   - `.env.development` … `.local` を使うなら `RAILS_DEVELOPMENT_HOSTS`
3. `docker compose up -d frontend backend`（**`restart` では env_file の変更が反映されない**）
4. 症状からの切り分け表
   - スマホで画面は出るがボタンが無反応 → dev ログの
     `⚠ Blocked cross-origin request to Next.js dev resource /_next/... from "<host>"`
     を見る。出ていれば `DEV_ALLOWED_HOSTS` の値がその host と一致していない
   - API だけ 403（HTML はエラーページ）→ Rails のホスト認証。`RAILS_DEVELOPMENT_HOSTS`
   - API が CORS エラー → `CORS_ALLOWED_ORIGINS` に `:3001` のオリジンが無い
   - 「サーバーが見つかりません」→ mDNS が解決できていない。IP に切り替える
5. **`curl` では再現しない**。ブロックの判定は `Origin` / `Referer` で行われ、curl は既定で
   どちらも送らないため 200 が返る。再現させるなら
   `curl -H "Origin: http://<host>:3001" -H "Referer: http://<host>:3001/"`

## テスト

### Vitest（`test/lib/dev/allowed-dev-hosts.test.ts`）

- `undefined` / `""` / `"  "` → `[]`
- `192.168.x.x` → そのまま
- `http://192.168.x.x:3001` → ホスト名だけになる
- `192.168.x.x:3001` → ホスト名だけになる
- `192.168.*.*` → ワイルドカードが壊れない
- `<mac>.local` → 小文字化される
- `a, b` → 2 要素。空要素（`a,,b`）は捨てる
- `not a host` → 例外を投げ、メッセージに元の値を含む

### ブラウザでの確認

1. **env を設定しないまま** `docker compose up -d` → Mac の `localhost:3001` が従来どおり動く（回帰）
2. 設定後、スマホから `http://<host>:3001/` を**直接ロード**してログイン →
   一覧（API 込み）→ トースト → **リロード**
3. その間 dev サーバーのログに `Blocked cross-origin request` が出ない
4. env を元に戻すと `localhost` 運用に戻る
5. `npm run test` / `npm run lint`

## 変更するファイル

| ファイル | 変更 |
|---|---|
| `frontend/src/lib/dev/allowed-dev-hosts.ts` | 新規 |
| `frontend/test/lib/dev/allowed-dev-hosts.test.ts` | 新規 |
| `frontend/next.config.ts` | `allowedDevOrigins` を env から組み立てる |
| `frontend/.env.example` | `DEV_ALLOWED_HOSTS` と、実機確認時の `NEXT_PUBLIC_API_BASE_URL` の書き換え方 |
| `.env.example` | `CORS_ALLOWED_ORIGINS` への追記例と `RAILS_DEVELOPMENT_HOSTS` |
| `frontend/AGENTS.md` | 実機確認の手順と切り分け |
| `docs/issues_backlog.md` | 0-6 のタスクのチェックを埋める |

`backend/` と `frontend/package.json` は変更しない。

## 完了条件

- 同じ Wi-Fi のスマホから開発サーバーを開き、**ログイン・API を叩く画面・トーストが動く**
- env を設定しなければ従来どおり動く（他の開発者・CI・本番に影響しない）
- 書式を間違えた env は起動時に落ちる（無言で効かない状態にならない）
- `npm run test` と `npm run lint` が通る
- 実 IP・実ホスト名がコミットされる文書に含まれていない

## この issue で作らないもの

- LAN IP の自動解決スクリプト（決定 8）
- dev の API プロキシ（決定 7）
- HTTPS 化（カメラなど secure context を要する API を使う予定が無いため）
- Playwright での実機・モバイル幅の自動テスト（issue 8-1 の範囲）
- 本番環境への影響を伴う変更。`allowedDevOrigins` は dev サーバー専用で、
  `RAILS_DEVELOPMENT_HOSTS` は development のみで読まれる
