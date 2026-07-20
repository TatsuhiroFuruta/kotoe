# issue 2-1 devise + devise-jwt による認証API 設計

- 対象 issue: [#9](https://github.com/TatsuhiroFuruta/kotoe/issues/9)（backlog 2-1、マイルストーン2：認証）
- 依存: 1-1
- ブランチ: `feature/issue-2-1-auth`
- 完了条件: JWT を Authorization ヘッダで送ると認証必須APIにアクセスでき、sign_out 後は弾かれる。

## 目的

JWT でログイン状態を運ぶ認証基盤を作る。Vercel（フロント）と Render（バック）は別ドメインのため cookie 共有は使わず、Rails が JWT を発行・検証し、フロントは Authorization ヘッダで送る。この issue で認証が通ることで、後続の 2-2（CORS）・8-2a（本番スケルトン）・3-2 以降の「要ログイン」API が乗る土台が固まる。

## スコープの前提と方針

この issue は**バックエンドの認証APIのみ**。以下は後続 issue の担当なので作らない。

- CORS の `expose: ["Authorization"]` と本番オリジン追加 … 2-2。ここでは JWT をヘッダに載せるところまで（0-3 で入れた `rack-cors` の最小設定は既存のまま触らない）。
- フロントの JWT 保存・付与・ログイン状態管理・認証ガード … 7-1。
- ログイン / 新規登録画面 … 7-2。
- マイページ用の一覧API（`/api/me/posts` 等）… 6-3。この issue で作る `/api/me` は**本人情報を返すだけ**の別物。
- 本番環境への反映・疎通 … 8-2a。

### 決定事項（設計判断）

1. **devise のモジュールは最小構成**。`database_authenticatable` / `registerable` / `validatable` / `jwt_authenticatable` のみ。`recoverable`（パスワードリセット）と `confirmable`（メール確認）は ActionMailer / SMTP の構築が前提になりこの issue のスコープが広がるため入れない。追加カラムを伴うが後から migration で足せる。
2. **ログイン識別子は email**。devise 標準であり、将来のパスワードリセット・通知でも email が要る。`name` は表示名として別に持つ（1-1 で作成済み、NOT NULL）。
3. **失効方式は Denylist 戦略**（`jwt_denylist` テーブル）。sign_out したトークンを記録して以降拒否する。バックログが `jwt_denylist` を明記しており、「ログアウトで即座に無効化できる」という要件を素直に満たす。
4. **JWT の有効期限は 24 時間**。セキュリティと再ログイン頻度のバランス。期限切れ時はフロントが再ログインへ誘導する（7-1 の担当）。
5. **`jwt_denylist` に discard は付けない**。認証インフラのテーブルであり、ユーザーが作ったコンテンツではない。期限切れレコードの掃除は将来必要になれば別途検討する（MVP ではデータ量が問題にならない）。
6. **エラーは HTTP ステータス＋機械可読な JSON**。CLAUDE.md の「判定はバック、文言はフロント」に従い、Rails は表示用の日本語文言を返さない。

## スキーマ

### users への追加（`AddDeviseToUsers`）

| 列 | 型 | 制約 |
|---|---|---|
| email | string | null: false, default: "", unique index |
| encrypted_password | string | null: false, default: "" |

- 既存の `name`（null: false）はそのまま表示名として残す。
- devise 慣例に従い default `""` を付ける（devise の generator が生成する形に揃える）。
- 最小構成のため `reset_password_*` / `confirmation_*` / `remember_created_at` 等のカラムは追加しない。

### jwt_denylist（新規／`CreateJwtDenylist`）

| 列 | 型 | 制約 |
|---|---|---|
| jti | string | null: false, index |
| exp | datetime | null: false |

- devise-jwt の Denylist 戦略が要求する構造。`jti` はトークンの一意 ID、`exp` は失効時刻。
- `t.timestamps` は付けない（devise-jwt が想定する最小構造に合わせる）。

## モデル

### User

```ruby
devise :database_authenticatable, :registerable, :validatable,
       :jwt_authenticatable, jwt_revocation_strategy: JwtDenylist
```

- `validatable` が email の presence / 形式 / 一意性と、password の presence / 長さ（6文字以上）を担保する。
- 既存の `validates :name, presence: true` は維持。結果として **sign_up には name / email / password の3つが必須**。
- 1-1 で定義済みの関連（posts / attempts / likes / favorites / reports）はそのまま。

### JwtDenylist（新規）

```ruby
class JwtDenylist < ApplicationRecord
  include Devise::JWT::RevocationStrategies::Denylist
  self.table_name = "jwt_denylist"
end
```

## ルーティング

```ruby
devise_for :users,
  path: "api/auth",
  path_names: { sign_in: "sign_in", sign_out: "sign_out", registration: "sign_up" },
  controllers: {
    sessions: "api/auth/sessions",
    registrations: "api/auth/registrations"
  }

namespace :api do
  get "me" => "me#show"
end
```

結果として生えるエンドポイント（`screen_and_api_design.md` の認証セクションと一致）：

| メソッド | パス | 役割 |
|---|---|---|
| POST | `/api/auth/sign_up` | 新規登録（JWT を発行） |
| POST | `/api/auth/sign_in` | ログイン（JWT を発行） |
| DELETE | `/api/auth/sign_out` | ログアウト（JWT を失効） |
| GET | `/api/me` | ログイン中のユーザー情報 |

`devise_for` が生成する GET 系のフォーム用ルート（`new_user_session` 等）は API モードでは不要だが、devise の内部で参照されるため無効化はせず放置する。

## コントローラ

### ApplicationController

- API モードのため `ActionController::API` を継承（0-1 の既定のまま）。
- devise のパラメータ許可：`configure_permitted_parameters` で sign_up に `name` を追加。

### セッションを使わない（api_only の維持）

Devise の `sign_up` / `sign_in` は内部で `warden.set_user` を呼び、既定でセッションへ書き込む。`config.api_only = true` ではセッションが無いため `DisabledSessionError` で落ちる。

これを**セッションミドルウェアを戻して解決してはいけない**。cookie セッションを有効にすると `_kotoe_session` が発行され、**その cookie だけで認証が通る第二の認証経路**ができる。JWT の失効（`jwt_denylist`）はその経路に効かないため、ログアウトしても cookie でアクセスできてしまう。

正しい対処は、セッション書き込みだけを飛ばすこと：

- `sign_up` を上書きして `sign_in(resource_name, resource, store: false)` を呼ぶ（Registrations）。
- `sign_in` は strategy 経由なので `config.skip_session_storage = [ :http_auth, :params_auth ]` で足りる（Sessions）。

JWT は Warden の `after_set_user` フックで発行され、このフックは `store` の値に関係なく必ず走るため、トークン発行は影響を受けない。

### Api::Auth::FailureApp（`Devise::FailureApp` を継承）

認証の失敗（パスワード不一致、トークン無し／失効）は**コントローラに到達せず Warden の failure app が処理する**ため、JSON を返すには failure app の差し替えが必要になる。`config.warden` で `config.failure_app = Api::Auth::FailureApp` を指定する。

- 常に `401` と JSON を返す（HTML へのリダイレクトはしない）。
- Warden のメッセージでエラーコードを出し分ける：
  - `:invalid`（email / password 不一致）→ `{ "error": "invalid_credentials" }`
  - それ以外（トークン無し・失効・不正）→ `{ "error": "unauthorized" }`

### Api::Auth::RegistrationsController（`Devise::RegistrationsController` を継承）

- `POST /api/auth/sign_up`
- 成功：`201 Created`、body はユーザー JSON。devise-jwt が Authorization ヘッダに JWT を載せる。
- 失敗（バリデーションエラー）：`422 Unprocessable Content`、body は `{ "errors": { "email": ["taken"], "name": ["blank"] } }`。`resource.errors.details` を使い、**表示用の文言ではなくエラーコード**をフィールド別に返す（`to_hash` は英語の文言を返すため使わない）。フロントがコードから日本語の文言を組み立てる。

### Api::Auth::SessionsController（`Devise::SessionsController` を継承）

- `POST /api/auth/sign_in`
  - 成功：`200 OK`、body はユーザー JSON、Authorization ヘッダに JWT。
  - 失敗（email / password 不一致）：`401 Unauthorized`、body は `{ "error": "invalid_credentials" }`。**この応答は上記 FailureApp が返す**（コントローラには来ない）。
- `DELETE /api/auth/sign_out`
  - 成功：`200 OK`。devise-jwt が該当トークンの `jti` を `jwt_denylist` に記録する。
  - 有効な JWT が無い場合：`401`。

### Api::MeController

- `GET /api/me`、`before_action :authenticate_user!`
- 成功：`200 OK`、`current_user` のユーザー JSON。
- 未認証・失効トークン：`401`。

### ユーザー JSON の形

```json
{ "id": 1, "name": "テスト太郎", "email": "user@example.com" }
```

当面はコントローラ内でこの形を組み立てる。本格的なシリアライザ整備は 3-2（Post CRUD API）でまとめて行う。`encrypted_password` 等を絶対に返さないため、モデルの `as_json` に頼らず**返す属性を明示的に指定する**。

## 設定

### Gemfile

```ruby
gem "devise"
gem "devise-jwt"
```

### config/initializers/devise.rb

- `config.navigational_formats = []` … API モードなので HTML のリダイレクト動作を無効化する。
- `config.warden { |manager| manager.failure_app = Api::Auth::FailureApp }` … 認証失敗を JSON で返す。
- `config.jwt do |jwt|`
  - `jwt.secret = ENV["JWT_SECRET_KEY"]`（README の環境変数一覧と一致）
  - `jwt.expiration_time = 24.hours.to_i`
  - `jwt.dispatch_requests = [["POST", %r{^/api/auth/sign_up$}]]` … sign_in は devise が既定で dispatch するため、sign_up のみ明示的に追加する。
  - `jwt.revocation_requests = [["DELETE", %r{^/api/auth/sign_out$}]]`

### 環境変数

- `JWT_SECRET_KEY` … 開発／テストでは `docker-compose.yml` と CI に固定値を渡す。本番（Render）は 8-2a で設定する。秘密情報のためリポジトリには実値を置かない。

## テスト（request spec）

`spec/requests/api/auth_spec.rb` と `spec/requests/api/me_spec.rb`。CLAUDE.md の方針どおり RSpec を主戦場とし、API の入出力を担保する。

**正常系（一連の流れ）**
1. `POST /api/auth/sign_up` … `201`、ユーザー JSON が返り、Authorization ヘッダに JWT が載る
2. `POST /api/auth/sign_in` … `200`、JWT が返る
3. `GET /api/me` … 上の JWT をヘッダに付けて `200`、自分の id / name / email が返る
4. `DELETE /api/auth/sign_out` … `200`
5. `GET /api/me` … **同じトークン**で `401`（失効の確認。この issue の完了条件そのもの）

**異常系**
- `POST /api/auth/sign_up`：email 重複で `422`、`errors` に email のキーがある
- `POST /api/auth/sign_up`：name 無しで `422`
- `POST /api/auth/sign_in`：パスワード不一致で `401`、body が `{ "error": "invalid_credentials" }`
- `GET /api/me`：Authorization ヘッダ無しで `401`、body が `{ "error": "unauthorized" }`
- `GET /api/me`：デタラメなトークンで `401`

**ファクトリ**
- `spec/factories/users.rb` に `email`（sequence でユニーク化）と `password` を追加する。既存の model spec が壊れないことを確認する。

**ヘルパ**
- `spec/support` に「サインインして Authorization ヘッダを組み立てる」ヘルパを置き、spec 間で使い回す。

## 動作確認

CLAUDE.md の「① issue を実装するたび」に従い、ローカルで確認する。本番には出さない（本番は 8-2a）。

```bash
docker compose exec backend bin/rails db:migrate
docker compose exec -e RAILS_ENV=test backend bin/rails db:prepare
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec rubocop
```

加えて curl で sign_up → sign_in → `/api/me` → sign_out → `/api/me` が 401 になることを手でも一度確認する。

## この issue で触らないもの

- `config/initializers/cors.rb`（2-2）
- フロントエンド一切（7-1 / 7-2）
- 本番環境の環境変数・デプロイ（8-2a）
