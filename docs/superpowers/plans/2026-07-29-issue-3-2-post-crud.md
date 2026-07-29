# issue 3-2 Post CRUD API 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** お題（Post）の一覧・検索・投稿・詳細・論理削除を JSON API として実装し、request spec 込みで green にする。

**Architecture:** 一覧の絞り込みと集計は `Post.listing` というクラスメソッド 1 本に集約し、挑戦数といいね合計は SELECT 句の相関サブクエリで 1 クエリのうちに取る（counter cache カラムは discard を検知できないため使わない）。JSON の形は `app/serializers/` の PORO に集約し、コントローラは「どの表現を使うか」を選ぶだけにする。

**Tech Stack:** Ruby on Rails 8.1（API モード）、PostgreSQL、RSpec + FactoryBot + shoulda-matchers、kaminari（ページング）、ransack（検索）、Cloudinary（3-1 で作成済みの `Images::Validation` / `Images::Uploader`）

**設計ドキュメント:** `docs/superpowers/specs/2026-07-29-issue-3-2-post-crud-design.md`（判断の根拠はすべてここにある）

## Global Constraints

- ブランチは `feature/issue-3-2`（作成済み）。main へ直接コミットしない。1 issue = 1 PR。
- **文字列はダブルクォート**で統一する（spec ファイルも含む）。`.rubocop.yml` が `Style/StringLiterals: double_quotes` を強制する。
- コミット前に必ず `docker compose exec backend bundle exec rubocop` と `docker compose exec backend bundle exec rspec` を通す。
- コマンドはすべてリポジトリのルート（`/Users/tatsuhirofuruta/workspace/projects/kotoe`）から実行する。`docker compose up -d` でコンテナが起動していること。
- 物理削除を実装しない。削除は必ず `discard`。
- エラーは**文言ではなくコード**を返す。翻訳はフロントの責務。
- バリデーションエラーの形は `{ "errors": { "field": ["code"] } }`（`Api::Auth::RegistrationsController` の前例）。リクエスト単位の失敗は `{ "error": "code" }`（`Api::Auth::FailureApp` の前例）。
- API が返す日時は `iso8601`（UTC）の文字列。
- シリアライザで `as_json` / `attributes` を使ってモデル全体を流し込まない。属性は 1 つずつ明示する。
- **マイグレーションは書かない**。スキーマは 1-1 で完成済み。
- **フロントエンド（`frontend/`）は一切触らない**。
- **本番デプロイはしない**。確認はローカルと CI まで。
- 1 ページの件数は **12 件固定**。クライアントから `per` を指定させない。

## 前提の確認（実装前に 1 度だけ）

```bash
docker compose ps          # backend / db / frontend が running であること
git branch --show-current  # feature/issue-3-2 であること
```

gem は名前付きボリューム `bundle` に入るため、Gemfile を変更したらイメージの再ビルドではなく
`docker compose exec backend bundle install` で足りる。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `backend/app/models/post.rb` | お題の絞り込み・検索・並び・集計（`listing` が唯一の入口） |
| `backend/app/models/attempt.rb` | 詳細に出す挑戦の絞り込みといいね数（`listing_for` が入口） |
| `backend/app/serializers/user_serializer.rb` | ユーザーの表現（他人向け／本人向けの 2 種） |
| `backend/app/serializers/post_serializer.rb` | お題 1 件の表現 |
| `backend/app/serializers/attempt_serializer.rb` | 挑戦 1 件の表現 |
| `backend/app/serializers/pagination_serializer.rb` | `meta`（ページ情報） |
| `backend/app/controllers/api/posts_controller.rb` | HTTP の入出力。判定はモデルと PORO に委ねる |
| `backend/app/controllers/application_controller.rb` | 全 API 共通の例外 → JSON 変換 |

シリアライザ単体の spec は作らない。「返るキー集合」を request spec で過不足なく検証することで担保する
（CLAUDE.md の spec 配置規約に `spec/serializers` が無いため）。

---

## Task 1: kaminari と ransack を導入する

**Files:**
- Modify: `backend/Gemfile`
- Create: `backend/config/initializers/kaminari_config.rb`
- Test: `backend/spec/models/post_spec.rb`

**Interfaces:**
- Consumes: なし
- Produces: `Post.page(n)` が使え、1 ページ 12 件になる。`ransack` が全モデルで利用可能になる（実際に使うのは Task 3）。

- [ ] **Step 1: Gemfile に 2 つの gem を追加する**

`backend/Gemfile` の `gem "marcel"` の下（`group :development, :test do` の直前）に追記する。

```ruby
# ページネーション。1 ページの件数は config/initializers/kaminari_config.rb で固定し、
# クライアントからは指定させない（per を開放すると一度に全件取られる）。
gem "kaminari"

# 検索。公開 API のクエリは ?q= の平らな形に固定し、ransack の生パラメータ
# （q[title_cont]）は外に出さない。詳細は 3-2 の設計ドキュメント参照。
gem "ransack"
```

- [ ] **Step 2: インストールする**

```bash
docker compose exec backend bundle install
```

Expected: `Bundle complete!` で終わる。`backend/Gemfile.lock` が更新される。

- [ ] **Step 3: 1 ページの件数を固定する設定を書く**

Create `backend/config/initializers/kaminari_config.rb`:

```ruby
# 1 ページの件数はサーバー側で固定する。max_per_page も同じ値にしておくと、
# 将来 params[:per] を受け取る実装が入っても一度に全件取られることがない。
Kaminari.configure do |config|
  config.default_per_page = 12
  config.max_per_page = 12
end
```

- [ ] **Step 4: 失敗するテストを書く**

`backend/spec/models/post_spec.rb` の末尾（最後の `end` の直前）に追記する。

```ruby
  it "1 ページは 12 件" do
    expect(Post.page(1).limit_value).to eq(12)
  end
```

- [ ] **Step 5: テストを走らせて通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/models/post_spec.rb
```

Expected: PASS。Step 1〜3 を先に済ませているため、ここは赤にならない。
gem の導入は「先にテストが書けない」種類の作業なので、テストは設定が効いていることの確認として置く。
もし FAIL するなら、初期化ファイルの置き場所（`config/initializers/`）かファイル名の綴りを疑う。

- [ ] **Step 6: 全体が壊れていないことを確認する**

```bash
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec rubocop
```

Expected: 両方 green。

- [ ] **Step 7: コミット**

```bash
git add backend/Gemfile backend/Gemfile.lock backend/config/initializers/kaminari_config.rb backend/spec/models/post_spec.rb
git commit -m "chore: kaminari と ransack を導入し 1 ページを 12 件に固定する"
```

---

## Task 2: ユーザーの表現を UserSerializer に移す

`ApplicationController#user_json` には「本格的なシリアライザ整備は issue 3-2」というコメントがある。
その引き取り作業。ここでは**本人向けの表現だけ**を移す。他人向けの表現（email を含まない）は
実際の消費者ができる Task 5 で足す。

**Files:**
- Create: `backend/app/serializers/user_serializer.rb`
- Modify: `backend/app/controllers/application_controller.rb`
- Modify: `backend/app/controllers/api/me_controller.rb`
- Modify: `backend/app/controllers/api/auth/registrations_controller.rb`
- Modify: `backend/app/controllers/api/auth/sessions_controller.rb`
- Test: `backend/spec/requests/api/me_spec.rb`（既存。変更しない）

**Interfaces:**
- Consumes: なし
- Produces: `UserSerializer.private_profile(user)` → `{ id: Integer, name: String, email: String }`

- [ ] **Step 1: 変更前に既存 spec が green であることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests
```

Expected: PASS。これがリファクタの安全網になる。`spec/requests/api/me_spec.rb` は
応答を `eq("id" => ..., "name" => ..., "email" => ...)` と過不足なく検証しているため、
表現が変われば必ず落ちる。

- [ ] **Step 2: UserSerializer を作る**

Create `backend/app/serializers/user_serializer.rb`:

```ruby
# API が返すユーザーの表現。
#
# 属性は 1 つずつ明示する。render json: user と書くと Rails は as_json を呼び、
# 既定では全カラム（encrypted_password を含む）を出す。さらに怖いのは、
# 将来 users にカラムを足したときにコードを変えていないのに漏れることで、
# 明示列挙にしておけばその事故が起きない。
class UserSerializer
  # 本人向け。/api/me と sign_up / sign_in の応答で使う。
  def self.private_profile(user)
    { id: user.id, name: user.name, email: user.email }
  end
end
```

- [ ] **Step 3: ApplicationController から user_json を消す**

`backend/app/controllers/application_controller.rb` の `user_json` メソッドとその上のコメント
（`# API が返すユーザーの表現。…` から `end` まで）を削除する。削除後はこうなる。

```ruby
class ApplicationController < ActionController::API
  before_action :configure_permitted_parameters, if: :devise_controller?

  protected

  # devise の既定は email / password だけなので、sign_up で name も受け取れるようにする。
  def configure_permitted_parameters
    devise_parameter_sanitizer.permit(:sign_up, keys: [ :name ])
  end
end
```

- [ ] **Step 4: 呼び出し元 3 か所を差し替える**

`backend/app/controllers/api/me_controller.rb`:

```ruby
      render json: UserSerializer.private_profile(current_user)
```

`backend/app/controllers/api/auth/registrations_controller.rb`（`respond_with` の中）:

```ruby
          render json: UserSerializer.private_profile(resource), status: :created
```

`backend/app/controllers/api/auth/sessions_controller.rb`（`respond_with` の中）:

```ruby
        render json: UserSerializer.private_profile(resource), status: :ok
```

- [ ] **Step 5: 既存 spec が変わらず green であることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests
docker compose exec backend bundle exec rubocop
```

Expected: 両方 green。応答の中身は 1 バイトも変わっていないはず。
`NameError: undefined local variable or method 'user_json'` が出たら差し替え漏れがある。

- [ ] **Step 6: コミット**

```bash
git add backend/app/serializers/user_serializer.rb backend/app/controllers
git commit -m "refactor: ユーザーの JSON 表現を UserSerializer に集約する"
```

---

## Task 3: Post に検索・並び・集計を実装する

この issue の中心。一覧の正しさ（削除済みを出さない・下書きを数えない）はすべてここで守る。

**Files:**
- Modify: `backend/app/models/post.rb`
- Test: `backend/spec/models/post_spec.rb`
- Modify: `backend/spec/factories/attempts.rb`

**Interfaces:**
- Consumes: `Attempt.kept.published`（既存の discard スコープと enum）
- Produces:
  - `Post.listing(q: String | nil, sort: String | nil)` → `ActiveRecord::Relation`。
    各レコードは `attempts_count` / `likes_count`（ともに `Integer`）を属性として持つ。
  - `Post.with_counts` → 上記 2 属性を付ける scope。単体でも使える（Task 6 の作成応答で使う）。

- [ ] **Step 1: factory に published の trait を足す**

`backend/spec/factories/attempts.rb` を次の内容にする。`draft` は enum の既定値なので trait は要らない。

```ruby
FactoryBot.define do
  factory :attempt do
    association :post
    association :user
    description { "青い空と白い雲" }

    # 公開済みの挑戦。一覧の集計や詳細に出るのはこの状態のものだけ。
    trait :published do
      status { "published" }
      generated_image_public_id { "kotoe/test/generated/sample" }
    end
  end
end
```

- [ ] **Step 2: 失敗するテストを書く**

`backend/spec/models/post_spec.rb` の末尾（最後の `end` の直前）に追記する。

```ruby
  describe ".listing" do
    it "削除済みのお題を返さない" do
      kept_post = create(:post)
      discarded_post = create(:post)
      discarded_post.discard!

      expect(Post.listing.map(&:id)).to eq([ kept_post.id ])
    end

    it "既定は新着順" do
      older = create(:post, created_at: 2.days.ago)
      newer = create(:post, created_at: 1.day.ago)

      expect(Post.listing.map(&:id)).to eq([ newer.id, older.id ])
    end

    it "attempts_count は published かつ未削除の挑戦だけを数える" do
      post = create(:post)
      create(:attempt, :published, post: post)
      create(:attempt, :published, post: post)
      create(:attempt, post: post)                       # 下書き
      create(:attempt, :published, post: post).discard!   # 削除済み

      expect(Post.listing.first.attempts_count).to eq(2)
    end

    it "likes_count は削除済み挑戦へのいいねを数えない" do
      post = create(:post)
      published = create(:attempt, :published, post: post)
      discarded = create(:attempt, :published, post: post)
      create_list(:like, 2, attempt: published)
      create(:like, attempt: discarded)
      discarded.discard!

      expect(Post.listing.first.likes_count).to eq(2)
    end

    it "挑戦が 1 件も無いお題も 0 件として返す（集計で消えない）" do
      create(:post)

      expect(Post.listing.first.attempts_count).to eq(0)
      expect(Post.listing.first.likes_count).to eq(0)
    end

    it "sort: popular はいいね合計の降順" do
      quiet = create(:post, created_at: 1.day.ago)
      loud = create(:post, created_at: 2.days.ago)
      create_list(:like, 2, attempt: create(:attempt, :published, post: loud))

      expect(Post.listing(sort: "popular").map(&:id)).to eq([ loud.id, quiet.id ])
    end

    it "未知の sort は新着順にフォールバックする" do
      older = create(:post, created_at: 2.days.ago)
      newer = create(:post, created_at: 1.day.ago)

      expect(Post.listing(sort: "nonsense").map(&:id)).to eq([ newer.id, older.id ])
    end

    it "q でタイトルの部分一致を絞り込む" do
      hit = create(:post, title: "夕暮れの交差点")
      create(:post, title: "朝の海")

      expect(Post.listing(q: "夕暮れ").map(&:id)).to eq([ hit.id ])
    end

    it "q の大文字小文字は区別しない" do
      hit = create(:post, title: "Sunset Beach")

      expect(Post.listing(q: "sunset").map(&:id)).to eq([ hit.id ])
    end

    it "q が空なら全件返す" do
      posts = create_list(:post, 2)

      expect(Post.listing(q: "").map(&:id)).to match_array(posts.map(&:id))
    end

    it "ransack で検索できる属性を title だけに絞っている" do
      expect(Post.ransackable_attributes).to eq(%w[title])
      expect(Post.ransackable_associations).to eq([])
    end
  end
```

- [ ] **Step 3: テストを走らせて落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/models/post_spec.rb
```

Expected: FAIL。`NoMethodError: undefined method 'listing' for class Post`。

- [ ] **Step 4: 実装する**

`backend/app/models/post.rb` を次の内容にする。

```ruby
class Post < ApplicationRecord
  include Discard::Model

  belongs_to :user
  has_many :attempts, dependent: :restrict_with_exception
  has_many :favorites, dependent: :destroy

  validates :title, presence: true
  validates :image_public_id, presence: true

  # 一覧・詳細で返す挑戦数といいね合計。
  #
  # counter cache カラムは使えない。discard は discarded_at を立てる UPDATE であって
  # destroy ではないため、counter cache が減らず削除済みを数え続ける。
  # JOIN + GROUP BY も採らない。2 つの集計を同時に取ると直積で件数が壊れ、
  # さらに GROUP BY があると kaminari の総件数カウントと噛み合わない。
  # SELECT 句の相関サブクエリなら 1 クエリで両方取れて、この問題がどちらも起きない。
  scope :with_counts, -> {
    select("posts.*",
           "(#{attempts_count_sql}) AS attempts_count",
           "(#{likes_count_sql}) AS likes_count")
  }

  # 同着で順序が不定になると、ページをまたいで同じレコードが重複したり抜けたりする。
  # id までタイブレークして必ず一意に定める。
  scope :recent, -> { order(created_at: :desc, id: :desc) }

  # likes_count は with_counts が付ける SELECT の別名。単体では使えないので
  # 必ず listing 経由で呼ぶこと（Postgres は SELECT の別名で ORDER BY できる）。
  scope :popular, -> { order(Arel.sql("likes_count DESC")).order(created_at: :desc, id: :desc) }

  # ransack を使うのはここだけ。公開 API のクエリは平らな ?q= に固定してあるため、
  # ransack の述語（title_cont）は外に漏れない。
  scope :search_by_title, ->(query) { query.blank? ? all : ransack(title_cont: query).result }

  # 一覧の組み立て口。コントローラはこれだけを呼ぶ。
  # search_by_title を最初に置くのは、ransack に with_counts の独自 SELECT を
  # 見せないため（ransack は自前で関係を組み直す）。
  def self.listing(q: nil, sort: nil)
    relation = search_by_title(q).kept.includes(:user).with_counts

    sort == "popular" ? relation.popular : relation.recent
  end

  # ransack が触れてよい属性の許可リスト。指定しないと ransack 4 は例外を投げる。
  # title だけに絞り、discarded_at や user_id を条件に使われる余地を残さない。
  def self.ransackable_attributes(_auth_object = nil) = %w[title]
  def self.ransackable_associations(_auth_object = nil) = []

  # 集計条件（kept / published）は Attempt 側のスコープから組み立てる。
  # 生の WHERE を手書きしないので、published の定義が変わってもここが自動で追随する。
  def self.attempts_count_sql
    Attempt.kept.published.where("attempts.post_id = posts.id").select("COUNT(*)").to_sql
  end

  def self.likes_count_sql
    Like.joins(:attempt).merge(Attempt.kept.published)
        .where("attempts.post_id = posts.id").select("COUNT(*)").to_sql
  end
end
```

- [ ] **Step 5: テストを走らせて通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/models/post_spec.rb
```

Expected: PASS（全 example）。

もし「q でタイトルの部分一致を絞り込む」だけが落ちる場合は、ransack と独自 SELECT の
合成が壊れている。その場合は `search_by_title` を ransack を使わない形に差し替える
（設計ドキュメントの方針は「API のクエリを平らに保つ」ことであり、ransack 自体は手段）。

```ruby
  scope :search_by_title, ->(query) {
    query.blank? ? all : where("posts.title ILIKE ?", "%#{sanitize_sql_like(query)}%")
  }
```

差し替えた場合は `ransackable_attributes` の 2 行と Gemfile の `gem "ransack"`、
および「ransack で検索できる属性を title だけに絞っている」の example も削除し、
設計ドキュメントに理由を追記すること。

- [ ] **Step 6: 全体と rubocop を確認する**

```bash
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec rubocop
```

Expected: 両方 green。

- [ ] **Step 7: コミット**

```bash
git add backend/app/models/post.rb backend/spec/models/post_spec.rb backend/spec/factories/attempts.rb
git commit -m "feat: お題一覧の検索・並び替え・集計スコープを実装する"
```

---

## Task 4: Attempt に詳細用のスコープを実装する

**Files:**
- Modify: `backend/app/models/attempt.rb`
- Test: `backend/spec/models/attempt_spec.rb`

**Interfaces:**
- Consumes: なし
- Produces: `Attempt.listing_for(post)` → `ActiveRecord::Relation`。各レコードは `likes_count`（`Integer`）を属性として持つ。

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/models/attempt_spec.rb` の末尾（最後の `end` の直前）に追記する。

```ruby
  describe ".listing_for" do
    let(:post) { create(:post) }

    it "published かつ未削除の挑戦を新着順で返す" do
      older = create(:attempt, :published, post: post, created_at: 2.days.ago)
      newer = create(:attempt, :published, post: post, created_at: 1.day.ago)

      expect(Attempt.listing_for(post).map(&:id)).to eq([ newer.id, older.id ])
    end

    it "下書きを含めない" do
      create(:attempt, post: post)

      expect(Attempt.listing_for(post)).to be_empty
    end

    it "削除済みの挑戦を含めない" do
      create(:attempt, :published, post: post).discard!

      expect(Attempt.listing_for(post)).to be_empty
    end

    it "他のお題の挑戦を含めない" do
      create(:attempt, :published, post: create(:post))

      expect(Attempt.listing_for(post)).to be_empty
    end

    it "likes_count を持つ" do
      attempt = create(:attempt, :published, post: post)
      create_list(:like, 2, attempt: attempt)

      expect(Attempt.listing_for(post).first.likes_count).to eq(2)
    end
  end
```

- [ ] **Step 2: テストを走らせて落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/models/attempt_spec.rb
```

Expected: FAIL。`NoMethodError: undefined method 'listing_for' for class Attempt`。

- [ ] **Step 3: 実装する**

`backend/app/models/attempt.rb` の `validates :status, presence: true` の下に追記する。

```ruby

  # いいね数。Post と同じ理由（discard を counter cache が検知できない）で
  # SELECT 句の相関サブクエリにする。
  scope :with_likes_count, -> {
    select("attempts.*", "(#{likes_count_sql}) AS likes_count")
  }

  # 同着の順序を一意に定める（Post.recent と同じ理由）。
  scope :recent, -> { order(created_at: :desc, id: :desc) }

  # お題詳細に出す挑戦の組み立て口。他人の下書きを見せないのがここの要点。
  def self.listing_for(post)
    kept.published.where(post: post).includes(:user).with_likes_count.recent
  end

  def self.likes_count_sql
    Like.where("likes.attempt_id = attempts.id").select("COUNT(*)").to_sql
  end
```

- [ ] **Step 4: テストを走らせて通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/models/attempt_spec.rb
```

Expected: PASS。

- [ ] **Step 5: 全体と rubocop を確認する**

```bash
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec rubocop
```

Expected: 両方 green。

- [ ] **Step 6: コミット**

```bash
git add backend/app/models/attempt.rb backend/spec/models/attempt_spec.rb
git commit -m "feat: お題詳細に出す挑戦のスコープといいね数を実装する"
```

---

## Task 5: `GET /api/posts`（一覧・検索・ページング）

**Files:**
- Create: `backend/app/serializers/post_serializer.rb`
- Create: `backend/app/serializers/pagination_serializer.rb`
- Modify: `backend/app/serializers/user_serializer.rb`
- Create: `backend/app/controllers/api/posts_controller.rb`
- Modify: `backend/config/routes.rb`
- Test: `backend/spec/requests/api/posts_spec.rb`

**Interfaces:**
- Consumes: `Post.listing(q:, sort:)`（Task 3）、`UserSerializer`（Task 2）
- Produces:
  - `UserSerializer.public_profile(user)` → `{ id:, name: }`（email を含まない）
  - `PostSerializer.call(post)` → お題 1 件の Hash。`post` は `with_counts` を通っている必要がある
  - `PaginationSerializer.call(relation)` → `{ current_page:, total_pages:, total_count: }`

- [ ] **Step 1: 失敗するテストを書く**

Create `backend/spec/requests/api/posts_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe "GET /api/posts", type: :request do
  # 実行された SELECT の本数を数える。N+1 を作り込んでいないことの検査に使う。
  def count_select_queries
    count = 0
    counter = lambda do |_name, _start, _finish, _id, payload|
      count += 1 if payload[:sql].start_with?("SELECT") && !%w[SCHEMA CACHE].include?(payload[:name])
    end

    ActiveSupport::Notifications.subscribed(counter, "sql.active_record") { yield }
    count
  end

  it "認証なしで一覧を取得できる" do
    author = create(:user, name: "投稿者")
    post_record = create(:post, user: author, title: "夕暮れの交差点", image_public_id: "kotoe/test/posts/a")
    create_list(:like, 2, attempt: create(:attempt, :published, post: post_record))

    get "/api/posts"

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["posts"].first).to eq(
      "id" => post_record.id,
      "title" => "夕暮れの交差点",
      "image_public_id" => "kotoe/test/posts/a",
      "user" => { "id" => author.id, "name" => "投稿者" },
      "attempts_count" => 1,
      "likes_count" => 2,
      "created_at" => post_record.created_at.utc.iso8601
    )
  end

  # 投稿者の表現に email が混ざらないことを、キーの過不足なしで固定する。
  # include ではなく contain_exactly にすることで、将来 users にカラムを足したり
  # うっかり as_json に書き換えたときに必ず赤くなる。
  it "投稿者に email を含めない" do
    create(:post)

    get "/api/posts"

    expect(response.parsed_body["posts"].first["user"].keys).to contain_exactly("id", "name")
  end

  it "削除済みのお題は出ない" do
    create(:post).discard!

    get "/api/posts"

    expect(response.parsed_body["posts"]).to be_empty
    expect(response.parsed_body["meta"]["total_count"]).to eq(0)
  end

  it "1 ページ 12 件で、13 件目は 2 ページ目に出る" do
    create_list(:post, 13)

    get "/api/posts"
    expect(response.parsed_body["posts"].size).to eq(12)
    expect(response.parsed_body["meta"]).to eq(
      "current_page" => 1, "total_pages" => 2, "total_count" => 13
    )

    get "/api/posts", params: { page: 2 }
    expect(response.parsed_body["posts"].size).to eq(1)
    expect(response.parsed_body["meta"]["current_page"]).to eq(2)
  end

  it "q でタイトルを絞り込む" do
    hit = create(:post, title: "夕暮れの交差点")
    create(:post, title: "朝の海")

    get "/api/posts", params: { q: "夕暮れ" }

    expect(response.parsed_body["posts"].map { |p| p["id"] }).to eq([ hit.id ])
  end

  it "sort=popular でいいね合計の降順になる" do
    quiet = create(:post, created_at: 1.day.ago)
    loud = create(:post, created_at: 2.days.ago)
    create_list(:like, 2, attempt: create(:attempt, :published, post: loud))

    get "/api/posts", params: { sort: "popular" }

    expect(response.parsed_body["posts"].map { |p| p["id"] }).to eq([ loud.id, quiet.id ])
  end

  it "未知の sort は新着順にフォールバックする" do
    older = create(:post, created_at: 2.days.ago)
    newer = create(:post, created_at: 1.day.ago)

    get "/api/posts", params: { sort: "nonsense" }

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["posts"].map { |p| p["id"] }).to eq([ newer.id, older.id ])
  end

  it "お題が増えてもクエリ数が増えない（N+1 を作り込まない）" do
    create(:post)
    with_one = count_select_queries { get "/api/posts" }

    create_list(:post, 2)
    with_three = count_select_queries { get "/api/posts" }

    expect(with_three).to eq(with_one)
  end
end
```

- [ ] **Step 2: テストを走らせて落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb
```

Expected: FAIL。全 example が 404（ルートが無い）で落ちる。

- [ ] **Step 3: UserSerializer に他人向けの表現を足す**

`backend/app/serializers/user_serializer.rb` の `private_profile` の上に追記する。

```ruby
  # 他人に見せる表現。お題の投稿者・挑戦者として出るときはこちら。email を含めない。
  def self.public_profile(user)
    { id: user.id, name: user.name }
  end

```

- [ ] **Step 4: PostSerializer を作る**

Create `backend/app/serializers/post_serializer.rb`:

```ruby
# お題 1 件の表現。一覧・詳細・作成の応答で共通に使う。
#
# attempts_count / likes_count は Post.with_counts が SELECT 句で付ける別名属性なので、
# そのスコープを通っていない Post を渡すと ActiveModel::MissingAttributeError になる。
# 0 を既定値にして握りつぶさないのは、with_counts の付け忘れが「黙って 0 が並ぶ一覧」
# として表に出るより、その場で落ちたほうが直せるため。
class PostSerializer
  def self.call(post)
    {
      id: post.id,
      title: post.title,
      image_public_id: post.image_public_id,
      user: UserSerializer.public_profile(post.user),
      attempts_count: post.attempts_count,
      likes_count: post.likes_count,
      created_at: post.created_at.utc.iso8601
    }
  end
end
```

- [ ] **Step 5: PaginationSerializer を作る**

Create `backend/app/serializers/pagination_serializer.rb`:

```ruby
# kaminari が持つページ情報を meta として返す。
#
# total_count の既定の集計列は :all（＝ COUNT(*)）なので、Post.with_counts が
# 足した独自 SELECT を巻き込まずに数えられる。
class PaginationSerializer
  def self.call(relation)
    {
      current_page: relation.current_page,
      total_pages: relation.total_pages,
      total_count: relation.total_count
    }
  end
end
```

- [ ] **Step 6: ルートを足す**

`backend/config/routes.rb` の `namespace :api do` ブロック内、`get "me" => "me#show"` の下に追記する。

```ruby

    # お題（issue 3-2）。一覧・詳細は認証不要、投稿・削除は要ログイン。
    resources :posts, only: %i[index create show destroy]
```

- [ ] **Step 7: コントローラを作る**

Create `backend/app/controllers/api/posts_controller.rb`:

```ruby
module Api
  # お題（Post）の CRUD。絞り込み・集計の判定はモデル（Post.listing）に、
  # JSON の形はシリアライザに寄せ、ここは HTTP の入出力だけを扱う。
  class PostsController < ApplicationController
    def index
      posts = Post.listing(q: params[:q], sort: params[:sort]).page(params[:page])

      render json: {
        posts: posts.map { |post| PostSerializer.call(post) },
        meta: PaginationSerializer.call(posts)
      }
    end
  end
end
```

- [ ] **Step 8: テストを走らせて通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb
```

Expected: PASS（全 example）。

「1 ページ 12 件で、13 件目は 2 ページ目に出る」だけが `total_count` の値で落ちる場合は、
kaminari が独自 SELECT を巻き込んで数えている。`PaginationSerializer` を次の形に直す。

```ruby
      total_count: relation.except(:select).count(:all)
```

- [ ] **Step 9: 全体と rubocop を確認する**

```bash
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec rubocop
```

Expected: 両方 green。

- [ ] **Step 10: コミット**

```bash
git add backend/app/serializers backend/app/controllers/api/posts_controller.rb backend/config/routes.rb backend/spec/requests/api/posts_spec.rb
git commit -m "feat: GET /api/posts（一覧・検索・ページング）を実装する"
```

---

## Task 6: `POST /api/posts`（投稿）

3-1 で作った `Images::Validation` と `Images::Uploader` の最初の利用者。
**画像とタイトルの検証を両方先に済ませ、どちらも通ってから Cloudinary へ上げる**のが要点。

**Files:**
- Modify: `backend/app/controllers/api/posts_controller.rb`
- Test: `backend/spec/requests/api/posts_spec.rb`

**Interfaces:**
- Consumes: `Images::Validation.call(file)` → `error_code` を持つ値オブジェクト（`valid?` あり）、
  `Images::Uploader.call(file, kind: :post)` → public_id の String、失敗時 `Images::Uploader::UploadError`
- Produces: なし（このタスクで完結）

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/posts_spec.rb` の末尾（ファイル末尾の `end` の後）に、新しい describe を追記する。

```ruby

RSpec.describe "POST /api/posts", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }
  let(:image) { uploaded_file(:jpeg, filename: "sunset.jpg", type: "image/jpeg") }

  it "画像とタイトルを送るとお題を作成する" do
    expect {
      post "/api/posts",
        params: { post: { title: "夕暮れの交差点", image: image } },
        headers: auth_headers(token)
    }.to change(Post, :count).by(1)

    expect(response).to have_http_status(:created)

    created = Post.last
    expect(created.user).to eq(user)
    expect(created.title).to eq("夕暮れの交差点")
    # spec/support/cloudinary.rb の既定スタブが保存先フォルダから public_id を作る。
    expect(created.image_public_id).to eq("kotoe/test/posts/stubbed")

    expect(response.parsed_body["post"]).to include(
      "id" => created.id,
      "title" => "夕暮れの交差点",
      "attempts_count" => 0,
      "likes_count" => 0
    )
  end

  it "投稿者は current_user になる（user_id を送っても無視する）" do
    other = create(:user)

    post "/api/posts",
      params: { post: { title: "夕暮れ", image: image, user_id: other.id } },
      headers: auth_headers(token)

    expect(response).to have_http_status(:created)
    expect(Post.last.user).to eq(user)
  end

  it "タイトルが空と画像が過大なとき、両方のエラーを一度に返す" do
    too_large = uploaded_file(:jpeg, filename: "big.jpg", type: "image/jpeg", bytesize: 5.megabytes + 1)

    expect {
      post "/api/posts",
        params: { post: { title: "", image: too_large } },
        headers: auth_headers(token)
    }.not_to change(Post, :count)

    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).to eq(
      "title" => [ "blank" ],
      "image" => [ "image_too_large" ]
    )
  end

  it "画像が無いと image_missing を返す" do
    post "/api/posts",
      params: { post: { title: "夕暮れ" } },
      headers: auth_headers(token)

    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).to eq("image" => [ "image_missing" ])
  end

  it "検証で落ちたときは Cloudinary へ上げない" do
    post "/api/posts",
      params: { post: { title: "夕暮れ" } },
      headers: auth_headers(token)

    expect(Cloudinary::Uploader).not_to have_received(:upload)
  end

  it "Cloudinary が失敗したら 502 と image_upload_failed を返す" do
    allow(Cloudinary::Uploader).to receive(:upload).and_raise(StandardError, "boom")

    expect {
      post "/api/posts",
        params: { post: { title: "夕暮れ", image: image } },
        headers: auth_headers(token)
    }.not_to change(Post, :count)

    expect(response).to have_http_status(:bad_gateway)
    expect(response.parsed_body["error"]).to eq("image_upload_failed")
  end

  it "未認証だと 401 を返す" do
    post "/api/posts", params: { post: { title: "夕暮れ", image: image } }

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("unauthorized")
  end
end
```

- [ ] **Step 2: テストを走らせて落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb -e "POST /api/posts"
```

Expected: FAIL。`AbstractController::ActionNotFound` か 404。

- [ ] **Step 3: 実装する**

`backend/app/controllers/api/posts_controller.rb` を次の内容にする。

```ruby
module Api
  # お題（Post）の CRUD。絞り込み・集計の判定はモデル（Post.listing）に、
  # JSON の形はシリアライザに寄せ、ここは HTTP の入出力だけを扱う。
  class PostsController < ApplicationController
    before_action :authenticate_user!, only: %i[create]

    def index
      posts = Post.listing(q: params[:q], sort: params[:sort]).page(params[:page])

      render json: {
        posts: posts.map { |post| PostSerializer.call(post) },
        meta: PaginationSerializer.call(posts)
      }
    end

    def create
      image = params.dig(:post, :image)
      post = current_user.posts.new(title: params.dig(:post, :title))

      errors = collect_errors(post, Images::Validation.call(image))
      return render json: { errors: errors }, status: :unprocessable_content if errors.any?

      post.image_public_id = Images::Uploader.call(image, kind: :post)
      post.save!

      # 新規レコードには with_counts の別名属性が乗っていないため、
      # 一覧と同じ表現を返せるよう取り直す。
      render json: { post: PostSerializer.call(Post.with_counts.find(post.id)) }, status: :created
    rescue Images::Uploader::UploadError
      render json: { error: "image_upload_failed" }, status: :bad_gateway
    end

    private

    # 画像とタイトルのエラーをまとめて返す。片方ずつ返すと往復が増えるうえ、
    # 先にアップロードしてからタイトル未入力に気づくと、誰からも参照されない
    # 画像が Cloudinary に残る。
    #
    # 形は { field => [code] }。Api::Auth::RegistrationsController と揃えてある。
    def collect_errors(post, validation)
      # image_public_id はアップロード後に入るので、ここでは title のエラーだけを見る。
      post.valid?
      title_errors = post.errors.details[:title].pluck(:error)

      errors = {}
      errors[:title] = title_errors if title_errors.any?
      errors[:image] = [ validation.error_code ] unless validation.valid?
      errors
    end
  end
end
```

`params.dig` で 1 つずつ取り出しているのは、`params.expect` だと `post` キーごと欠けたリクエストが
400 になり、`image_missing` の 422 を返せなくなるため。値を個別に代入しているので
mass assignment の危険はない（`user_id` は `current_user.posts` 経由で入るため params から入り込めない）。

- [ ] **Step 4: テストを走らせて通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb
```

Expected: PASS（一覧の example も含めて全部）。

- [ ] **Step 5: 全体と rubocop を確認する**

```bash
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec rubocop
```

Expected: 両方 green。

- [ ] **Step 6: コミット**

```bash
git add backend/app/controllers/api/posts_controller.rb backend/spec/requests/api/posts_spec.rb
git commit -m "feat: POST /api/posts（お題の投稿）を実装する"
```

---

## Task 7: `GET /api/posts/:id`（詳細）と 404 の JSON 化

**Files:**
- Create: `backend/app/serializers/attempt_serializer.rb`
- Modify: `backend/app/controllers/api/posts_controller.rb`
- Modify: `backend/app/controllers/application_controller.rb`
- Test: `backend/spec/requests/api/posts_spec.rb`

**Interfaces:**
- Consumes: `Attempt.listing_for(post)`（Task 4）、`PostSerializer.call`（Task 5）
- Produces: `AttemptSerializer.call(attempt)` → 挑戦 1 件の Hash。`attempt` は `with_likes_count` を通っている必要がある

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/posts_spec.rb` の末尾に追記する。

```ruby

RSpec.describe "GET /api/posts/:id", type: :request do
  it "認証なしでお題と挑戦一覧を取得できる" do
    challenger = create(:user, name: "挑戦者")
    post_record = create(:post, title: "夕暮れの交差点")
    attempt = create(:attempt, :published,
      post: post_record, user: challenger,
      description: "夕日に染まる横断歩道", similarity_score: nil)
    create_list(:like, 3, attempt: attempt)

    get "/api/posts/#{post_record.id}"

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["post"]["id"]).to eq(post_record.id)
    expect(response.parsed_body["attempts"].first).to eq(
      "id" => attempt.id,
      "description" => "夕日に染まる横断歩道",
      "generated_image_public_id" => "kotoe/test/generated/sample",
      "status" => "published",
      "similarity_score" => nil,
      "user" => { "id" => challenger.id, "name" => "挑戦者" },
      "likes_count" => 3,
      "created_at" => attempt.created_at.utc.iso8601
    )
    expect(response.parsed_body["meta"]).to eq(
      "current_page" => 1, "total_pages" => 1, "total_count" => 1
    )
  end

  it "他人の下書きは出ない" do
    post_record = create(:post)
    create(:attempt, post: post_record)

    get "/api/posts/#{post_record.id}"

    expect(response.parsed_body["attempts"]).to be_empty
  end

  it "削除済みの挑戦は出ない" do
    post_record = create(:post)
    create(:attempt, :published, post: post_record).discard!

    get "/api/posts/#{post_record.id}"

    expect(response.parsed_body["attempts"]).to be_empty
  end

  it "挑戦一覧も 1 ページ 12 件でページングする" do
    post_record = create(:post)
    create_list(:attempt, 13, :published, post: post_record)

    get "/api/posts/#{post_record.id}", params: { page: 2 }

    expect(response.parsed_body["attempts"].size).to eq(1)
    expect(response.parsed_body["meta"]["total_count"]).to eq(13)
  end

  it "削除済みのお題は 404 を返す" do
    post_record = create(:post)
    post_record.discard!

    get "/api/posts/#{post_record.id}"

    expect(response).to have_http_status(:not_found)
    expect(response.parsed_body["error"]).to eq("not_found")
  end

  it "存在しない ID は 404 を返す" do
    get "/api/posts/999999"

    expect(response).to have_http_status(:not_found)
    expect(response.parsed_body["error"]).to eq("not_found")
  end
end
```

- [ ] **Step 2: テストを走らせて落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb -e "GET /api/posts/:id"
```

Expected: FAIL。`AbstractController::ActionNotFound`。

- [ ] **Step 3: RecordNotFound を JSON の 404 に変換する**

`backend/app/controllers/application_controller.rb` の `before_action` の下に追記する。

```ruby

  # API モードでは例外がそのまま HTML のエラーページ経路に流れるため、JSON に揃える。
  # find が見つからないケース（削除済み・存在しない ID・他人のリソース）はすべてここに来る。
  rescue_from ActiveRecord::RecordNotFound do
    render json: { error: "not_found" }, status: :not_found
  end
```

- [ ] **Step 4: AttemptSerializer を作る**

Create `backend/app/serializers/attempt_serializer.rb`:

```ruby
# 挑戦 1 件の表現。お題詳細の挑戦一覧で使う（4-2 以降の挑戦 API でも使い回す）。
#
# likes_count は Attempt.with_likes_count が SELECT 句で付ける別名属性なので、
# そのスコープを通っていない Attempt を渡すと ActiveModel::MissingAttributeError になる。
class AttemptSerializer
  def self.call(attempt)
    {
      id: attempt.id,
      description: attempt.description,
      generated_image_public_id: attempt.generated_image_public_id,
      status: attempt.status,
      similarity_score: attempt.similarity_score,
      user: UserSerializer.public_profile(attempt.user),
      likes_count: attempt.likes_count,
      created_at: attempt.created_at.utc.iso8601
    }
  end
end
```

- [ ] **Step 5: show アクションを足す**

`backend/app/controllers/api/posts_controller.rb` の `create` の下（`private` の上）に追記する。

```ruby

    def show
      post = Post.kept.includes(:user).with_counts.find(params[:id])
      attempts = Attempt.listing_for(post).page(params[:page])

      render json: {
        post: PostSerializer.call(post),
        # 挑戦の並びは新着順で固定。いいね順（ベスト再現）は 6-1 で
        # ここに sort の分岐を足す。
        attempts: attempts.map { |attempt| AttemptSerializer.call(attempt) },
        meta: PaginationSerializer.call(attempts)
      }
    end
```

- [ ] **Step 6: テストを走らせて通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb
```

Expected: PASS（全 example）。

- [ ] **Step 7: 全体と rubocop を確認する**

```bash
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec rubocop
```

Expected: 両方 green。

- [ ] **Step 8: コミット**

```bash
git add backend/app/serializers/attempt_serializer.rb backend/app/controllers backend/spec/requests/api/posts_spec.rb
git commit -m "feat: GET /api/posts/:id（お題詳細と挑戦一覧）を実装する"
```

---

## Task 8: `DELETE /api/posts/:id`（論理削除）

**Files:**
- Modify: `backend/app/controllers/api/posts_controller.rb`
- Test: `backend/spec/requests/api/posts_spec.rb`

**Interfaces:**
- Consumes: `rescue_from ActiveRecord::RecordNotFound`（Task 7）
- Produces: なし（このタスクで完結）

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/posts_spec.rb` の末尾に追記する。

```ruby

RSpec.describe "DELETE /api/posts/:id", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }

  it "自分のお題を論理削除する" do
    post_record = create(:post, user: user)

    expect {
      delete "/api/posts/#{post_record.id}", headers: auth_headers(token)
    }.not_to change(Post.unscoped, :count)

    expect(response).to have_http_status(:no_content)
    expect(post_record.reload.discarded?).to be true
  end

  it "削除しても紐づく挑戦は残る" do
    post_record = create(:post, user: user)
    attempt = create(:attempt, :published, post: post_record)

    delete "/api/posts/#{post_record.id}", headers: auth_headers(token)

    expect(response).to have_http_status(:no_content)
    expect(attempt.reload).to be_kept
  end

  it "削除したお題は一覧に出ない" do
    post_record = create(:post, user: user)
    delete "/api/posts/#{post_record.id}", headers: auth_headers(token)

    get "/api/posts"

    expect(response.parsed_body["posts"]).to be_empty
  end

  it "他人のお題は 404 を返す（削除もされない）" do
    others = create(:post)

    delete "/api/posts/#{others.id}", headers: auth_headers(token)

    expect(response).to have_http_status(:not_found)
    expect(response.parsed_body["error"]).to eq("not_found")
    expect(others.reload).to be_kept
  end

  it "既に削除済みのお題は 404 を返す" do
    post_record = create(:post, user: user)
    post_record.discard!

    delete "/api/posts/#{post_record.id}", headers: auth_headers(token)

    expect(response).to have_http_status(:not_found)
  end

  it "未認証だと 401 を返す" do
    post_record = create(:post, user: user)

    delete "/api/posts/#{post_record.id}"

    expect(response).to have_http_status(:unauthorized)
    expect(post_record.reload).to be_kept
  end
end
```

- [ ] **Step 2: テストを走らせて落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb -e "DELETE /api/posts/:id"
```

Expected: FAIL。`AbstractController::ActionNotFound`。

- [ ] **Step 3: destroy アクションを足す**

`backend/app/controllers/api/posts_controller.rb` の `before_action` を更新する。

```ruby
    before_action :authenticate_user!, only: %i[create destroy]
```

`show` の下（`private` の上）に追記する。

```ruby

    def destroy
      # current_user.posts に限定することで、所有チェックの書き忘れが起こりようがない。
      # 他人のお題・存在しない ID・削除済みは、すべて RecordNotFound → 404 になる。
      # 403 と分けないのは、お題自体が一覧・詳細で公開されており隠せる情報が無いため。
      current_user.posts.kept.find(params[:id]).discard!
      head :no_content
    end
```

- [ ] **Step 4: テストを走らせて通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb
```

Expected: PASS（全 example）。

- [ ] **Step 5: 全体と rubocop を確認する**

```bash
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec rubocop
```

Expected: 両方 green。

- [ ] **Step 6: コミット**

```bash
git add backend/app/controllers/api/posts_controller.rb backend/spec/requests/api/posts_spec.rb
git commit -m "feat: DELETE /api/posts/:id（お題の論理削除）を実装する"
```

---

## Task 9: 仕上げ（brakeman・ローカル動作確認・バックログ更新）

**Files:**
- Modify: `docs/issues_backlog.md`
- Modify（必要な場合のみ）: `backend/config/brakeman.ignore`

**Interfaces:**
- Consumes: Task 1〜8 のすべて
- Produces: PR に出せる状態

- [ ] **Step 1: CI と同じチェックを回す**

```bash
docker compose exec backend bundle exec rubocop
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec brakeman --no-pager
```

Expected: 3 つとも green。

brakeman が `Post` の `select` について SQL Injection を警告した場合のみ、対話モードで
無視リストに登録する。補間しているのは ActiveRecord が組み立てた SQL のみで、ユーザー入力は
一切通っていない（検索は ransack がプレースホルダ化する）ことを理由として記録する。

```bash
docker compose exec backend bundle exec brakeman -I
```

- [ ] **Step 2: ローカルで実際に叩いて確認する**

CLAUDE.md の「① issue を実装するたび：ローカルでブラウザから動作確認」に当たる。
**この確認は実際に Cloudinary へアップロードする**（保存先は `kotoe/development/posts/`）。

```bash
# 1. ログインして JWT を取る（ユーザーが無ければ先に sign_up する）
curl -i -X POST http://localhost:3000/api/auth/sign_in \
  -H "Content-Type: application/json" \
  -d '{"user":{"email":"YOUR_EMAIL","password":"YOUR_PASSWORD"}}'
# 応答ヘッダの Authorization の値を控える

# 2. お題を投稿する（PATH_TO_IMAGE は手元の jpg / png）
curl -i -X POST http://localhost:3000/api/posts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "post[title]=夕暮れの交差点" \
  -F "post[image]=@PATH_TO_IMAGE"

# 3. 一覧・検索・並び替え
curl -s "http://localhost:3000/api/posts" | jq
curl -s "http://localhost:3000/api/posts?q=夕暮れ" | jq
curl -s "http://localhost:3000/api/posts?sort=popular" | jq

# 4. 詳細
curl -s "http://localhost:3000/api/posts/1" | jq

# 5. 削除して、一覧から消えることを確認する
curl -i -X DELETE http://localhost:3000/api/posts/1 -H "Authorization: Bearer YOUR_TOKEN"
curl -s "http://localhost:3000/api/posts" | jq
```

確認する点：

- 投稿が 201 で返り、Cloudinary のダッシュボードで `kotoe/development/posts/` に画像が入っている
- 一覧の `image_public_id` がその画像を指している
- 検索・並び替えが効く
- 削除が 204 で返り、その後の一覧に出ない
- **応答のどこにも email が含まれていない**

- [ ] **Step 3: バックログの 3-2 にチェックを入れる**

`docs/issues_backlog.md` の「### 🟢 3-2. Post CRUD API」のタスクを更新する。

```markdown
### 🟢 3-2. Post CRUD API
- 目的：お題の投稿・一覧・詳細・削除。
- 依存：2-1, 3-1
- タスク：
  - [x] `GET /api/posts`（ransack 検索 + kaminari ページング）
  - [x] `POST /api/posts`（画像＋タイトル、要ログイン）
  - [x] `GET /api/posts/:id`（お題＋挑戦一覧）
        → `sort=likes`（ベスト再現）は **6-1 に委譲**。6-1 は 5-1（いいね API）に依存しており、
        3-2 の時点ではいいねを作る手段が無いため。設計は
        `docs/superpowers/specs/2026-07-29-issue-3-2-post-crud-design.md`
  - [x] `DELETE /api/posts/:id`（自分のお題を論理削除）
  - [x] JSON シリアライザ整備（`app/serializers/` の PORO）、request spec
- 完了条件：一覧・検索・詳細・投稿・削除が spec 込みで動く。論理削除したお題は一覧に出ない。
```

- [ ] **Step 4: コミット**

```bash
git add docs/issues_backlog.md backend/config/brakeman.ignore
git commit -m "docs: issue 3-2 の完了チェックとベスト再現の委譲を記録する"
```

（`brakeman.ignore` を作らなかった場合は `git add docs/issues_backlog.md` だけでよい。）

- [ ] **Step 5: PR を出す**

```bash
git push -u origin feature/issue-3-2
gh pr create --title "feat: Post CRUD API (issue 3-2)" --body "$(cat <<'EOF'
## 概要
issue 3-2。お題（Post）の一覧・検索・投稿・詳細・論理削除を JSON API として実装した。

設計: `docs/superpowers/specs/2026-07-29-issue-3-2-post-crud-design.md`

## エンドポイント
| メソッド | パス | 認証 |
|---|---|---|
| GET | `/api/posts`（`?q=&sort=new\|popular&page=`） | 不要 |
| POST | `/api/posts`（multipart：title + image） | 必要 |
| GET | `/api/posts/:id`（お題＋挑戦一覧、`?page=`） | 不要 |
| DELETE | `/api/posts/:id`（論理削除） | 必要 |

## 主な判断
- 挑戦数・いいね合計は **SELECT 句の相関サブクエリ**で取る。counter cache は discard を検知できず、
  JOIN + GROUP BY は 2 つの集計が直積で壊れるうえ kaminari の総件数と噛み合わないため
- 検索・並び・絞り込みは `Post.listing` に集約し、コントローラは HTTP の入出力だけを扱う
- JSON の形は `app/serializers/` の PORO に集約。gem は入れていない。
  `ApplicationController#user_json` は `UserSerializer` に引き取って廃止した
- 投稿は「画像とタイトルの検証を両方先に済ませてからアップロード」の順。
  参照されない画像が Cloudinary に残るのを防ぐ
- 詳細の `sort=likes`（ベスト再現）は **6-1 に委譲**。5-1（いいね API）が無い段階では実装しても検証できない

## 確認
- rubocop / rspec / brakeman green
- ローカルで 4 エンドポイントを curl で疎通（Cloudinary の `kotoe/development/posts/` への保存も確認）
- 本番デプロイはしていない（本番固有の統合が無いため。方針は CLAUDE.md の「動作確認・デプロイの進め方」）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## セルフレビュー結果

**仕様カバレッジ**（設計ドキュメントの各節 → タスク）

| 設計の要求 | タスク |
|---|---|
| kaminari / ransack の導入、1 ページ 12 件 | Task 1 |
| `user_json` 廃止と UserSerializer | Task 2 / Task 5（`public_profile`） |
| `with_counts`・`recent`・`popular`・`search_by_title`・`listing`・ransack 許可属性 | Task 3 |
| `Attempt.with_likes_count` / `recent` / `listing_for` | Task 4 |
| `GET /api/posts`（q / sort / page / meta / N+1） | Task 5 |
| `POST /api/posts`（検証を先に両方・502・401・user_id 無視） | Task 6 |
| `GET /api/posts/:id`（挑戦一覧・下書き除外・404） | Task 7 |
| `RecordNotFound` → 404 JSON | Task 7 |
| `DELETE /api/posts/:id`（204・404・挑戦が残る） | Task 8 |
| キー集合の固定（email を漏らさない） | Task 5 Step 1 |
| 並び順のタイブレーク | Task 3 / Task 4 |
| 日時は ISO8601（UTC） | Task 5 / Task 7 |
| kaminari の総件数と custom select の相性確認 | Task 5 Step 8（代替コードつき） |
| brakeman の警告対応 | Task 9 Step 1 |
| ローカル動作確認・本番デプロイしない | Task 9 Step 2 |
| バックログ更新 | Task 9 Step 3 |

**設計から意図的にずらした点**

- 設計ドキュメントは factory に `published` / `draft` の trait を足すとしていたが、`draft` は
  enum の既定値なので trait は不要。`published` のみ追加する（Task 3 Step 1）。
- `UserSerializer.public_profile` は Task 2 ではなく、最初の消費者ができる Task 5 で足す。
  消費者のいないコードを先に置かないため。
