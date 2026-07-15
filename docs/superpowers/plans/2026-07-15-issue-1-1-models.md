# issue 1-1 マイグレーションとモデル（全テーブル）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ER 図どおりの6テーブル（users / posts / attempts / likes / favorites / reports）のマイグレーション・モデル・model spec を作り、`Attempt.kept` 等で論理削除を絞り込める土台を作る。

**Architecture:** `discard` gem を導入し posts / attempts / reports をソフトデリート対応にする。likes / favorites はトグルの join レコードなので物理削除で、複合ユニーク index で二重登録を防ぐ。status は文字列バッキングの enum。画像は Cloudinary の public_id を文字列で保持（連携本体は 3-1）。認証列は 2-1 の devise に任せ、1-1 の users は最小構成。

**Tech Stack:** Ruby 3.4.10 / Rails 8.1（API モード）/ PostgreSQL / RSpec + FactoryBot / discard gem。開発・テストは docker compose 上で実行。

## Global Constraints

- 文字列は**ダブルクォート**（モデル・spec・factory すべて）。rubocop は `rubocop-rails-omakase` ベース。`db/schema.rb` と `db/migrate/**` は rubocop 対象外。
- **1 issue = 1 ブランチ = 1 PR**。ブランチは `feature/issue-1-1-models`（作成済み）。main へ直接コミットしない。
- コミット前に `docker compose exec backend bundle exec rubocop` と `docker compose exec backend bundle exec rspec` を通す。
- 論理削除は必ず `discard`（`discarded_at`）。**物理削除するのは likes / favorites のみ**。
- コマンドはすべて起動中の docker compose で実行する（先に `docker compose up -d` しておく）。
- FactoryBot は `create(...)` / `build(...)` で呼べる設定済み（`spec/rails_helper.rb`）。model spec は `spec/models/` に置くと type が自動推論される。
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` を付ける。

## File Structure

- **Modify** `backend/Gemfile` — `discard` gem を追加
- **Create** `backend/db/migrate/*_create_users.rb` 他5本 — 各テーブルのマイグレーション
- **Create** `backend/app/models/{user,post,attempt,like,favorite,report}.rb` — モデル本体（関連・バリデーション・enum・discard）
- **Create** `backend/spec/models/{user,post,attempt,like,favorite,report}_spec.rb` — model spec
- **Create** `backend/spec/factories/{users,posts,attempts,likes,favorites,reports}.rb` — factory
- **Auto** `backend/db/schema.rb` — `db:migrate` が再生成（手で触らない）

依存順（親テーブルが先）：discard 導入 → users → posts → attempts → likes → favorites → reports。子モデルの factory が親 factory を参照するため、この順序を守る。

---

### Task 1: discard gem の導入

**Files:**
- Modify: `backend/Gemfile`
- Auto: `backend/Gemfile.lock`

**Interfaces:**
- Produces: `Discard::Model`（後続タスクの Post / Attempt / Report が `include` する）

- [ ] **Step 1: Gemfile に discard を追加**

`backend/Gemfile` の `gem "rack-cors"` の行の直後に追記する：

```ruby
# 論理削除（ソフトデリート）。物理削除せず discarded_at フラグで消す。
gem "discard", "~> 1.4"
```

- [ ] **Step 2: bundle install**

Run: `docker compose exec backend bundle install`
Expected: `Bundle complete` と表示され、`Gemfile.lock` に `discard (1.4.x)` が追加される。

- [ ] **Step 3: 読み込めることを確認**

Run: `docker compose exec backend bin/rails runner "puts Discard::Model"`
Expected: `Discard::Model` が出力される（`uninitialized constant` にならない）。

- [ ] **Step 4: コミット**

```bash
git add backend/Gemfile backend/Gemfile.lock
git commit -m "$(cat <<'EOF'
feat: discard gem を導入（論理削除の基盤）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: User モデル

**Files:**
- Create: `backend/db/migrate/*_create_users.rb`
- Create: `backend/app/models/user.rb`
- Create: `backend/spec/factories/users.rb`
- Test: `backend/spec/models/user_spec.rb`

**Interfaces:**
- Produces: `User`（`name:string`）。関連 `has_many :posts / :attempts / :likes / :favorites`、`has_many :reports, foreign_key: :reporter_id`。factory `:user`（`name` は連番で valid）。

- [ ] **Step 1: factory を書く**

Create `backend/spec/factories/users.rb`:

```ruby
FactoryBot.define do
  factory :user do
    sequence(:name) { |n| "user#{n}" }
  end
end
```

- [ ] **Step 2: 失敗する spec を書く**

Create `backend/spec/models/user_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe User, type: :model do
  it "有効な factory を持つ" do
    expect(build(:user)).to be_valid
  end

  it "name が無いと無効" do
    expect(build(:user, name: nil)).to be_invalid
  end
end
```

- [ ] **Step 3: spec を走らせて落ちることを確認**

Run: `docker compose exec backend bundle exec rspec spec/models/user_spec.rb`
Expected: FAIL（`uninitialized constant User`）。

- [ ] **Step 4: マイグレーションを生成して内容を差し替える**

Run: `docker compose exec backend bin/rails g migration CreateUsers`
生成された `backend/db/migrate/*_create_users.rb` の中身を全部これに置き換える：

```ruby
class CreateUsers < ActiveRecord::Migration[8.1]
  def change
    create_table :users do |t|
      t.string :name, null: false

      t.timestamps
    end
  end
end
```

- [ ] **Step 5: マイグレーションを流す**

Run: `docker compose exec backend bin/rails db:migrate`
Expected: `CreateUsers: migrated` と表示され、`db/schema.rb` が更新される。

- [ ] **Step 6: モデルを書く**

Create `backend/app/models/user.rb`:

```ruby
class User < ApplicationRecord
  has_many :posts, dependent: :restrict_with_exception
  has_many :attempts, dependent: :restrict_with_exception
  has_many :likes, dependent: :destroy
  has_many :favorites, dependent: :destroy
  has_many :reports, foreign_key: :reporter_id, inverse_of: :reporter, dependent: :restrict_with_exception

  validates :name, presence: true
end
```

- [ ] **Step 7: spec を走らせて通ることを確認**

Run: `docker compose exec backend bundle exec rspec spec/models/user_spec.rb`
Expected: PASS（2 examples, 0 failures）。

- [ ] **Step 8: rubocop**

Run: `docker compose exec backend bundle exec rubocop app/models/user.rb spec/models/user_spec.rb spec/factories/users.rb`
Expected: `no offenses detected`。

- [ ] **Step 9: コミット**

```bash
git add backend/db/migrate backend/db/schema.rb backend/app/models/user.rb backend/spec/models/user_spec.rb backend/spec/factories/users.rb
git commit -m "$(cat <<'EOF'
feat: User モデルとマイグレーションを追加

認証列は 2-1 の devise に任せ、1-1 は name のみの最小構成。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Post モデル（discard）

**Files:**
- Create: `backend/db/migrate/*_create_posts.rb`
- Create: `backend/app/models/post.rb`
- Create: `backend/spec/factories/posts.rb`
- Test: `backend/spec/models/post_spec.rb`

**Interfaces:**
- Consumes: `User` / factory `:user`
- Produces: `Post`（`user_id` / `title:string` / `image_public_id:string` / `discarded_at`）。`Discard::Model`。`belongs_to :user`、`has_many :attempts / :favorites`。factory `:post`。

- [ ] **Step 1: factory を書く**

Create `backend/spec/factories/posts.rb`:

```ruby
FactoryBot.define do
  factory :post do
    association :user
    sequence(:title) { |n| "お題#{n}" }
    image_public_id { "kotoe/sample_post" }
  end
end
```

- [ ] **Step 2: 失敗する spec を書く**

Create `backend/spec/models/post_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe Post, type: :model do
  it "有効な factory を持つ" do
    expect(build(:post)).to be_valid
  end

  it "title が無いと無効" do
    expect(build(:post, title: nil)).to be_invalid
  end

  it "image_public_id が無いと無効" do
    expect(build(:post, image_public_id: nil)).to be_invalid
  end

  it "user と attempts に紐づく" do
    post = create(:post)
    attempt = create(:attempt, post: post)
    expect(post.user).to be_a(User)
    expect(post.attempts).to include(attempt)
  end

  it "discard すると kept から外れ discarded に入る" do
    post = create(:post)
    post.discard
    expect(post.discarded?).to be true
    expect(Post.kept).not_to include(post)
    expect(Post.discarded).to include(post)
  end
end
```

> 注：`user と attempts に紐づく` と `discard` の一部は Task 4（Attempt）の factory に依存する。Task 3 単体では attempt を使わない検証まで通ればよく、attempt 依存の example は Task 4 完了後に緑になる。順番に実装するので問題ない。

- [ ] **Step 3: spec を走らせて落ちることを確認**

Run: `docker compose exec backend bundle exec rspec spec/models/post_spec.rb`
Expected: FAIL（`uninitialized constant Post`）。

- [ ] **Step 4: マイグレーションを生成して内容を差し替える**

Run: `docker compose exec backend bin/rails g migration CreatePosts`
中身を全部これに置き換える：

```ruby
class CreatePosts < ActiveRecord::Migration[8.1]
  def change
    create_table :posts do |t|
      t.references :user, null: false, foreign_key: true
      t.string :title, null: false
      t.string :image_public_id, null: false
      t.datetime :discarded_at

      t.timestamps
    end
    add_index :posts, :discarded_at
  end
end
```

- [ ] **Step 5: マイグレーションを流す**

Run: `docker compose exec backend bin/rails db:migrate`
Expected: `CreatePosts: migrated`。

- [ ] **Step 6: モデルを書く**

Create `backend/app/models/post.rb`:

```ruby
class Post < ApplicationRecord
  include Discard::Model

  belongs_to :user
  has_many :attempts, dependent: :restrict_with_exception
  has_many :favorites, dependent: :destroy

  validates :title, presence: true
  validates :image_public_id, presence: true
end
```

- [ ] **Step 7: spec を走らせて通ることを確認**

Run: `docker compose exec backend bundle exec rspec spec/models/post_spec.rb`
Expected: PASS（5 examples, 0 failures）。attempt 依存の example が落ちる場合は Task 4 完了後に再実行して緑にする。

- [ ] **Step 8: rubocop**

Run: `docker compose exec backend bundle exec rubocop app/models/post.rb spec/models/post_spec.rb spec/factories/posts.rb`
Expected: `no offenses detected`。

- [ ] **Step 9: コミット**

```bash
git add backend/db/migrate backend/db/schema.rb backend/app/models/post.rb backend/spec/models/post_spec.rb backend/spec/factories/posts.rb
git commit -m "$(cat <<'EOF'
feat: Post モデルとマイグレーションを追加（discard 対応）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Attempt モデル（enum + discard）

**Files:**
- Create: `backend/db/migrate/*_create_attempts.rb`
- Create: `backend/app/models/attempt.rb`
- Create: `backend/spec/factories/attempts.rb`
- Test: `backend/spec/models/attempt_spec.rb`

**Interfaces:**
- Consumes: `User` / `Post` / factory `:user` / `:post`
- Produces: `Attempt`（`post_id` / `user_id` / `description:text` / `generated_image_public_id:string(null可)` / `similarity_score:integer(null可)` / `status:string default "draft"` / `discarded_at`）。enum `status: { draft, generating, published, failed }`。`belongs_to :post / :user`、`has_many :likes / :reports`。factory `:attempt`。

- [ ] **Step 1: factory を書く**

Create `backend/spec/factories/attempts.rb`:

```ruby
FactoryBot.define do
  factory :attempt do
    association :post
    association :user
    description { "青い空と白い雲" }
    status { "draft" }
  end
end
```

- [ ] **Step 2: 失敗する spec を書く**

Create `backend/spec/models/attempt_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe Attempt, type: :model do
  it "有効な factory を持つ" do
    expect(build(:attempt)).to be_valid
  end

  it "description が無いと無効" do
    expect(build(:attempt, description: nil)).to be_invalid
  end

  it "status は既定で draft" do
    expect(build(:attempt).status).to eq("draft")
  end

  it "generated_image_public_id と similarity_score は null 可" do
    attempt = build(:attempt, generated_image_public_id: nil, similarity_score: nil)
    expect(attempt).to be_valid
  end

  it "status enum のスコープと述語が使える" do
    attempt = create(:attempt, status: "published")
    expect(attempt.published?).to be true
    expect(Attempt.published).to include(attempt)
  end

  it "未知の status を代入すると ArgumentError" do
    expect { build(:attempt, status: "unknown") }.to raise_error(ArgumentError)
  end

  it "post と user に紐づく" do
    attempt = create(:attempt)
    expect(attempt.post).to be_a(Post)
    expect(attempt.user).to be_a(User)
  end

  it "discard すると kept から外れ discarded に入る" do
    attempt = create(:attempt)
    attempt.discard
    expect(attempt.discarded?).to be true
    expect(Attempt.kept).not_to include(attempt)
    expect(Attempt.discarded).to include(attempt)
  end
end
```

- [ ] **Step 3: spec を走らせて落ちることを確認**

Run: `docker compose exec backend bundle exec rspec spec/models/attempt_spec.rb`
Expected: FAIL（`uninitialized constant Attempt`）。

- [ ] **Step 4: マイグレーションを生成して内容を差し替える**

Run: `docker compose exec backend bin/rails g migration CreateAttempts`
中身を全部これに置き換える：

```ruby
class CreateAttempts < ActiveRecord::Migration[8.1]
  def change
    create_table :attempts do |t|
      t.references :post, null: false, foreign_key: true
      t.references :user, null: false, foreign_key: true
      t.text :description, null: false
      t.string :generated_image_public_id
      t.integer :similarity_score
      t.string :status, null: false, default: "draft"
      t.datetime :discarded_at

      t.timestamps
    end
    add_index :attempts, :discarded_at
  end
end
```

- [ ] **Step 5: マイグレーションを流す**

Run: `docker compose exec backend bin/rails db:migrate`
Expected: `CreateAttempts: migrated`。

- [ ] **Step 6: モデルを書く**

Create `backend/app/models/attempt.rb`:

```ruby
class Attempt < ApplicationRecord
  include Discard::Model

  belongs_to :post
  belongs_to :user
  has_many :likes, dependent: :destroy
  has_many :reports, dependent: :restrict_with_exception

  enum :status, { draft: "draft", generating: "generating", published: "published", failed: "failed" }

  validates :description, presence: true
  validates :status, presence: true
end
```

- [ ] **Step 7: spec を走らせて通ることを確認**

Run: `docker compose exec backend bundle exec rspec spec/models/attempt_spec.rb`
Expected: PASS（8 examples, 0 failures）。

- [ ] **Step 8: Task 3 の Post spec を再確認**

Run: `docker compose exec backend bundle exec rspec spec/models/post_spec.rb`
Expected: PASS（attempt 依存の example も緑になる）。

- [ ] **Step 9: rubocop**

Run: `docker compose exec backend bundle exec rubocop app/models/attempt.rb spec/models/attempt_spec.rb spec/factories/attempts.rb`
Expected: `no offenses detected`。

- [ ] **Step 10: コミット**

```bash
git add backend/db/migrate backend/db/schema.rb backend/app/models/attempt.rb backend/spec/models/attempt_spec.rb backend/spec/factories/attempts.rb
git commit -m "$(cat <<'EOF'
feat: Attempt モデルとマイグレーションを追加（status enum + discard）

status は文字列バッキングの enum（draft/generating/published/failed）。
生成前の generated_image_public_id / similarity_score は null 許容。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Like モデル（複合ユニーク・物理削除）

**Files:**
- Create: `backend/db/migrate/*_create_likes.rb`
- Create: `backend/app/models/like.rb`
- Create: `backend/spec/factories/likes.rb`
- Test: `backend/spec/models/like_spec.rb`

**Interfaces:**
- Consumes: `User` / `Attempt` / factory `:user` / `:attempt`
- Produces: `Like`（`user_id` / `attempt_id`、複合ユニーク index）。`belongs_to :user / :attempt`。factory `:like`。discard は使わない（物理削除）。

- [ ] **Step 1: factory を書く**

Create `backend/spec/factories/likes.rb`:

```ruby
FactoryBot.define do
  factory :like do
    association :user
    association :attempt
  end
end
```

- [ ] **Step 2: 失敗する spec を書く**

Create `backend/spec/models/like_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe Like, type: :model do
  it "有効な factory を持つ" do
    expect(build(:like)).to be_valid
  end

  it "user と attempt に紐づく" do
    like = create(:like)
    expect(like.user).to be_a(User)
    expect(like.attempt).to be_a(Attempt)
  end

  it "同じ user と attempt の組み合わせは二重に作れない" do
    like = create(:like)
    dup = build(:like, user: like.user, attempt: like.attempt)
    expect(dup).to be_invalid
  end

  it "別 user なら同じ attempt にいいねできる" do
    like = create(:like)
    other = build(:like, attempt: like.attempt)
    expect(other).to be_valid
  end
end
```

- [ ] **Step 3: spec を走らせて落ちることを確認**

Run: `docker compose exec backend bundle exec rspec spec/models/like_spec.rb`
Expected: FAIL（`uninitialized constant Like`）。

- [ ] **Step 4: マイグレーションを生成して内容を差し替える**

Run: `docker compose exec backend bin/rails g migration CreateLikes`
中身を全部これに置き換える：

```ruby
class CreateLikes < ActiveRecord::Migration[8.1]
  def change
    create_table :likes do |t|
      t.references :user, null: false, foreign_key: true
      t.references :attempt, null: false, foreign_key: true

      t.timestamps
    end
    add_index :likes, [ :user_id, :attempt_id ], unique: true
  end
end
```

- [ ] **Step 5: マイグレーションを流す**

Run: `docker compose exec backend bin/rails db:migrate`
Expected: `CreateLikes: migrated`。

- [ ] **Step 6: モデルを書く**

Create `backend/app/models/like.rb`:

```ruby
class Like < ApplicationRecord
  belongs_to :user
  belongs_to :attempt

  validates :user_id, uniqueness: { scope: :attempt_id }
end
```

- [ ] **Step 7: spec を走らせて通ることを確認**

Run: `docker compose exec backend bundle exec rspec spec/models/like_spec.rb`
Expected: PASS（4 examples, 0 failures）。

- [ ] **Step 8: rubocop**

Run: `docker compose exec backend bundle exec rubocop app/models/like.rb spec/models/like_spec.rb spec/factories/likes.rb`
Expected: `no offenses detected`。

- [ ] **Step 9: コミット**

```bash
git add backend/db/migrate backend/db/schema.rb backend/app/models/like.rb backend/spec/models/like_spec.rb backend/spec/factories/likes.rb
git commit -m "$(cat <<'EOF'
feat: Like モデルとマイグレーションを追加（複合ユニーク・物理削除）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Favorite モデル（複合ユニーク・物理削除）

**Files:**
- Create: `backend/db/migrate/*_create_favorites.rb`
- Create: `backend/app/models/favorite.rb`
- Create: `backend/spec/factories/favorites.rb`
- Test: `backend/spec/models/favorite_spec.rb`

**Interfaces:**
- Consumes: `User` / `Post` / factory `:user` / `:post`
- Produces: `Favorite`（`user_id` / `post_id`、複合ユニーク index）。`belongs_to :user / :post`。factory `:favorite`。discard は使わない（物理削除）。

- [ ] **Step 1: factory を書く**

Create `backend/spec/factories/favorites.rb`:

```ruby
FactoryBot.define do
  factory :favorite do
    association :user
    association :post
  end
end
```

- [ ] **Step 2: 失敗する spec を書く**

Create `backend/spec/models/favorite_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe Favorite, type: :model do
  it "有効な factory を持つ" do
    expect(build(:favorite)).to be_valid
  end

  it "user と post に紐づく" do
    favorite = create(:favorite)
    expect(favorite.user).to be_a(User)
    expect(favorite.post).to be_a(Post)
  end

  it "同じ user と post の組み合わせは二重に作れない" do
    favorite = create(:favorite)
    dup = build(:favorite, user: favorite.user, post: favorite.post)
    expect(dup).to be_invalid
  end

  it "別 user なら同じ post をお気に入りにできる" do
    favorite = create(:favorite)
    other = build(:favorite, post: favorite.post)
    expect(other).to be_valid
  end
end
```

- [ ] **Step 3: spec を走らせて落ちることを確認**

Run: `docker compose exec backend bundle exec rspec spec/models/favorite_spec.rb`
Expected: FAIL（`uninitialized constant Favorite`）。

- [ ] **Step 4: マイグレーションを生成して内容を差し替える**

Run: `docker compose exec backend bin/rails g migration CreateFavorites`
中身を全部これに置き換える：

```ruby
class CreateFavorites < ActiveRecord::Migration[8.1]
  def change
    create_table :favorites do |t|
      t.references :user, null: false, foreign_key: true
      t.references :post, null: false, foreign_key: true

      t.timestamps
    end
    add_index :favorites, [ :user_id, :post_id ], unique: true
  end
end
```

- [ ] **Step 5: マイグレーションを流す**

Run: `docker compose exec backend bin/rails db:migrate`
Expected: `CreateFavorites: migrated`。

- [ ] **Step 6: モデルを書く**

Create `backend/app/models/favorite.rb`:

```ruby
class Favorite < ApplicationRecord
  belongs_to :user
  belongs_to :post

  validates :user_id, uniqueness: { scope: :post_id }
end
```

- [ ] **Step 7: spec を走らせて通ることを確認**

Run: `docker compose exec backend bundle exec rspec spec/models/favorite_spec.rb`
Expected: PASS（4 examples, 0 failures）。

- [ ] **Step 8: rubocop**

Run: `docker compose exec backend bundle exec rubocop app/models/favorite.rb spec/models/favorite_spec.rb spec/factories/favorites.rb`
Expected: `no offenses detected`。

- [ ] **Step 9: コミット**

```bash
git add backend/db/migrate backend/db/schema.rb backend/app/models/favorite.rb backend/spec/models/favorite_spec.rb backend/spec/factories/favorites.rb
git commit -m "$(cat <<'EOF'
feat: Favorite モデルとマイグレーションを追加（複合ユニーク・物理削除）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Report モデル（reporter_id + discard）

**Files:**
- Create: `backend/db/migrate/*_create_reports.rb`
- Create: `backend/app/models/report.rb`
- Create: `backend/spec/factories/reports.rb`
- Test: `backend/spec/models/report_spec.rb`

**Interfaces:**
- Consumes: `User` / `Attempt` / factory `:user` / `:attempt`
- Produces: `Report`（`reporter_id`（→ users）/ `attempt_id` / `reason:string` / `discarded_at`）。`Discard::Model`。`belongs_to :reporter, class_name: "User"`、`belongs_to :attempt`。factory `:report`。

- [ ] **Step 1: factory を書く**

Create `backend/spec/factories/reports.rb`:

```ruby
FactoryBot.define do
  factory :report do
    association :reporter, factory: :user
    association :attempt
    reason { "不適切な画像" }
  end
end
```

- [ ] **Step 2: 失敗する spec を書く**

Create `backend/spec/models/report_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe Report, type: :model do
  it "有効な factory を持つ" do
    expect(build(:report)).to be_valid
  end

  it "reason が無いと無効" do
    expect(build(:report, reason: nil)).to be_invalid
  end

  it "reporter（User）と attempt に紐づく" do
    report = create(:report)
    expect(report.reporter).to be_a(User)
    expect(report.attempt).to be_a(Attempt)
  end

  it "User から reporter として reports を辿れる" do
    user = create(:user)
    report = create(:report, reporter: user)
    expect(user.reports).to include(report)
  end

  it "discard すると kept から外れ discarded に入る" do
    report = create(:report)
    report.discard
    expect(report.discarded?).to be true
    expect(Report.kept).not_to include(report)
    expect(Report.discarded).to include(report)
  end
end
```

- [ ] **Step 3: spec を走らせて落ちることを確認**

Run: `docker compose exec backend bundle exec rspec spec/models/report_spec.rb`
Expected: FAIL（`uninitialized constant Report`）。

- [ ] **Step 4: マイグレーションを生成して内容を差し替える**

Run: `docker compose exec backend bin/rails g migration CreateReports`
中身を全部これに置き換える：

```ruby
class CreateReports < ActiveRecord::Migration[8.1]
  def change
    create_table :reports do |t|
      t.references :reporter, null: false, foreign_key: { to_table: :users }
      t.references :attempt, null: false, foreign_key: true
      t.string :reason, null: false
      t.datetime :discarded_at

      t.timestamps
    end
    add_index :reports, :discarded_at
  end
end
```

- [ ] **Step 5: マイグレーションを流す**

Run: `docker compose exec backend bin/rails db:migrate`
Expected: `CreateReports: migrated`。

- [ ] **Step 6: モデルを書く**

Create `backend/app/models/report.rb`:

```ruby
class Report < ApplicationRecord
  include Discard::Model

  belongs_to :reporter, class_name: "User"
  belongs_to :attempt

  validates :reason, presence: true
end
```

- [ ] **Step 7: spec を走らせて通ることを確認**

Run: `docker compose exec backend bundle exec rspec spec/models/report_spec.rb`
Expected: PASS（5 examples, 0 failures）。

- [ ] **Step 8: rubocop**

Run: `docker compose exec backend bundle exec rubocop app/models/report.rb spec/models/report_spec.rb spec/factories/reports.rb`
Expected: `no offenses detected`。

- [ ] **Step 9: コミット**

```bash
git add backend/db/migrate backend/db/schema.rb backend/app/models/report.rb backend/spec/models/report_spec.rb backend/spec/factories/reports.rb
git commit -m "$(cat <<'EOF'
feat: Report モデルとマイグレーションを追加（reporter_id + discard）

通報者は reporter_id で users を参照。機能本体は 5-3、ここは器のみ。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 全体の検証（完了条件のチェック）

**Files:** なし（検証のみ）

- [ ] **Step 1: 全 spec を通す**

Run: `docker compose exec backend bundle exec rspec`
Expected: 全 example が PASS（既存の request spec 含め 0 failures）。

- [ ] **Step 2: rubocop 全体**

Run: `docker compose exec backend bundle exec rubocop`
Expected: `no offenses detected`。

- [ ] **Step 3: マイグレーションのやり直しが通ることを確認**

Run: `docker compose exec backend bin/rails db:migrate:redo`
Expected: 直近マイグレーションの down → up が成功する（`down`/`up` が両方通り、`change` が可逆であることを確認）。

- [ ] **Step 4: 論理削除の絞り込みを手で確認**

Run:
```bash
docker compose exec backend bin/rails runner '
  u = User.create!(name: "check")
  p = Post.create!(user: u, title: "t", image_public_id: "x")
  a = Attempt.create!(post: p, user: u, description: "d")
  a.discard
  puts "Attempt.kept excludes discarded: #{!Attempt.kept.exists?(a.id)}"
  puts "Attempt.discarded includes it: #{Attempt.discarded.exists?(a.id)}"
  a.destroy; p.destroy; u.destroy
'
```
Expected: 両方 `true`（`Attempt.kept` が discard 済みを除外できている）。

> 注：この手動チェックは development DB に一時レコードを作って即消す。テストではないので commit 不要。

- [ ] **Step 5: PR を作成**

```bash
git push -u origin feature/issue-1-1-models
gh pr create --base main --title "feat: 全テーブルのマイグレーションとモデル (issue 1-1)" --body "$(cat <<'EOF'
## 概要
ER 図どおりの6テーブル（users / posts / attempts / likes / favorites / reports）のマイグレーション・モデル・model spec を追加。

- discard は posts / attempts / reports に適用（論理削除）
- likes / favorites はトグルの join レコードなので物理削除＋複合ユニーク index
- attempts.status は文字列バッキングの enum（draft/generating/published/failed）
- users は 1-1 では最小構成（認証列は 2-1 の devise に任せる）
- 画像は Cloudinary の public_id を文字列で保持（連携本体は 3-1）

設計: `docs/superpowers/specs/2026-07-15-issue-1-1-schema-design.md`

## 完了条件
- [x] `db:migrate` が通る
- [x] model spec が green
- [x] `Attempt.kept` 等で論理削除の絞り込みができる

Closes #8

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review メモ（計画作成者による確認）

- **Spec coverage**：spec の6テーブル・discard 範囲・enum・複合ユニーク・reporter_id・factory/model spec 方針をすべてタスク化済み。依存追加（discard gem）は Task 1。
- **Placeholder scan**：TBD / TODO / 曖昧な「適切に処理」等なし。全ステップに実コードとコマンドあり。
- **Type consistency**：モデル名・factory 名・カラム名は spec と一致。`reporter`（class_name "User"）と `has_many :reports, foreign_key: :reporter_id` が Task 2 と Task 7 で整合。
- **注意点**：Task 3 の一部 example が Task 4 の Attempt factory に依存するため、Task 3→4 の順序を守る（計画内に明記）。
