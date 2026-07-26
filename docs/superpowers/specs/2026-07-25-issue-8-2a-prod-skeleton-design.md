# issue 8-2a 設計：本番環境スケルトン＋疎通スモーク（早期）

- Issue: `docs/issues_backlog.md` の 8-2a
- Branch: `feature/issue-8-2a`
- 前提: 2-2（認証・CORS）まで完了。backbone は `… → 2-2 → 8-2a → 3-1 → …`

## 目的

本番のつなぎ目（Vercel↔Render の CORS/JWT・Neon プール接続・env vars）を、**差分が小さいうちに一度固める**。後段の一括デプロイで原因が特定しづらくなるのを防ぐ。機能追加ではなく「配線を固める」ことが主眼。

この issue は同時に、PR #53（2-2）でやり残した `docs/issues_backlog.md` の 2-2 チェックボックス更新（申し送り事項）も片付ける。

## 方針の確定事項（ユーザー合意済み）

1. **Render デプロイ方式**: ネイティブ Ruby ランタイム + `render.yaml`（Docker 化しない）。
   - 理由: 8-2a の目的は「配線を差分が小さいうちに固める」こと。moving parts を最小化する方が目的に直結する。Docker の parity メリット（本番でしか出ないバグ潰し）は、この回で潰したい CORS/JWT/Neon 配線とは軸が異なる。Docker 化は必要になった段階で後から移行できる。
2. **CORS/JWT のブラウザ実機確認**: フロントに最小スモークUI（`/smoke`）を追加する。
   - 理由: 8-2a の完了条件「CORS/JWT が確認できる」は、curl では満たせない（curl は CORS を強制しない）。この時点でフロントにログインUI（7-1/7-2）が無いため、確認専用の一時UIを置く。
3. **アカウント**: Render / Vercel / Neon は作成済み前提。ダッシュボード操作はユーザーが実施し、`docs/deployment.md` は「プロジェクト/DB 作成 → 接続文字列取得 → 環境変数設定 → デプロイ」の要点ガイドにする（アカウント作成手順は書かない）。

## 既存コードの調査結果（設計の根拠）

- `backend/config/environments/production.rb`:
  - `force_ssl = true` + `assume_ssl = true` → Render の TLS 終端（`X-Forwarded-Proto`）と整合。ヘルスチェックがリダイレクトされる問題は起きない。**変更不要**。
  - `config.hosts` 未設定 → `ActionDispatch::HostAuthorization` で弾かれない。Render の内部ヘルスチェックも通る。**変更不要**。
  - `config.silence_healthcheck_path = "/up"` 済み。ログを汚さない。
  - `config.logger` は STDOUT（Render がログ収集）。**変更不要**。
- `backend/config/initializers/devise.rb`: `jwt.secret = ENV["JWT_SECRET_KEY"]` → 本番で `JWT_SECRET_KEY` が必須。
- `backend/config/initializers/cors.rb`: 許可判定は `CORS_ALLOWED_ORIGINS` / `CORS_ALLOWED_ORIGIN_REGEX`。**production で両方未設定なら boot 時に raise**（気づけるようにしてある）。`expose: ["Authorization"]` 済み。
- `backend/config/database.yml`: `ENV["DATABASE_URL"]` を読む。production ブロック準備済み。**変更不要**。
- `backend/config/puma.rb`: `port ENV.fetch("PORT", 3000)` → Render が供給する `PORT` にバインド。
- credentials: `config/credentials.yml.enc` + `config/master.key`（gitignore 済み）→ 本番は `RAILS_MASTER_KEY` env が必要。
- 認証エンドポイント（devise_for :users、resource_name = `:user`）:
  - `POST /api/auth/sign_up` … body `{ user: { email, password } }`、成功時 201 ＋ JWT を `Authorization` ヘッダに載せる。
  - `POST /api/auth/sign_in` … body `{ user: { email, password } }`、成功時 200 ＋ JWT を `Authorization` ヘッダ。
  - `GET /api/me` … `Authorization: Bearer <jwt>` で本人情報。

**結論: backend のコード変更は不要。Render の設定ファイルと env のみ。**

## 成果物の切り分け

### コミットする成果物（PR に入る）

| ファイル | 種別 | 内容 |
|---|---|---|
| `render.yaml`（リポジトリ直下） | 新規 | Render Blueprint。ネイティブ Ruby、`rootDir: backend` |
| `backend/bin/render-build.sh` | 新規 | ビルドスクリプト（`bundle install` + `db:migrate`）。実行権限付与 |
| `frontend/src/app/smoke/page.tsx` | 新規 | 一時的なスモークUI。7-1 でログインUIが載ったら削除 |
| `docs/deployment.md` | 新規 | ダッシュボード手順・環境変数表・デプロイ順序の運用ドキュメント |
| `docs/issues_backlog.md` | 更新 | 2-2 のチェックボックス更新（part B）＋ 8-2a の完了チェック |

### ダッシュボード作業（コミットされない・`docs/deployment.md` にガイド）

Neon で DB 作成、Render で Web Service 作成＋環境変数投入、Vercel でプロジェクト作成＋env、ブラウザでスモーク実行。私（Claude）はブラウザのダッシュボード操作を代行できないため、ユーザーが手を動かす。

## Backend: Render（ネイティブ Ruby）

### `render.yaml`（リポジトリ直下）

```yaml
services:
  - type: web
    name: kotoe-api
    runtime: ruby
    rootDir: backend
    region: singapore          # 日本に最も近い Render リージョン
    plan: free                 # 後で starter に上げられる
    buildCommand: "./bin/render-build.sh"
    startCommand: "bundle exec puma -C config/puma.rb"
    healthCheckPath: /up        # Render の生存監視（DB は見ない。production.rb で silence 済み）
    envVars:
      - { key: RAILS_ENV, value: production }
      - { key: TZ, value: Asia/Tokyo }                 # 日付境界ズレ対策で必須（生成回数の日次上限）
      - { key: RAILS_MAX_THREADS, value: "3" }
      - { key: JWT_SECRET_KEY, generateValue: true }   # Render が乱数生成（再作成で再生成される点に留意）
      - { key: RAILS_MASTER_KEY, sync: false }         # ダッシュボードで master.key の中身を入力
      - { key: DATABASE_URL, sync: false }             # Neon プール接続文字列
      - { key: CORS_ALLOWED_ORIGINS, sync: false }     # Vercel 本番URL（完全一致）
      - { key: CORS_ALLOWED_ORIGIN_REGEX, sync: false } # Vercel プレビュー（チーム slug 込み）
```

- `sync: false` の4つは秘密/環境依存のためダッシュボードで手入力（リポジトリに置かない）。
- `JWT_SECRET_KEY` は `generateValue: true` で Render が生成。サービス再作成で値が変わり既存トークンが無効化されるが、スケルトンでは許容。
- `rootDir: backend` によりビルド/起動コマンドは `backend/` を基準に解決される。
- Blueprint を使わずダッシュボードで手動作成する場合も、上記を「設定の正」とする。

### `backend/bin/render-build.sh`

```sh
#!/usr/bin/env bash
set -o errexit   # どれか失敗したらビルドを止める

bundle install
bundle exec rails db:migrate
```

- 実行権限を付与（`chmod +x`）。Render 公式の Rails ガイドが採用する build script パターン。free プランでも動く。
- API モードのためアセットのプリコンパイルは無し。
- マイグレーションはビルド時に走る（8マイグレーション、いずれも additive なのでこの順序で問題ない）。

### 本番 env の一覧（`docs/deployment.md` に表で載せる）

| 変数 | 出所 | 備考 |
|---|---|---|
| `RAILS_ENV` | render.yaml | `production` |
| `TZ` | render.yaml | `Asia/Tokyo`（必須） |
| `RAILS_MAX_THREADS` | render.yaml | puma スレッド数 |
| `JWT_SECRET_KEY` | Render 自動生成 | devise-jwt 署名鍵 |
| `RAILS_MASTER_KEY` | 手入力 | `backend/config/master.key` の中身 |
| `DATABASE_URL` | 手入力 | Neon の **プール接続文字列**（`-pooler` ホスト） |
| `CORS_ALLOWED_ORIGINS` | 手入力 | Vercel 本番URL |
| `CORS_ALLOWED_ORIGIN_REGEX` | 手入力 | Vercel プレビュー用。**チーム slug を必ず含める**（`\A \z` は実装側が付けるので書かない） |

### 運用上の注意（docs に明記）

- **free プランはスリープする**: 無操作で ~15 分後にスパンダウンし、次アクセスのコールドスタートに数十秒かかる。スモークや後段 E2E の初回が遅い点に留意。
- **Neon はプール接続**: `-pooler` 付きホストの接続文字列を使う（直接接続だと接続数を枯渇させる）。Rails のマイグレーションは build script で別途走らせるため、pooler 経由の prepared statement 問題は通常起きない。

## Frontend: スモークUI（`/smoke`）

`frontend/src/app/smoke/page.tsx` にクライアントコンポーネントを1枚置く。ボタン押下で順に実行し、各ステップの結果を画面に表示する。

### 実行フロー

1. `GET /api/health` → `{ status, database }` を表示。
2. `POST /api/auth/sign_up`（固定ユーザー `smoke@kotoe.test` / 固定パスワード、body `{ user: { email, password } }`）。
   - 既に存在する場合の 422（`email: [taken]`）は許容して次へ進む（スモークを冪等にする）。
3. `POST /api/auth/sign_in`（同じ固定ユーザー）→ 200。
   - **レスポンスの `Authorization` ヘッダを JS から読めたか**を明示表示する。これが CORS の `expose: ["Authorization"]` が別オリジンで効いているかの核心。読めなければ CORS 設定が不完全。
4. `GET /api/me`（`Authorization: Bearer <jwt>` 付き）→ email を表示。

### 実装方針

- **`src/lib/api.ts` は使わず直接 `fetch`**。理由: (a) レスポンスヘッダの生読みが必要（`api.ts` はボディしか返さない）、(b) これは一時ツールで、JWT 付与ロジックは 7-1 で `api.ts` に正式実装される。ファイル冒頭に「一時スモーク。7-1 で削除/置き換え」とコメントする。CLAUDE.md の「fetch を散らさない」は本番配線の規約であり、一時スモークは例外として許容する。
- API ベース URL は `process.env.NEXT_PUBLIC_API_BASE_URL`（既存の規約どおり）。
- スモークユーザーは固定1件のゴミ行が本番 DB に残る。cleanup は Render Shell の rails console で行う（`docs/deployment.md` に手順を記載）。

## デプロイ順序（chicken-egg の解消）

Render は production で CORS 未設定だと boot で raise する。一方 CORS の完全一致オリジンには Vercel の本番URLが必要で、Vercel のスモークは Render の URL が必要。相互依存を次の順序で解く。

1. **Neon**: プロジェクト/DB 作成 → **プール接続文字列**をコピー。
2. **Render**: Web Service 作成（Blueprint or 手動）。`DATABASE_URL` / `RAILS_MASTER_KEY` / `JWT_SECRET_KEY`（自動生成）/ `TZ` を設定。CORS はまず `CORS_ALLOWED_ORIGIN_REGEX`（Vercel プレビューの slug パターン＝アカウントから既知）だけ入れて boot を通す。デプロイ → **curl で `/api/health` と sign_up→sign_in→/me を確認**（CORS 不要なサーバ側検証）。
3. **Vercel**: プロジェクト作成（Root Directory = `frontend`）。`NEXT_PUBLIC_API_BASE_URL` = Render の URL を設定 → デプロイ → 本番URL確定。
4. **Render**: `CORS_ALLOWED_ORIGINS` = Vercel 本番URL を追加・保存（Render が再起動）。
5. **ブラウザ**: Vercel の `/smoke` を開いて実行 → 別オリジンの CORS/JWT を実機確認（Authorization ヘッダが JS から読めること）。

さらに、8-2a task 3 として **Vercel プレビューの向き先を本番バックエンド（スケルトン）にする**設定を `docs/deployment.md` に記載（以降 PR ごとに継続検証できるようにする）。プレビューは `CORS_ALLOWED_ORIGIN_REGEX` でカバーされる。

## 完了条件（8-2a のチェック）

- [ ] 本番URLで `/api/health` が `{ status: "ok", database: "ok" }`（Neon プール接続 OK）
- [ ] curl で sign_up → sign_in → `/api/me` が通る
- [ ] ブラウザ `/smoke`（Vercel オリジン）で **Authorization ヘッダを JS から読めた**（CORS/JWT 実機 OK）
- [ ] Vercel プレビューの向き先を本番バックエンドにする設定を docs に記載
- [ ] `docs/issues_backlog.md` の 8-2a チェックを更新

## Part B: backlog 2-2 チェックボックス更新（申し送り対応）

`docs/issues_backlog.md` の 2-2 タスク（現状 105–107 行）を次のように更新する。

- `- [x] Authorization ヘッダの露出設定（expose: ["Authorization"]）` … 2-2 で完了。
- `- [x] request spec（許可オリジンからの認証API呼び出しで JWT を受け取れる）` … 2-2 で完了。
- 「本番（Vercel）のオリジンを許可オリジンに追加」の行を、単純チェックではなく **8-2a へ委譲した旨の注記に書き換える**（完了にすると実態と食い違うため）:

  > `- 許可オリジンの env 化（CORS_ALLOWED_ORIGINS / _REGEX）と production 未設定時の fail-fast は実装済み（0-3・2-2）。**本番 Vercel オリジンの実値投入は 8-2a に委譲**（Vercel URL 確定後に Render の env へ設定するため、ここではチェックしない）。`

## テスト戦略

- **新規 RSpec / E2E は無し**。この issue はインフラ配線であり backend のコード変更が無い。スモークUIは一時ツールで、テスト戦略（フロント単体テストは MVP で不採用）の対象外。コアループの E2E は 8-1 で別途。
- 検証は「本番URLへの curl」と「ブラウザでの `/smoke` 実行」で行う（＝疎通スモーク）。

## ブランチ / PR

- ブランチ: `feature/issue-8-2a`（main から。既に作成済み）。
- 1 issue = 1 PR。CI（rubocop / rspec）は backend 変更が無いため既存のまま green。
- PR には render.yaml・render-build.sh・スモークUI・deployment.md・backlog 更新を含める。ダッシュボード作業とスモーク結果は PR 説明に記録する。

## やらないこと（この issue の範囲外）

- カスタムドメイン / DNS（8-2b）。
- Cloudinary（3-1）・画像生成キー（4-3）の本番疎通。スケルトンでは `active_storage.service = :local` のまま。
- 本番 Dockerfile 化（必要になったら別途）。
- フル継続"本番"デプロイ（半完成機能を毎回本番へ出す運用はしない。以降は Vercel プレビューで継続検証）。
