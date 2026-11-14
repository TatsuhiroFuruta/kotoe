# issue 8-1 Playwright E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 認証フロー（E2E①）とコアループ（E2E②）の Playwright E2E を、ローカル（コマンド 1 本）と PR ごとの CI で green にする。

**Architecture:** リポジトリ直下の `e2e/`（専用 `package.json`）に Playwright を置く。テスト対象のサーバーは、ローカルでは
docker compose の `e2e` プロファイル（Rails :3100・Next.js 本番ビルド :3101、DB は `kotoe_e2e`）、CI では Ruby・Node を
直接用意して起動する。Playwright はサーバーを起動しない（起動はローカルのスクリプトと CI の手順が担う）。前提データは
Playwright の `request` で Rails の公開 API を呼んで作る。Cloudinary の保存先は環境変数で `kotoe/e2e/<実行 ID>` に
切り替え、終了時に Rails の rake タスクでその接頭辞だけを消す。

**Tech Stack:** Playwright（`@playwright/test`、Chromium）、TypeScript、Rails 8.1（RSpec）、docker compose、GitHub Actions

**Spec:** `docs/superpowers/specs/2026-11-08-issue-8-1-playwright-e2e-design.md`

## Global Constraints

- 本番（Render・Vercel・Neon・Cloudinary の `kotoe/production/`）に 1 件も書き込まない。開発 DB（`kotoe_development`）と `kotoe/development/` も汚さない
- 秘密（`CLOUDINARY_URL`・`JWT_SECRET_KEY`）を repo・ログ・テストの成果物に出さない。`.env.development` の中身を表示しない（キー名だけ扱う）
- 固定の sleep（`waitForTimeout`）で待たない。画面の状態・URL・応答を待つ
- アプリ本体に E2E 専用の近道（認証の抜け道、テスト用 API）を足さない。足したくなったら止まって相談する
- 生成は Solid Queue のジョブとして非同期に実行し、フロントのポーリングで公開を検知する経路をそのまま通す
- `KOTOE_CLOUDINARY_FOLDER` 未設定なら、保存先は今までどおり `kotoe/#{Rails.env}/posts|generated`
- 後片付けで消してよいのは `kotoe/e2e/` で始まる接頭辞だけ
- Chromium のデスクトップ幅 1 本。本番・プレビューには流さない
- Ruby は文字列ダブルクォート（rubocop-rails-omakase）。コミット前に `bundle exec rubocop` と `bundle exec rspec` を通す
- コミットの末尾は `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` の 1 行で止める（`Claude-Session:` を書かない）。`-c user.email` を使わない
- 依存の追加は `e2e/` の `@playwright/test`・`typescript`・`@types/node` だけ（設計で承認済み）。それ以外を足すなら止まって相談する

## Review Focus

1. **開発環境を動かしたまま E2E を回す** → 開発の `backend`（:3000）・`frontend`（:3001）がそのまま動き続ける。`backend/tmp/pids/server.pid` を消さない・奪わない（Task 3 の Step で確認）
2. **E2E が途中で失敗した** → 後片付け（Cloudinary・コンテナ停止）は走り、スクリプトの終了コードは失敗のまま（Task 3 のスクリプトに `trap`、Step で `exit 1` のテストを流して確認）
3. **生成ジョブが遅い・CI のマシンが遅い** → ポーリングの完了待ちは期待値の timeout（60 秒）で待ち、固定 sleep しない（Task 5）
4. **本番で `KOTOE_CLOUDINARY_FOLDER` が誤って設定された** → 本番では無視して `kotoe/production/...` に保存する（Task 1 の spec）
5. **後片付けに `kotoe/e2e/` 以外の接頭辞が渡った**（空文字・`kotoe/production` など） → 何も消さずに失敗する（Task 2 の spec）

---

## File Structure

| ファイル | 役割 |
|---|---|
| `backend/lib/images/uploader.rb`（変更） | 保存先の接頭辞を `KOTOE_CLOUDINARY_FOLDER` で上書き可能にする |
| `backend/lib/e2e/cloudinary_cleanup.rb`（新規） | 接頭辞を検査して Cloudinary から消す PORO |
| `backend/lib/tasks/e2e.rake`（新規） | `bin/rails e2e:cleanup_cloudinary` |
| `backend/spec/lib/images/uploader_spec.rb`（新規または追記） / `backend/spec/lib/e2e/cloudinary_cleanup_spec.rb`（新規） | 上の 2 つの spec |
| `docker-compose.yml`（変更） | `profiles: [e2e]` の `backend-e2e`・`frontend-e2e` |
| `e2e/package.json` / `package-lock.json` / `tsconfig.json` / `playwright.config.ts` / `.gitignore` | Playwright 本体と設定 |
| `e2e/scripts/run-local.sh` | ローカルのコマンド 1 本（DB 作り直し → 起動 → テスト → 後片付け） |
| `e2e/support/env.ts` | `API_BASE_URL`・`APP_BASE_URL` の取り出し |
| `e2e/support/factories.ts` | `createUser` / `createPost` |
| `e2e/support/auth.ts` | 画面からのログイン、トークンの読み書き |
| `e2e/support/fixtures/post-image.png` | お題用の小さな画像 |
| `e2e/tests/smoke.spec.ts` / `auth.spec.ts` / `core-loop.spec.ts` | テスト本体 |
| `.github/workflows/ci.yml`（変更） | `e2e` ジョブ |
| `.github/dependabot.yml`（変更） | `/e2e` の npm |
| `CLAUDE.md` / `README.md` / `docs/issues_backlog.md`（変更） | 構成・手順・チェックボックス |

---

### Task 1: Cloudinary の保存先を環境変数で切り替える

**Files:**
- Modify: `backend/lib/images/uploader.rb`（`folder` メソッド）
- Test: `backend/spec/lib/images/uploader_spec.rb`（既存が無ければ新規。`spec/support/cloudinary.rb` のスタブ方針に従う）

**Interfaces:**
- Produces: 環境変数 `KOTOE_CLOUDINARY_FOLDER`（例 `kotoe/e2e/local-1731050000`）。設定時の保存先は `"#{KOTOE_CLOUDINARY_FOLDER}/posts"` / `"…/generated"`

- [ ] **Step 1: 失敗する spec を書く**（`ClimateControl` は無いので `ENV` の stub か `around` で退避・復元）

```ruby
it "未設定なら kotoe/<Rails.env>/posts に上げる" do
  # Cloudinary::Uploader.upload が folder: "kotoe/test/posts" で呼ばれること
end
it "KOTOE_CLOUDINARY_FOLDER があればその下に上げる" do
  # ENV["KOTOE_CLOUDINARY_FOLDER"] = "kotoe/e2e/run-1" → folder: "kotoe/e2e/run-1/generated"（kind: :generated）
end
it "本番では KOTOE_CLOUDINARY_FOLDER を無視する" do
  # allow(Rails.env).to receive(:production?).and_return(true) と ENV 設定 → folder が "kotoe/#{Rails.env}/posts"
end
it "空白だけの値は未設定として扱う" do
  # ENV = "  " → "kotoe/test/posts"
end
```

- [ ] **Step 2: 実行して失敗を確認**
  Run: `docker compose exec backend bundle exec rspec spec/lib/images/uploader_spec.rb` → 上記の新しい例が FAIL

- [ ] **Step 3: `Images::Uploader#folder` を直す**。接頭辞は `ENV["KOTOE_CLOUDINARY_FOLDER"].presence`（`strip` 後）を、`Rails.env.production?` でないときだけ使う。それ以外は `"kotoe/#{Rails.env}"`。クラス冒頭のコメント（保存先フォルダ）に E2E 用であることと本番で無視する理由を 2 行足す

- [ ] **Step 4: spec が通ることを確認**（同じコマンド → PASS）、`bundle exec rubocop` も通す

- [ ] **Step 5: コミット** `feat: E2E 用に Cloudinary の保存先を KOTOE_CLOUDINARY_FOLDER で切り替えられるようにする`

---

### Task 2: E2E の画像を消す rake タスク

**Files:**
- Create: `backend/lib/e2e/cloudinary_cleanup.rb`、`backend/lib/tasks/e2e.rake`
- Test: `backend/spec/lib/e2e/cloudinary_cleanup_spec.rb`

**Interfaces:**
- Consumes: Task 1 の `KOTOE_CLOUDINARY_FOLDER`
- Produces: `E2e::CloudinaryCleanup.call(prefix) -> Integer`（消した件数）。`bin/rails e2e:cleanup_cloudinary`（`ENV["KOTOE_CLOUDINARY_FOLDER"]` を渡す。未設定なら何もせず終了 0）

- [ ] **Step 1: 失敗する spec を書く**（`Cloudinary::Api.delete_resources_by_prefix` を stub。実 API は `spec/support/cloudinary.rb` が塞いでいる）

```ruby
it "kotoe/e2e/ で始まる接頭辞の画像を消す" do
  # call("kotoe/e2e/run-1") → delete_resources_by_prefix("kotoe/e2e/run-1/", resource_type: "image") が呼ばれる
  # （末尾に / を付け、kotoe/e2e/run-10 を巻き込まない）
end
it "kotoe/e2e/ 以外の接頭辞では何も消さずに ArgumentError" do
  # "kotoe/production", "kotoe/e2e", "kotoe/e2e/", "", "kotoe/e2e/../production" のそれぞれで
  # expect { call(x) }.to raise_error(ArgumentError) かつ delete が呼ばれない
end
it "応答が partial（次ページあり）なら繰り返す" do
  # 1 回目 { "deleted" => {...}, "partial" => true }、2 回目 partial なし → 2 回呼ぶ。合計件数を返す
end
```

- [ ] **Step 2: 実行して FAIL を確認**（`docker compose exec backend bundle exec rspec spec/lib/e2e/cloudinary_cleanup_spec.rb`）
- [ ] **Step 3: 実装する**。許可は正規表現 `\Akotoe/e2e/[A-Za-z0-9_-]+\z` に一致する接頭辞だけ（`..` や空のセグメントを通さない）。`lib/` の autoload 設定を確認し、読まれないなら restart の要否もメモ（メモ：app/ に新ディレクトリを作ったら restart）。rake タスクは件数だけを `puts` する（接頭辞以外の Cloudinary の応答本文をログに出さない）
- [ ] **Step 4: PASS を確認**、rubocop
- [ ] **Step 5: コミット** `feat: E2E の Cloudinary 画像を接頭辞で消す rake タスクを足す`

---

### Task 3: ローカルの E2E 環境と Playwright の骨組み（スモーク 1 本）

**Files:**
- Modify: `docker-compose.yml`
- Create: `e2e/package.json`、`e2e/package-lock.json`、`e2e/tsconfig.json`、`e2e/playwright.config.ts`、`e2e/.gitignore`、`e2e/scripts/run-local.sh`、`e2e/support/env.ts`、`e2e/tests/smoke.spec.ts`

**Interfaces:**
- Consumes: Task 1・2
- Produces:
  - `e2e/support/env.ts`：`export const API_BASE_URL: string`（既定 `http://localhost:3100`、`E2E_API_BASE_URL` で上書き）、`export const APP_BASE_URL: string`（既定 `http://localhost:3101`、`E2E_APP_BASE_URL`）
  - `playwright.config.ts`：`baseURL = APP_BASE_URL`、`projects: [chromium（Desktop Chrome）]`、`retries: process.env.CI ? 1 : 0`、`workers: 1`、`trace: "retain-on-failure"`、`screenshot: "only-on-failure"`、`webServer` は設定しない
  - `e2e/package.json` の scripts：`"test": "playwright test"`、`"typecheck": "tsc --noEmit"`、`"local": "scripts/run-local.sh"`
  - compose のサービス名 `backend-e2e`（ホスト :3100）・`frontend-e2e`（ホスト :3101）

- [ ] **Step 1: Playwright の現行版と Next.js 16 での注意を確認する**（設計書「着手時に確かめること」）。`npm view @playwright/test version` で版を確かめ、`e2e/` で `npm init -y` → `npm i -D @playwright/test typescript @types/node`（版の書き方は frontend の package.json に合わせて `^` 付きでよい）。ブラウザはホストに `npx playwright install chromium`

- [ ] **Step 2: `docker-compose.yml` に 2 サービスを足す**（どちらも `profiles: ["e2e"]`。`docker compose up` の既定では起動しない）
  - `backend-e2e`：`backend` と同じ `build`・`env_file`・`volumes`（`./backend:/app`・`bundle`）・`depends_on: db`。`environment`：`RAILS_ENV: development`、`TZ: Asia/Tokyo`、`CORS_ALLOWED_ORIGINS: http://localhost:3101`、`SOLID_QUEUE_IN_PUMA: "true"`、`RAILS_LOG_TO_STDOUT: "true"`、`KOTOE_CLOUDINARY_FOLDER: ${KOTOE_CLOUDINARY_FOLDER:?run-local.sh から起動する}`。`ports: "3100:3000"`。
    **`entrypoint` を上書きする**（`entrypoint.dev.sh` は共有の `tmp/pids/server.pid` を消すため）。`command` は `sh -c` で、継承した `DATABASE_URL` の DB 名を `kotoe_e2e` に置き換えてから（`config/database.yml` の test と同じ置換：最後のパス区切り以降を差し替え、クエリは残す）、`bin/rails server -b 0.0.0.0 -p 3000 -P /tmp/server.pid` を `exec` する
  - `frontend-e2e`：`build: { context: ./frontend, dockerfile: Dockerfile.dev }`（ソースを COPY するので、ホストの `.next` と開発サーバーに触れない）。**volumes は付けない**。`env_file: frontend/.env.development`、`environment: { NEXT_PUBLIC_API_BASE_URL: http://localhost:3100, TZ: Asia/Tokyo }`、`ports: "3101:3000"`、`command: sh -c "npx next build && npx next start -p 3000"`

- [ ] **Step 3: `e2e/scripts/run-local.sh` を書く**（`set -euo pipefail`、リポジトリ直下で compose を呼ぶ）
  1. `export KOTOE_CLOUDINARY_FOLDER="kotoe/e2e/local-$(date +%s)"`
  2. `trap` で後片付けを登録：`docker compose --profile e2e exec -T backend-e2e bin/rails e2e:cleanup_cloudinary`（失敗しても続行）→ `docker compose --profile e2e stop backend-e2e frontend-e2e` → `rm -f`。**テストの終了コードを保持して最後に `exit` する**
  3. `docker compose --profile e2e build frontend-e2e`
  4. DB の作り直し：`docker compose --profile e2e run --rm --no-deps backend-e2e sh -c '<Step 2 と同じ DATABASE_URL 置換> && bin/rails db:drop db:prepare'`（`db:prepare` は `db/seeds.rb` を流すが中身は空。流れても無害なことを確認）
  5. `docker compose --profile e2e up -d backend-e2e frontend-e2e`
  6. 起動待ち：`curl --retry 60 --retry-delay 2 --retry-all-errors -fsS http://localhost:3100/api/health` と `http://localhost:3101/`
  7. `(cd e2e && npx playwright test "$@")`

- [ ] **Step 4: スモークのテストを書く**（`e2e/tests/smoke.spec.ts`）

```ts
test("API の health が 200", async ({ request }) => {
  // request.get(`${API_BASE_URL}/api/health`) → ok()
});
test("トップが開き、お題を探すへ進める", async ({ page }) => {
  // page.goto("/") → getByRole("link", { name: "お題を探す" }) をクリック → URL が /posts
});
```

- [ ] **Step 5: 開発環境を起動したまま回して green を確認**
  Run: `docker compose up -d && e2e/scripts/run-local.sh` → `2 passed`、終了コード 0
  続けて確認：`curl -fsS http://localhost:3000/api/health` と `http://localhost:3001/` が 200（開発環境が無事）。`backend/tmp/pids/server.pid` が残っている。`docker compose exec db psql -U <POSTGRES_USER> -lqt` で `kotoe_e2e` があり `kotoe_development` の件数が変わっていない（ユーザー名は `.env.development` を表示せず `docker compose exec db printenv POSTGRES_USER` で取る）

- [ ] **Step 6: 失敗時の振る舞いを確認**：スモークに一時的に `expect(1).toBe(2)` を足して回す → 終了コード 1、後片付けのログが出てコンテナが止まる。確認後に戻す

- [ ] **Step 7: コミット** `test: E2E のローカル環境と Playwright の骨組みを足す`

---

### Task 4: 前提データの補助関数と E2E①（認証フロー）

**Files:**
- Create: `e2e/support/factories.ts`、`e2e/support/auth.ts`、`e2e/support/fixtures/post-image.png`、`e2e/tests/auth.spec.ts`

**Interfaces:**
- Consumes: `API_BASE_URL`（Task 3）
- Produces:
  - `type TestUser = { name: string; email: string; password: string; token: string }`
  - `createUser(request: APIRequestContext): Promise<TestUser>` … `POST /api/auth/sign_up`（本文の形は `registrations_controller.rb` に合わせる）。メールは `e2e-${Date.now()}-${乱数}@example.com`、パスワードは 6 文字以上。`token` は応答の `Authorization` ヘッダー（`Bearer ` を除いた値）
  - `createPost(request: APIRequestContext, user: TestUser, title?: string): Promise<{ id: number }>` … `POST /api/posts` に multipart（`post[image]` に fixture、`post[title]`）。201 以外は応答の status だけを含めて throw
  - `loginViaUi(page: Page, user: TestUser): Promise<void>` … `/login` でメールアドレス・パスワードを入れて送信し、ヘッダーの「アカウント」が出るまで待つ
  - `readToken(page: Page): Promise<string | null>` / `writeToken(page: Page, token: string): Promise<void>` … `localStorage` の `kotoe.auth.token`（`token-store.ts` の `STORAGE_KEY`。値の形も同ファイルに合わせる）

テスト用画像は 3:4 など正方形でない小さな PNG（数 KB、メモ：画像は縦横比を変えて確認）。

- [ ] **Step 1: シナリオ 1〜6 のテストを書く**（設計書「E2E①」。セレクタは `getByRole` / `getByLabel` と画面の文言：`login-form.tsx`・`signup/page.tsx`・`site-header.tsx`）

```ts
test("登録 → ログイン → ログアウト", ...)
  // /signup で 名前・メールアドレス・パスワード（6文字以上）を入れて登録 → ログイン状態
  // ログアウト → 未ログインの表示、readToken === null。/login から同じ資格情報でログインできる
test("未ログインでガード付きページを開くと /login?next= へ送られ、ログイン後に戻る", ...)
  // page.goto("/mypage") → URL が /login?next=%2Fmypage → ログイン → URL が /mypage
test("ログイン済みでガード付きページを直接ロード・リロードしても /login へ飛ばされない", ...)
  // loginViaUi → page.goto("/mypage")（Link を使わない）→ URL が /mypage のまま、マイページの見出しが出る
  // page.reload() → 同じ。/posts/new でも同じ確認
test("ログアウトしたトークンを戻すと 401 になり、フロントが破棄する", ...)
  // loginViaUi → const old = await readToken(page) → ログアウト
  // request.get(`${API_BASE_URL}/api/me`, Authorization: Bearer old) → 401
  // writeToken(page, old) → page.goto("/mypage") → /login へ送られ、readToken === null
test("バックエンドに届かない状態からの復帰", ...)
  // (a) loginViaUi → page.route(`${API_BASE_URL}/**`, r => r.abort()) → page.goto("/mypage") → URL は /login でない、ヘッダーに「再試行」
  // (b) page.unroute → ヘッダーの「再試行」→ ログイン状態（アカウントが出る）。ページ側の「再試行」でも同じ（別テストに分けてよい）
  // (c) abort のまま、ヘッダーの「ログアウト」→ 未ログインの表示、readToken === null
for (const next of ["//evil.example", "%2F%09%2Fevil.example"]) {
  test(`?next=${next} でログインしても外へ出ない`, ...)
  // page.goto(`/login?next=${next}`) → ログイン → new URL(page.url()).origin === APP_BASE_URL かつ pathname === "/"
}
```

- [ ] **Step 2: `e2e/scripts/run-local.sh` で回し、補助関数が未実装のため FAIL を確認**
- [ ] **Step 3: `factories.ts` と `auth.ts` を実装し、fixture の画像を置く**
- [ ] **Step 4: 回して全件 PASS を確認**（`run-local.sh tests/auth.spec.ts`）
- [ ] **Step 5: 決定 11 の実測**：`(a)` を、`page.route` の代わりに `docker compose stop backend-e2e` で作って同じ手順を手で確かめる（ヘッダーの表示・URL・トースト）。違いがあれば止めて相談する。結果（同じだった／違った点）を PR 本文に書くためにメモする。確認後 `docker compose --profile e2e start backend-e2e`
- [ ] **Step 6: コミット** `test: E2E①（認証フロー）を足す`

---

### Task 5: E2E②（コアループ）

**Files:**
- Create: `e2e/tests/core-loop.spec.ts`

**Interfaces:**
- Consumes: `createUser` / `createPost` / `loginViaUi`（Task 4）

- [ ] **Step 1: テストを書く**（文言は `attempt-composer.tsx`・`generation-panel.tsx`・`attempt-comparison.tsx`・`like-button.tsx`）

```ts
test("お題を見て描写し、生成して公開され、別のユーザーがいいねする", async ({ page, request, browser }) => {
  // 出題者 = createUser、お題 = createPost(出題者, `E2E ${Date.now()}`)、挑戦者 = createUser
  // 挑戦者で loginViaUi → /posts でお題タイトルのカードをクリック → URL /posts/<id>
  // 描写欄に文章を入れて「保存」→ 保存のトースト
  // 「画像を生成」→ 生成中の表示 → 公開の表示（expect(...).toBeVisible({ timeout: 60_000 })）
  // 比較ビュー（/attempts/<id>）へ進む → img「お題」の画像と `<挑戦者名> さんの再現画像` が見え、src が https://res.cloudinary.com/ で始まる
  // 新しい context（browser.newContext()）で出題者として loginViaUi → 同じ /attempts/<id> → 「いいね」押下
  // → aria-pressed="true"、いいね数が 1
});
```

- [ ] **Step 2: 回して PASS を確認**（`run-local.sh tests/core-loop.spec.ts`）。落ちたらアプリではなくテストのどこかを先に疑い、アプリの不具合に見えたら止めて報告する
- [ ] **Step 3: Cloudinary の確認**：テスト中にアップロードされた public_id が `kotoe/e2e/local-…/posts/` と `…/generated/` にあること（`backend-e2e` のログか DB の `posts.image_public_id` で確認）。終了後、後片付けのログの件数が 2 以上であること
- [ ] **Step 4: 全体を回す**：`e2e/scripts/run-local.sh` → 全件 PASS
- [ ] **Step 5: コミット** `test: E2E②（コアループ）を足す`

---

### Task 6: CI の e2e ジョブ

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `e2e/package.json` の scripts、`bin/rails e2e:cleanup_cloudinary`

- [ ] **Step 1: ジョブ `e2e`（名前 `e2e (playwright)`）を足す**。既存 3 ジョブと並列、トリガーは同じ
  - `if:` で fork からの PR を飛ばす（`github.event.pull_request.head.repo.full_name == github.repository || github.event_name == 'push'`）
  - `services.postgres`：既存の backend ジョブと同じ（`POSTGRES_DB: kotoe_e2e`）
  - `env`（ジョブ全体）：`RAILS_ENV: development`、`DATABASE_URL: postgresql://postgres:password@localhost:5432/kotoe_e2e`、`CORS_ALLOWED_ORIGINS: http://localhost:3101`、`JWT_SECRET_KEY: dummy-…-do-not-use-in-production`、`CLOUDINARY_URL: ${{ secrets.CLOUDINARY_URL }}`、`KOTOE_CLOUDINARY_FOLDER: kotoe/e2e/ci-${{ github.run_id }}-${{ github.run_attempt }}`、`SOLID_QUEUE_IN_PUMA: "true"`
  - 手順：checkout → `ruby/setup-ruby`（`bundler-cache`、`working-directory: backend`）→ `bin/rails db:prepare` → Rails を `bin/rails server -p 3100 &` で起動 → `actions/setup-node`（`node-version: "24"`、`cache: npm`、`cache-dependency-path` に `frontend/package-lock.json` と `e2e/package-lock.json`）→ frontend で `npm ci` → `NEXT_PUBLIC_API_BASE_URL=http://localhost:3100` と `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=${{ vars.CLOUDINARY_CLOUD_NAME }}` で `npx next build` → `npx next start -p 3101 &` → e2e で `npm ci` → `npx playwright install --with-deps chromium` → `npm run typecheck` → 起動待ち（Task 3 と同じ curl）→ `npm test`
  - `if: always()` の手順：`bin/rails e2e:cleanup_cloudinary`、失敗時だけ `actions/upload-artifact` で `e2e/test-results/` と `e2e/playwright-report/`（保持 7 日）
- [ ] **Step 2: ユーザーに GitHub の設定を依頼する**（私は Secrets を作らない）：Secrets に `CLOUDINARY_URL`、Variables に `CLOUDINARY_CLOUD_NAME`。値は今の `backend/.env.development`・`frontend/.env.development` と同じでよい
- [ ] **Step 3: プッシュして CI の `e2e (playwright)` が green になることを確認**。所要時間を記録（PR 本文に書く）。失敗時の成果物を 1 度わざと作り（Task 3 Step 6 と同じ一時変更を push しない別コミットで試すか、ローカルの `test-results/` を見る）、trace に Cloudinary の API キー・シークレットが含まれないことを確かめる（trace を解凍し、キーの文字列で `grep -c` して件数 0 だけを見る。値そのものは表示しない）
- [ ] **Step 4: コミット** `ci: E2E（Playwright）のジョブを足す`

---

### Task 7: ミューテーションで守れていることを確かめ、文書を更新する

**Files:**
- Modify: `CLAUDE.md`、`README.md`、`.github/dependabot.yml`、`docs/issues_backlog.md`

- [ ] **Step 1: 7-1 のバグを一時的に戻す**：`frontend/src/lib/auth/require-auth.tsx` で、認証状態が確定する前（`loading` 相当）でも未ログインとみなして `/login` へ送る形に変える → `run-local.sh tests/auth.spec.ts` で「直接ロード・リロード」のテストが FAIL することを確認 → 元に戻す（コミットしない）
- [ ] **Step 2: もう 1 つ**：`safe-next-path.ts` が `//` で始まる値を通すように一時変更 → `?next=` のテストが FAIL → 元に戻す。結果を PR 本文用にメモ
- [ ] **Step 3: 文書を更新する**
  - `CLAUDE.md`「リポジトリ構成」に `e2e/ ← Playwright E2E（専用 package.json）`、「テスト戦略」の Playwright の項に置き場・`e2e/scripts/run-local.sh`・CI で PR ごとに回ること、「よく使うコマンド」に `e2e/scripts/run-local.sh`
  - `README.md` のローカル開発の節に E2E の回し方（初回の `cd e2e && npm ci && npx playwright install chromium`、`e2e/scripts/run-local.sh`、開発環境と並べて動くこと、ポート 3100/3101）
  - `.github/dependabot.yml` に `/e2e` の npm（`/frontend` の項と同じ形）
  - `docs/issues_backlog.md` 8-1 のチェックボックスを `[x]` にし、設計書へのリンクを足す
- [ ] **Step 4: 全体の確認**：`docker compose exec backend bundle exec rubocop`・`bundle exec rspec`、`cd e2e && npm run typecheck`、`e2e/scripts/run-local.sh` がすべて green。本番の Cloudinary に `kotoe/e2e` 以外の新しい画像が増えていないことは Cloudinary の管理画面でユーザーに確認してもらう
- [ ] **Step 5: コミット** `docs: E2E の置き場と回し方を CLAUDE.md・README に書く`

---

## 完了後（このブランチの外の手順）

- `/code-review high` を通してからプッシュ・PR（メモ：プッシュ前に /code-review）。PR 本文は `Closes #29`。所要時間・決定 11 の実測結果・ミューテーションの結果を書く
- マージ後、背骨の次は 8-2b
