# issue 1-1 マイグレーションとモデル（全テーブル）設計

- 対象 issue: [#8](https://github.com/TatsuhiroFuruta/kotoe/issues/8)（backlog 1-1、マイルストーン1：データモデル）
- 依存: 0-2
- ブランチ: `feature/issue-1-1-models`
- 完了条件: `db:migrate` が通り、model spec が green。`Attempt.kept` 等で論理削除の絞り込みができる。

## 目的

ER 図どおりのスキーマとモデル関連を作る。6テーブル（users / posts / attempts / likes / favorites / reports）のマイグレーション・モデル・model spec を用意し、後続の認証（2-1）・お題API（3-2）・挑戦と非同期生成（4-2）が乗る土台を固める。

## スコープの前提と方針

この issue は**データモデル層のみ**。以下は後続 issue の担当なので作らない。

- 認証列（`email` / `encrypted_password` / JWT 用列）… 2-1 の devise マイグレーションに任せる。1-1 の `users` は devise 非依存の最小構成。
- Cloudinary 連携本体 … 3-1。1-1 では画像参照を保持する文字列カラムだけ用意する。
- 生成回数の日次上限ロジック … 4-2。1-1 でカウンタ列は持たない（その日に作った attempt を数えれば足りる想定）。
- request spec / job spec … 後続 issue。1-1 は model spec のみ。

### 決定事項（設計判断）

1. **status の enum は文字列バッキング**。整数は DB 上で意味が読めず並び替えで事故りやすい。文字列なら DB でそのまま読め、可読性重視の規約と合う。
2. **画像は Cloudinary の `public_id` を文字列で保持**。URL は public_id から導出できる。ActiveStorage は使わず Cloudinary gem 前提（実装は 3-1）。
3. **discard（論理削除）は posts / attempts / reports のみ**。ユーザーが作ったコンテンツ・記録として残すデータが対象。
4. **likes / favorites は物理削除**。トグル操作の実体そのもので他から参照されない。複合ユニーク index があるため、ソフトデリートだと外した後の再登録でユニーク枠が衝突する。`DELETE /like` = そのレコードを消す操作。
5. **reports は最小構成**。詳細なモデレーション状態管理は 5-3 に譲る。

> 物理削除しない = お題・挑戦・通報（他から参照される主データ／記録）。物理削除してよい = いいね・お気に入りのオンオフ（トグルの join レコード）。

## スキーマ

### users（1-1 は最小限。認証列は 2-1 の devise）

| 列 | 型 | 制約 |
|---|---|---|
| name | string | null: false |
| created_at / updated_at | datetime | timestamps |

- 関連: `has_many :posts` / `:attempts` / `:likes` / `:favorites`、`has_many :reports, foreign_key: :reporter_id`
- バリデーション: `name` presence

### posts

| 列 | 型 | 制約 |
|---|---|---|
| user_id | references | null: false, foreign_key, index |
| title | string | null: false |
| image_public_id | string | null: false |
| discarded_at | datetime | index |
| created_at / updated_at | datetime | timestamps |

- `include Discard::Model`
- 関連: `belongs_to :user`、`has_many :attempts`、`has_many :favorites`
- バリデーション: `title` presence、`image_public_id` presence

### attempts

| 列 | 型 | 制約 |
|---|---|---|
| post_id | references | null: false, foreign_key, index |
| user_id | references | null: false, foreign_key, index |
| description | text | null: false |
| generated_image_public_id | string | null: true（生成後に入る） |
| similarity_score | integer | null: true（拡張の CLIP 用） |
| status | string | null: false, default: `"draft"` |
| discarded_at | datetime | index |
| created_at / updated_at | datetime | timestamps |

- `include Discard::Model`
- 関連: `belongs_to :post`、`belongs_to :user`、`has_many :likes`、`has_many :reports`
- `enum :status, { draft: "draft", generating: "generating", published: "published", failed: "failed" }`
- バリデーション: `description` presence、`status` presence

### likes（トグル・物理削除）

| 列 | 型 | 制約 |
|---|---|---|
| user_id | references | null: false, foreign_key, index |
| attempt_id | references | null: false, foreign_key, index |
| created_at / updated_at | datetime | timestamps |

- **複合ユニーク index `[user_id, attempt_id]`**
- 関連: `belongs_to :user`、`belongs_to :attempt`
- バリデーション: `user_id` uniqueness scoped to `attempt_id`

### favorites（トグル・物理削除）

| 列 | 型 | 制約 |
|---|---|---|
| user_id | references | null: false, foreign_key, index |
| post_id | references | null: false, foreign_key, index |
| created_at / updated_at | datetime | timestamps |

- **複合ユニーク index `[user_id, post_id]`**
- 関連: `belongs_to :user`、`belongs_to :post`
- バリデーション: `user_id` uniqueness scoped to `post_id`

### reports（最小構成・本体は 5-3）

| 列 | 型 | 制約 |
|---|---|---|
| reporter_id | references（→ users） | null: false, foreign_key: { to_table: :users }, index |
| attempt_id | references | null: false, foreign_key, index |
| reason | string | null: false |
| discarded_at | datetime | index |
| created_at / updated_at | datetime | timestamps |

- `include Discard::Model`
- 関連: `belongs_to :reporter, class_name: "User"`、`belongs_to :attempt`
- バリデーション: `reason` presence

## FK / 削除の整合

- posts / attempts / users / reports は物理削除しないので、外部キーはデフォルト（restrict）で問題ない。
- likes / favorites は物理削除される join レコードだが、他テーブルから参照されないので安全。

## テスト（model spec + factories）

置き場所は `spec/models` / `spec/factories`（`rails_helper` が自動で読み込む）。文字列はダブルクォート。`create(...)` で呼べる FactoryBot 設定は導入済み。

- `spec/models/user_spec.rb`: 関連、`name` presence
- `spec/models/post_spec.rb`: 関連、バリデーション、discard の絞り込み（`Post.kept` が discard 済みを除外）
- `spec/models/attempt_spec.rb`: 関連、バリデーション、`status` enum、`similarity_score` の null 許容、discard の絞り込み（`Attempt.kept`）
- `spec/models/like_spec.rb`: 関連、複合ユニーク（同じ user × attempt の二重いいねを弾く）
- `spec/models/favorite_spec.rb`: 関連、複合ユニーク（同じ user × post の二重お気に入りを弾く）
- `spec/models/report_spec.rb`: 関連、`reason` presence、discard の絞り込み
- `spec/factories/` に users / posts / attempts / likes / favorites / reports の factory

## 依存追加

- `discard` gem を Gemfile に追加（backlog 1-1 のタスクに明記済み）。

## 完了条件（再掲）

- `bundle exec rubocop` と `bundle exec rspec` が green。
- `db:migrate`（およびテスト DB の `db:prepare`）が通る。
- `Attempt.kept` / `Post.kept` で論理削除済みを除外できる。
- 複合ユニーク index により二重いいね・二重お気に入りが防止される。
