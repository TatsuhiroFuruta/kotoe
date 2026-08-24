# マイページ API（issue 6-3）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** マイページ（7-6）の4タブとプロフィールヘッダーが必要とするデータを返す API を作る（新規4本 ＋ `GET /api/me` に統計を追加）。

**Architecture:** 判定と絞り込みはモデルのスコープ／クラスメソッド（`Post.favorited_by` / `Attempt.listing_for_user` / `User` の統計3メソッド）に置き、JSON の形はシリアライザに置き、`Api::MeController` は HTTP の入出力だけを扱う。既存の `PostSerializer` / `AttemptSerializer` は変更せず、マイページ固有の「挑戦に添えるお題サマリ」だけ `PostSummarySerializer` を新設して呼び出し側で `merge` する。一覧の共通部品（`page_param`・id 集合ベースの `liked`）は先にコンセルンへ切り出してから使う。

**Tech Stack:** Ruby on Rails 8（API モード）／ RSpec ／ FactoryBot ／ shoulda-matchers ／ kaminari（1ページ12件）／ discard ／ PostgreSQL

**Spec:** `docs/superpowers/specs/2026-08-23-issue-6-3-mypage-api-design.md`

## Global Constraints

- ブランチは `feat/issue-6-3-mypage-api`（作成済み・main から分岐）。**main へ直接コミットしない**。1 issue = 1 ブランチ = 1 PR
- コマンドはすべて開発コンテナ経由で実行する：`docker compose exec backend bundle exec rspec` / `docker compose exec backend bundle exec rubocop`
- **文字列はダブルクォート**（spec ファイルも含む）。rubocop は `rubocop-rails-omakase` ベース
- FactoryBot は `create` / `build` / `create_list` で直接呼べる（`FactoryBot.` 前置は不要）
- 関連・バリデーションの宣言は shoulda-matchers、スコープや振る舞いは通常の `expect` で書く
- 論理削除は `discard`。**物理削除しない**（`likes` / `favorites` の解除だけが例外で、この issue では触らない）
- エラーは**コード**を返し、表示文言は返さない（i18n はフロント）
- **並び順のテストは、レコードの作成順を期待する順序と逆にする**。揃えると並び替えを消しても green のままになり、何も守らない
- **N+1 検査は絶対値で固定しない**。件数を1件と3件で2回測り、本数が同じことを見る（`count_select_queries`）
- マイグレーションは無い。`app/` 配下に新ディレクトリを作らないので開発コンテナの restart も不要
- 各タスクの最後に `bundle exec rubocop` と **その時点で影響する spec** を通してからコミットする

## File Structure

| ファイル | 責務 |
|---|---|
| `backend/app/controllers/concerns/paginating.rb`（新規） | `page` パラメータの丸め込み（`MAX_PAGE` / `page_param`）。`PostsController` から移設し `MeController` と共有 |
| `backend/app/controllers/concerns/attempt_rendering.rb`（変更） | `attempt_list_json(attempt, liked_ids)` を `PostsController` から引き上げ |
| `backend/app/controllers/api/posts_controller.rb`（変更） | 上2つを include し、移設した実装を削除。挙動は変えない |
| `backend/app/models/user.rb`（変更） | 統計3メソッド（`kept_posts_count` / `published_attempts_count` / `likes_received_count`） |
| `backend/app/models/post.rb`（変更） | `for_listing` スコープの切り出し、`favorited_by(user)` スコープ |
| `backend/app/models/attempt.rb`（変更） | `listing_for_user(user, status:)` |
| `backend/app/serializers/user_serializer.rb`（変更） | `private_profile_with_stats`（`/api/me` 専用） |
| `backend/app/serializers/post_summary_serializer.rb`（新規） | 挑戦カードに添えるお題の最小表現（`discarded` を持つ唯一の表現） |
| `backend/app/controllers/api/me_controller.rb`（変更） | `show` の拡張 ＋ `posts` / `attempts` / `drafts` / `favorites` の4アクション |
| `backend/config/routes.rb`（変更） | `me/posts` / `me/attempts` / `me/drafts` / `me/favorites` |
| `backend/spec/models/{user,post,attempt}_spec.rb`（変更） | 上記モデルの振る舞い |
| `backend/spec/requests/api/me_spec.rb`（変更） | `stats` |
| `backend/spec/requests/api/me/{posts,attempts,drafts,favorites}_spec.rb`（新規） | 4本の入出力 |
| `docs/issues_backlog.md` / `docs/screen_and_api_design.md`（変更） | 決定事項と公開仕様の反映 |

---

## Task 1: `Paginating` コンセルンの切り出し（挙動を変えないリファクタ）

**Files:**
- Create: `backend/app/controllers/concerns/paginating.rb`
- Modify: `backend/app/controllers/api/posts_controller.rb`（`MAX_PAGE` の定義と `page_param` を削除し include に置き換え）
- Test: `backend/spec/requests/api/posts_spec.rb`（既存。新規テストは書かない）

**Interfaces:**
- Consumes: なし
- Produces: `Paginating#page_param` → `Integer`（1〜`Paginating::MAX_PAGE` に丸めた値）。Task 8〜11 の `MeController` が使う

新しいテストは書かない。`spec/requests/api/posts_spec.rb` の「page が巨大でも配列でも 500 にならない」（既存）と「1 ページ 12 件で、13 件目は 2 ページ目に出る」（既存）が、この移設が等価であることを守る。**リファクタのタスクでは、既存テストが移設の前後で green であることがテストサイクルそのもの**。

- [ ] **Step 1: リファクタ前のベースラインを取る**

Run: `docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb`
Expected: PASS（全 example が green。ここが赤いなら移設ではなく先に原因を調べる）

- [ ] **Step 2: コンセルンを作る**

`backend/app/controllers/concerns/paginating.rb`:

```ruby
# 一覧 API の page パラメータの丸め込み。PostsController / MeController が使う。
module Paginating
  extend ActiveSupport::Concern

  # kaminari は OFFSET = 12 * (page - 1) を組み立てるため、巨大な値を渡されると
  # int8 を溢れてアダプタが例外になる。認証不要の一覧が誰でも 500 にできてしまうので
  # 上限を設ける。12 * 100 万件ぶんあれば実用上の到達点より十分に先。
  MAX_PAGE = 1_000_000

  private

  # 数値以外・配列・巨大な値のいずれで来ても 1 ページ目〜上限に収める。
  # 0 以下や数値でない値は kaminari 自身が 1 ページ目に丸めるが、
  # 上限側と「配列を渡されて to_i が無い」ケースはこちらで潰す必要がある。
  def page_param
    params[:page].to_s.to_i.clamp(1, MAX_PAGE)
  end
end
```

- [ ] **Step 3: `PostsController` から移設する**

`backend/app/controllers/api/posts_controller.rb` の変更は3か所。

1. クラス定義の直下、`include PostRendering` の次の行に `include Paginating` を足す
2. `MAX_PAGE = 1_000_000` の定義と、その上の3行のコメントを**削除する**（コメントごとコンセルンへ移した）
3. `private` 以下の `page_param` の定義と、その上の3行のコメントを**削除する**

`page_param` の呼び出し（`index` と `show` の2か所）はそのまま残す。定数はインクルードした祖先から解決されるため、コード内に `MAX_PAGE` の直接参照が残っていても通る（現状は `page_param` の中だけなので、実際には残らない）。

- [ ] **Step 4: 既存テストが引き続き通ることを確認する**

Run: `docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb`
Expected: PASS（Step 1 と同じ example 数・同じ結果）

- [ ] **Step 5: rubocop を通す**

Run: `docker compose exec backend bundle exec rubocop`
Expected: no offenses

- [ ] **Step 6: コミット**

```bash
git add backend/app/controllers/concerns/paginating.rb backend/app/controllers/api/posts_controller.rb
git commit -m "refactor: page パラメータの丸め込みを Paginating に切り出す"
```

---

## Task 2: `attempt_list_json` を `AttemptRendering` へ引き上げ（挙動を変えないリファクタ）

**Files:**
- Modify: `backend/app/controllers/concerns/attempt_rendering.rb`
- Modify: `backend/app/controllers/api/posts_controller.rb`
- Test: `backend/spec/requests/api/posts_spec.rb`（既存。新規テストは書かない）

**Interfaces:**
- Consumes: なし
- Produces: `AttemptRendering#attempt_list_json(attempt, liked_ids)` → `Hash`（`AttemptSerializer` の形）。Task 9・10 の `MeController` が使う

6-1 が `PostsController#attempt_list_json` に「3つ目の呼び出し元が来たら `AttemptRendering` に引き上げる」とコメントを残している。`me/attempts` と `me/drafts` が2つ目・3つ目なので、ここで引き上げる。既存の `spec/requests/api/posts_spec.rb`（お題詳細の `attempts` と `best_attempts`）が等価性を守る。

- [ ] **Step 1: `AttemptRendering` にメソッドを足す**

`backend/app/controllers/concerns/attempt_rendering.rb` の1行目のコメントを更新し（`AttemptsController と LikesController が使う` → `AttemptsController / PostsController / LikesController / MeController が使う`）、`liked?` の下に足す：

```ruby
  # 一覧に並べる挑戦 1 件。いいね済みかは、あらかじめ 1 クエリで引いた id の集合から
  # 判定する。すぐ上の liked? は 1 件ずつ DB を引くので、一覧では使ってはいけない。
  def attempt_list_json(attempt, liked_ids)
    AttemptSerializer.call(attempt, liked: liked_ids.include?(attempt.id))
  end
```

- [ ] **Step 2: `PostsController` から削除して include に置き換える**

`backend/app/controllers/api/posts_controller.rb`:

1. `include PostRendering` の下（`include Paginating` と並べて）に `include AttemptRendering` を足す
2. `private` 以下の `attempt_list_json` の定義と、その上のコメントブロック（`# 一覧・表彰台に並べる挑戦 1 件。…` から `# 3 つ目の呼び出し元が来たら AttemptRendering に引き上げる。` までの9行）を**削除する**

`show` の中の `attempt_list_json(attempt, liked_ids)` の呼び出しは2か所ともそのまま。

- [ ] **Step 3: 既存テストが通ることを確認する**

Run: `docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb spec/requests/api/attempts_spec.rb spec/requests/api/likes_spec.rb`
Expected: PASS（`AttemptRendering` を include するコントローラすべてを回す）

- [ ] **Step 4: rubocop を通す**

Run: `docker compose exec backend bundle exec rubocop`
Expected: no offenses

- [ ] **Step 5: コミット**

```bash
git add backend/app/controllers/concerns/attempt_rendering.rb backend/app/controllers/api/posts_controller.rb
git commit -m "refactor: attempt_list_json を AttemptRendering に引き上げる"
```

---

## Task 3: `User` の統計3メソッド

**Files:**
- Modify: `backend/app/models/user.rb`
- Test: `backend/spec/models/user_spec.rb`

**Interfaces:**
- Consumes: なし
- Produces: `User#kept_posts_count` → `Integer`／`User#published_attempts_count` → `Integer`／`User#likes_received_count` → `Integer`。Task 4 の `UserSerializer.private_profile_with_stats` が使う

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/models/user_spec.rb` の末尾（`end` の直前）に追記：

```ruby
  describe "#kept_posts_count" do
    it "自分の未削除のお題だけを数える" do
      user = create(:user)
      create_list(:post, 2, user: user)
      create(:post, user: user).discard!
      create(:post)

      expect(user.kept_posts_count).to eq(2)
    end
  end

  describe "#published_attempts_count" do
    it "自分の未削除かつ公開済みの挑戦だけを数える" do
      user = create(:user)
      create_list(:attempt, 2, :published, user: user)
      create(:attempt, user: user)
      create(:attempt, :generating, user: user)
      create(:attempt, :failed, user: user)
      create(:attempt, :published, user: user).discard!
      create(:attempt, :published)

      expect(user.published_attempts_count).to eq(2)
    end
  end

  describe "#likes_received_count" do
    it "自分の公開済み挑戦が集めたいいねを数える" do
      user = create(:user)
      create_list(:like, 3, attempt: create(:attempt, :published, user: user))

      expect(user.likes_received_count).to eq(3)
    end

    it "下書き・削除済みの挑戦、他人の挑戦へのいいねは数えない" do
      user = create(:user)
      create(:like, attempt: create(:attempt, user: user))
      discarded = create(:attempt, :published, user: user)
      create(:like, attempt: discarded)
      discarded.discard!
      create(:like, attempt: create(:attempt, :published))

      expect(user.likes_received_count).to eq(0)
    end

    # 得た票は消えない。me/attempts が削除済みお題ぶら下がりの挑戦を出す以上、
    # 「一覧に出ている挑戦のいいねを足すと合計になる」関係も保つ（設計書参照）。
    it "削除済みのお題にぶら下がる挑戦へのいいねは数える" do
      user = create(:user)
      post = create(:post)
      create(:like, attempt: create(:attempt, :published, post: post, user: user))
      post.discard!

      expect(user.likes_received_count).to eq(1)
    end
  end
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `docker compose exec backend bundle exec rspec spec/models/user_spec.rb`
Expected: FAIL（`NoMethodError: undefined method 'kept_posts_count'` など5件）

- [ ] **Step 3: 最小の実装を書く**

`backend/app/models/user.rb` の `validates :name, presence: true` の下に追記：

```ruby

  # マイページのプロフィールヘッダーに出す統計。集計条件は各タブの一覧と揃えてあり、
  # kept_posts_count は GET /api/me/posts、published_attempts_count は
  # GET /api/me/attempts の meta.total_count と一致する（設計書参照）。
  def kept_posts_count = posts.kept.count

  def published_attempts_count = attempts.kept.published.count

  # 自分の挑戦が集めたいいねの総数。お題の削除状態は見ない（得た票は消えないし、
  # me/attempts の母集合と揃える）。集計条件は Attempt のスコープから組み立てるので、
  # published の定義が変わってもここが自動で追随する。
  def likes_received_count
    Like.joins(:attempt).merge(Attempt.kept.published).where(attempts: { user_id: id }).count
  end
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `docker compose exec backend bundle exec rspec spec/models/user_spec.rb`
Expected: PASS

- [ ] **Step 5: rubocop を通す**

Run: `docker compose exec backend bundle exec rubocop`
Expected: no offenses

- [ ] **Step 6: コミット**

```bash
git add backend/app/models/user.rb backend/spec/models/user_spec.rb
git commit -m "feat: マイページの統計に使う集計を User に足す"
```

---

## Task 4: `GET /api/me` に `stats` を足す

**Files:**
- Modify: `backend/app/serializers/user_serializer.rb`
- Modify: `backend/app/controllers/api/me_controller.rb`
- Test: `backend/spec/requests/api/me_spec.rb`

**Interfaces:**
- Consumes: `User#kept_posts_count` / `User#published_attempts_count` / `User#likes_received_count`（Task 3）
- Produces: `UserSerializer.private_profile_with_stats(user)` → `Hash`（`private_profile` に `stats:` を足したもの）

`private_profile` は `sign_up` / `sign_in` も使っている。**そちらは変えない**（登録直後は必ず全部 0 になるものに集計3本を走らせない）。

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/me_spec.rb` の1本目「JWT を付けるとログイン中のユーザーを返す」は応答全体を `eq` で比較しているので、期待値に `stats` を足す形に**書き換える**：

```ruby
  it "JWT を付けるとログイン中のユーザーを返す" do
    token = sign_in_and_get_token(user)

    get "/api/me", headers: auth_headers(token)

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to eq(
      "id" => user.id,
      "name" => "テスト太郎",
      "email" => "me@example.com",
      "stats" => { "posts_count" => 0, "attempts_count" => 0, "likes_received_count" => 0 }
    )
  end
```

さらに、末尾の `end` の直前に追記：

```ruby
  # マイページのプロフィールヘッダー（7-6）が使う。投稿数と挑戦数は
  # 各タブの meta.total_count と一致する定義（設計書参照）。
  it "stats に投稿数・公開済み挑戦数・獲得いいね合計を返す" do
    create_list(:post, 2, user: user)
    create(:attempt, user: user)
    create_list(:like, 3, attempt: create(:attempt, :published, user: user))
    token = sign_in_and_get_token(user)

    get "/api/me", headers: auth_headers(token)

    expect(response.parsed_body["stats"]).to eq(
      "posts_count" => 2, "attempts_count" => 1, "likes_received_count" => 3
    )
  end

  # 拡張範囲を /api/me に閉じたことの固定。private_profile は sign_up / sign_in と
  # 共有しており、そちらで集計 3 本を走らせる理由が無い。
  it "sign_in の応答には stats を含めない" do
    post "/api/auth/sign_in",
      params: { user: { email: user.email, password: "password123" } },
      as: :json

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).not_to have_key("stats")
  end
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `docker compose exec backend bundle exec rspec spec/requests/api/me_spec.rb`
Expected: FAIL 2件（1本目は `stats` キーが無くて `eq` が不一致、追記した stats のテストが `nil` で不一致）。「sign_in の応答には stats を含めない」は最初から PASS でよい（回帰検知用）

- [ ] **Step 3: 最小の実装を書く**

`backend/app/serializers/user_serializer.rb` の `private_profile` の下に追記：

```ruby

  # /api/me 専用。マイページのプロフィールヘッダーが使う統計を足す。
  # sign_up / sign_in は private_profile のまま（登録直後は必ず全部 0 で、
  # サインインのたびに集計 3 本を走らせる理由が無い）。
  def self.private_profile_with_stats(user)
    private_profile(user).merge(
      stats: {
        posts_count: user.kept_posts_count,
        attempts_count: user.published_attempts_count,
        likes_received_count: user.likes_received_count
      }
    )
  end
```

`backend/app/controllers/api/me_controller.rb` の `show` を差し替える：

```ruby
    # 「いま誰でログインしているか」と、マイページのヘッダーに出す統計。
    def show
      render json: UserSerializer.private_profile_with_stats(current_user)
    end
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `docker compose exec backend bundle exec rspec spec/requests/api/me_spec.rb spec/requests/api/auth`
Expected: PASS（`sign_up` / `sign_in` の既存 spec も巻き込みが無いことを確認する）

- [ ] **Step 5: rubocop を通す**

Run: `docker compose exec backend bundle exec rubocop`
Expected: no offenses

- [ ] **Step 6: コミット**

```bash
git add backend/app/serializers/user_serializer.rb backend/app/controllers/api/me_controller.rb backend/spec/requests/api/me_spec.rb
git commit -m "feat: GET /api/me にマイページ用の統計を足す"
```

---

## Task 5: `Post.for_listing` の切り出しと `Post.favorited_by`

**Files:**
- Modify: `backend/app/models/post.rb`
- Test: `backend/spec/models/post_spec.rb`

**Interfaces:**
- Consumes: なし
- Produces: `Post.for_listing` → `ActiveRecord::Relation`（`kept` ＋ `includes(:user)` ＋ `with_counts`）／`Post.favorited_by(user)` → `ActiveRecord::Relation`（お気に入りした新しい順）。Task 8・11 の `MeController` が使う

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/models/post_spec.rb` の末尾（最後の `end` の直前）に追記：

```ruby
  describe ".favorited_by" do
    let(:user) { create(:user) }

    # 「お気に入りした順」であることを見るため、お題の作成順は期待する順序と逆にする。
    # 揃えると、並び替えを消して新着順のままでもテストが通ってしまう。
    it "お気に入りした新しい順に返る" do
      older_post = create(:post, created_at: 1.day.ago)
      newer_post = create(:post, created_at: 2.days.ago)
      create(:favorite, user: user, post: older_post, created_at: 2.days.ago)
      create(:favorite, user: user, post: newer_post, created_at: 1.day.ago)

      expect(Post.favorited_by(user).map(&:id)).to eq([ newer_post.id, older_post.id ])
    end

    it "お気に入りしていないお題を含めない" do
      create(:post)

      expect(Post.favorited_by(user)).to be_empty
    end

    it "他人のお気に入りを含めない" do
      create(:favorite, post: create(:post))

      expect(Post.favorited_by(user)).to be_empty
    end

    # 5-2 が削除済みお題への解除を 404 にしているので、出すと必ず 404 を返す
    # 解除ボタンが画面に並ぶ（設計書参照）。
    it "削除済みのお題を含めない" do
      post = create(:post)
      create(:favorite, user: user, post: post)
      post.discard!

      expect(Post.favorited_by(user)).to be_empty
    end

    it "attempts_count と likes_count を持つ" do
      post = create(:post)
      create(:favorite, user: user, post: post)
      create_list(:like, 2, attempt: create(:attempt, :published, post: post))

      result = Post.favorited_by(user).first
      expect(result.attempts_count).to eq(1)
      expect(result.likes_count).to eq(2)
    end
  end
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `docker compose exec backend bundle exec rspec spec/models/post_spec.rb`
Expected: FAIL 5件（`NoMethodError: undefined method 'favorited_by'`）

- [ ] **Step 3: 最小の実装を書く**

`backend/app/models/post.rb` の `search_by_title` スコープの下に追記：

```ruby

  # 一覧で返すお題の読み込み方。listing（お題一覧）とマイページの各一覧が共有する。
  scope :for_listing, -> { kept.includes(:user).with_counts }

  # マイページのお気に入り一覧。並びは「お気に入りした順」なので favorites 側の時刻で
  # 並べる（お題の新着順にすると、古いお題を今お気に入りしても奥に埋もれる）。
  # 同着は id でタイブレークしてページ間の重複・抜けを防ぐ（recent と同じ理由）。
  #
  # kept で絞るのは、5-2 が削除済みお題への解除を 404 にしているため。出すと、
  # 解除ボタンが必ず 404 を返す行が画面に出る（設計書参照）。
  #
  # joins を足しても total_count は壊れない。favorites の (user_id, post_id) が
  # 複合ユニークなので、1 つのお題が 2 行に増えることがなく distinct は要らない。
  scope :favorited_by, ->(user) {
    for_listing.joins(:favorites).where(favorites: { user_id: user.id })
               .order(Favorite.arel_table[:created_at].desc, Favorite.arel_table[:id].desc)
  }
```

`self.listing` の1行目を `for_listing` を使う形に書き換える：

```ruby
    relation = search_by_title(q).for_listing
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `docker compose exec backend bundle exec rspec spec/models/post_spec.rb spec/requests/api/posts_spec.rb`
Expected: PASS（`listing` の書き換えが等価であることを、既存のお題一覧の spec で確認する）

- [ ] **Step 5: rubocop を通す**

Run: `docker compose exec backend bundle exec rubocop`
Expected: no offenses

- [ ] **Step 6: コミット**

```bash
git add backend/app/models/post.rb backend/spec/models/post_spec.rb
git commit -m "feat: お気に入り一覧のスコープ Post.favorited_by を足す"
```

---

## Task 6: `Attempt.listing_for_user`

**Files:**
- Modify: `backend/app/models/attempt.rb`
- Test: `backend/spec/models/attempt_spec.rb`

**Interfaces:**
- Consumes: なし
- Produces: `Attempt.listing_for_user(user, status:)` → `ActiveRecord::Relation`（新着順、`likes_count` 付き、`user` と `post` を preload 済み）。Task 9・10 の `MeController` が使う

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/models/attempt_spec.rb` の `describe ".best_for"` ブロックの後ろ（最後の `end` の直前）に追記：

```ruby
  describe ".listing_for_user" do
    let(:user) { create(:user) }

    # 新着順であることを見るため、作成順は期待する順序と逆にする。
    it "status: :published は自分の公開済みの挑戦を新着順で返す" do
      older = create(:attempt, :published, user: user, created_at: 2.days.ago)
      newer = create(:attempt, :published, user: user, created_at: 1.day.ago)

      expect(Attempt.listing_for_user(user, status: :published).map(&:id)).to eq([ newer.id, older.id ])
    end

    it "status: :draft は下書きだけを返す" do
      draft = create(:attempt, user: user)
      create(:attempt, :published, user: user)

      expect(Attempt.listing_for_user(user, status: :draft).map(&:id)).to eq([ draft.id ])
    end

    it "生成中・失敗はどちらの status でも返さない" do
      create(:attempt, :generating, user: user)
      create(:attempt, :failed, user: user)

      expect(Attempt.listing_for_user(user, status: :published)).to be_empty
      expect(Attempt.listing_for_user(user, status: :draft)).to be_empty
    end

    it "他人の挑戦を含めない" do
      create(:attempt, :published)

      expect(Attempt.listing_for_user(user, status: :published)).to be_empty
    end

    it "削除済みの挑戦を含めない" do
      create(:attempt, :published, user: user).discard!

      expect(Attempt.listing_for_user(user, status: :published)).to be_empty
    end

    # Post#discard は挑戦にカスケードしない。ここで隠すと、片付ける手段
    # （DELETE /api/attempts/:id）に画面から辿り着けなくなる（4-4 案A の前提）。
    it "削除済みのお題にぶら下がる自分の挑戦は含める" do
      post = create(:post)
      attempt = create(:attempt, :published, post: post, user: user)
      post.discard!

      expect(Attempt.listing_for_user(user, status: :published).map(&:id)).to eq([ attempt.id ])
    end

    it "likes_count を持つ" do
      attempt = create(:attempt, :published, user: user)
      create_list(:like, 2, attempt: attempt)

      expect(Attempt.listing_for_user(user, status: :published).first.likes_count).to eq(2)
    end
  end
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `docker compose exec backend bundle exec rspec spec/models/attempt_spec.rb`
Expected: FAIL 7件（`NoMethodError: undefined method 'listing_for_user'`）

- [ ] **Step 3: 最小の実装を書く**

`backend/app/models/attempt.rb` の `self.best_for` の下に追記：

```ruby

  # マイページの「自分の挑戦」「下書き」の組み立て口。listing_for（お題詳細）と対になる。
  #
  # お題は kept で絞らない。Post#discard は挑戦にカスケードしないので、削除済みお題の
  # 下に自分の挑戦が残る。ここで隠すと片付ける手段（DELETE /api/attempts/:id）に
  # 画面から辿り着けなくなる（4-4 案A の前提）。削除済みかどうかは
  # PostSummarySerializer が discarded として返し、フロントが描き分ける。
  #
  # includes(:post) はカードに出すお題サマリのため、includes(:user) は
  # AttemptSerializer が投稿者を出すため（常に本人なので preload は 1 クエリで済む）。
  def self.listing_for_user(user, status:)
    kept.where(user: user, status: status).includes(:user, :post).with_likes_count.recent
  end
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `docker compose exec backend bundle exec rspec spec/models/attempt_spec.rb`
Expected: PASS

- [ ] **Step 5: rubocop を通す**

Run: `docker compose exec backend bundle exec rubocop`
Expected: no offenses

- [ ] **Step 6: コミット**

```bash
git add backend/app/models/attempt.rb backend/spec/models/attempt_spec.rb
git commit -m "feat: マイページの挑戦一覧のスコープ Attempt.listing_for_user を足す"
```

---

## Task 7: `GET /api/me/posts`

**Files:**
- Modify: `backend/config/routes.rb`
- Modify: `backend/app/controllers/api/me_controller.rb`
- Create: `backend/spec/requests/api/me/posts_spec.rb`

**Interfaces:**
- Consumes: `Post.for_listing`（Task 5）／`Paginating#page_param`（Task 1）／既存の `Favorite.favorited_post_ids(user, post_ids)` → `Set`／既存の `PostSerializer.call(post, favorited:)`／既存の `PaginationSerializer.call(relation)`
- Produces: `GET /api/me/posts` → `{ "posts": [...], "meta": {...} }`

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/me/posts_spec.rb`（新規。`spec/requests/api/me/` ディレクトリも作る）:

```ruby
require "rails_helper"

RSpec.describe "GET /api/me/posts", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }

  it "未認証だと 401 を返す" do
    get "/api/me/posts"

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("unauthorized")
  end

  # 新着順であることを見るため、作成順は期待する順序と逆にする。
  it "自分のお題を新着順で返す" do
    older = create(:post, user: user, created_at: 2.days.ago)
    newer = create(:post, user: user, created_at: 1.day.ago)

    get "/api/me/posts", headers: auth_headers(token)

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["posts"].map { |post| post["id"] }).to eq([ newer.id, older.id ])
  end

  it "他人のお題を含めない" do
    create(:post)

    get "/api/me/posts", headers: auth_headers(token)

    expect(response.parsed_body["posts"]).to be_empty
  end

  it "削除済みの自分のお題を含めない" do
    create(:post, user: user).discard!

    get "/api/me/posts", headers: auth_headers(token)

    expect(response.parsed_body["posts"]).to be_empty
    expect(response.parsed_body["meta"]["total_count"]).to eq(0)
  end

  it "1 件も無ければ空配列と total_count 0 を返す" do
    get "/api/me/posts", headers: auth_headers(token)

    expect(response.parsed_body["posts"]).to eq([])
    expect(response.parsed_body["meta"]["total_count"]).to eq(0)
  end

  it "お題一覧と同じ形（attempts_count / likes_count / favorited）で返す" do
    post_record = create(:post, user: user)
    create_list(:like, 2, attempt: create(:attempt, :published, post: post_record))
    create(:favorite, user: user, post: post_record)

    get "/api/me/posts", headers: auth_headers(token)

    item = response.parsed_body["posts"].first
    expect(item["attempts_count"]).to eq(1)
    expect(item["likes_count"]).to eq(2)
    # 自分のお題も 5-2 でお気に入りできるので、ここは本人基準で埋まる。
    expect(item["favorited"]).to be(true)
  end

  it "1 ページ 12 件で、13 件目は 2 ページ目に出る" do
    create_list(:post, 13, user: user)

    get "/api/me/posts", headers: auth_headers(token)
    expect(response.parsed_body["posts"].size).to eq(12)
    expect(response.parsed_body["meta"]).to eq(
      "current_page" => 1, "total_pages" => 2, "total_count" => 13
    )

    get "/api/me/posts", params: { page: 2 }, headers: auth_headers(token)
    expect(response.parsed_body["posts"].size).to eq(1)
    expect(response.parsed_body["meta"]["current_page"]).to eq(2)
  end

  # headers を測定の外で組み立てるのが要点。let(:token) はサインインの
  # リクエストを 1 回打つので、ブロックの中で初めて触るとその分が数に混ざる。
  it "お題が増えてもクエリ数が増えない（N+1 を作り込まない）" do
    headers = auth_headers(token)
    create(:post, user: user)
    with_one = count_select_queries { get "/api/me/posts", headers: headers }

    create_list(:post, 2, user: user)
    with_three = count_select_queries { get "/api/me/posts", headers: headers }

    expect(with_three).to eq(with_one)
  end
end
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `docker compose exec backend bundle exec rspec spec/requests/api/me/posts_spec.rb`
Expected: FAIL（`ActionController::RoutingError: No route matches [GET] "/api/me/posts"`）

- [ ] **Step 3: ルートとアクションを足す**

`backend/config/routes.rb`：`get "me" => "me#show"` の下のコメントを更新しつつ4本足す（`me/attempts` 以降は後続タスクで使う。ここでまとめて足すと未実装のアクションに 500 で当たるので、**この行だけ**足す）：

```ruby
    # ログイン中のユーザー自身の情報とマイページの各タブ（issue 6-3）。
    get "me"       => "me#show"
    get "me/posts" => "me#posts"
```

`backend/app/controllers/api/me_controller.rb`：クラスのコメントと include を整え、`posts` アクションを足す：

```ruby
module Api
  # ログイン中のユーザー自身のデータ。マイページ（7-6）の 4 タブとヘッダーを賄う。
  # 判定と絞り込みはモデルのスコープに寄せ、ここは HTTP の入出力だけを扱う。
  class MeController < ApplicationController
    include Paginating

    before_action :authenticate_user!

    # 「いま誰でログインしているか」と、マイページのヘッダーに出す統計。
    def show
      render json: UserSerializer.private_profile_with_stats(current_user)
    end

    def posts
      posts = current_user.posts.for_listing.recent.page(page_param)
      # 一覧ぶんのお気に入り済み判定を 1 クエリでまとめて引く（1 件ずつ引くと N+1 になる）。
      # 自分のお題もお気に入りできる（5-2）ので、ここは実際に引く必要がある。
      favorited_ids = Favorite.favorited_post_ids(current_user, posts.map(&:id))

      render json: {
        posts: posts.map { |post| PostSerializer.call(post, favorited: favorited_ids.include?(post.id)) },
        meta: PaginationSerializer.call(posts)
      }
    end
  end
end
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `docker compose exec backend bundle exec rspec spec/requests/api/me`
Expected: PASS

- [ ] **Step 5: rubocop を通す**

Run: `docker compose exec backend bundle exec rubocop`
Expected: no offenses

- [ ] **Step 6: コミット**

```bash
git add backend/config/routes.rb backend/app/controllers/api/me_controller.rb backend/spec/requests/api/me/posts_spec.rb
git commit -m "feat: GET /api/me/posts（マイページの投稿タブ）"
```

---

## Task 8: `GET /api/me/attempts` と `PostSummarySerializer`

**Files:**
- Create: `backend/app/serializers/post_summary_serializer.rb`
- Modify: `backend/config/routes.rb`
- Modify: `backend/app/controllers/api/me_controller.rb`
- Create: `backend/spec/requests/api/me/attempts_spec.rb`

**Interfaces:**
- Consumes: `Attempt.listing_for_user(user, status:)`（Task 6）／`AttemptRendering#attempt_list_json(attempt, liked_ids)`（Task 2）／`Paginating#page_param`（Task 1）／既存の `Like.liked_attempt_ids(user, attempt_ids)` → `Set`
- Produces: `PostSummarySerializer.call(post)` → `{ id:, title:, image_public_id:, discarded: }`（Task 9 の `me/drafts` も同じ経路で使う）／`MeController#render_attempts(relation)`（private）／`MeController#my_attempt_json(attempt, liked_ids)`（private）／`GET /api/me/attempts` → `{ "attempts": [...], "meta": {...} }`

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/me/attempts_spec.rb`（新規）:

```ruby
require "rails_helper"

RSpec.describe "GET /api/me/attempts", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }

  it "未認証だと 401 を返す" do
    get "/api/me/attempts"

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("unauthorized")
  end

  # 新着順であることを見るため、作成順は期待する順序と逆にする。
  it "自分の公開済みの挑戦を新着順で返す" do
    older = create(:attempt, :published, user: user, created_at: 2.days.ago)
    newer = create(:attempt, :published, user: user, created_at: 1.day.ago)

    get "/api/me/attempts", headers: auth_headers(token)

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["attempts"].map { |attempt| attempt["id"] }).to eq([ newer.id, older.id ])
  end

  it "下書き・生成中・失敗・削除済みを含めない" do
    create(:attempt, user: user)
    create(:attempt, :generating, user: user)
    create(:attempt, :failed, user: user)
    create(:attempt, :published, user: user).discard!

    get "/api/me/attempts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"]).to be_empty
  end

  it "他人の挑戦を含めない" do
    create(:attempt, :published)

    get "/api/me/attempts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"]).to be_empty
  end

  it "1 件も無ければ空配列と total_count 0 を返す" do
    get "/api/me/attempts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"]).to eq([])
    expect(response.parsed_body["meta"]["total_count"]).to eq(0)
  end

  it "挑戦カードに、どのお題への挑戦かのサマリが入る" do
    post_record = create(:post, title: "夕暮れの商店街")
    create(:attempt, :published, post: post_record, user: user)

    get "/api/me/attempts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"].first["post"]).to eq(
      "id" => post_record.id,
      "title" => "夕暮れの商店街",
      "image_public_id" => post_record.image_public_id,
      "discarded" => false
    )
  end

  # Post#discard は挑戦にカスケードしない。片付ける手段（DELETE /api/attempts/:id）に
  # 画面から辿り着けるよう、出したうえで discarded で描き分けさせる（4-4 案A の前提）。
  it "削除済みのお題にぶら下がる挑戦も返り、post.discarded が true になる" do
    post_record = create(:post)
    create(:attempt, :published, post: post_record, user: user)
    post_record.discard!

    get "/api/me/attempts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"].size).to eq(1)
    expect(response.parsed_body["attempts"].first["post"]["discarded"]).to be(true)
  end

  it "likes_count と liked を返す" do
    create_list(:like, 2, attempt: create(:attempt, :published, user: user))

    get "/api/me/attempts", headers: auth_headers(token)

    item = response.parsed_body["attempts"].first
    expect(item["likes_count"]).to eq(2)
    # 自分の挑戦にはいいねできない（5-1）ので false になる。
    expect(item["liked"]).to be(false)
  end

  it "1 ページ 12 件で、13 件目は 2 ページ目に出る" do
    create_list(:attempt, 13, :published, user: user)

    get "/api/me/attempts", headers: auth_headers(token)
    expect(response.parsed_body["attempts"].size).to eq(12)
    expect(response.parsed_body["meta"]).to eq(
      "current_page" => 1, "total_pages" => 2, "total_count" => 13
    )

    get "/api/me/attempts", params: { page: 2 }, headers: auth_headers(token)
    expect(response.parsed_body["attempts"].size).to eq(1)
    expect(response.parsed_body["meta"]["current_page"]).to eq(2)
  end

  # headers を測定の外で組み立てるのが要点。let(:token) はサインインの
  # リクエストを 1 回打つので、ブロックの中で初めて触るとその分が数に混ざる。
  it "挑戦が増えてもクエリ数が増えない（post サマリと liked で N+1 を作り込まない）" do
    headers = auth_headers(token)
    create(:attempt, :published, user: user)
    with_one = count_select_queries { get "/api/me/attempts", headers: headers }

    create_list(:attempt, 2, :published, user: user)
    with_three = count_select_queries { get "/api/me/attempts", headers: headers }

    expect(with_three).to eq(with_one)
  end
end
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `docker compose exec backend bundle exec rspec spec/requests/api/me/attempts_spec.rb`
Expected: FAIL（`ActionController::RoutingError: No route matches [GET] "/api/me/attempts"`）

- [ ] **Step 3: シリアライザ・ルート・アクションを足す**

`backend/app/serializers/post_summary_serializer.rb`（新規）:

> **実行後の追記**：レビュー指摘により、実際に入ったものは下のスケッチと違い、`discarded` が `true` のとき `title` と `image_public_id` を `nil` にする。正は設計書の「ただし削除済みのお題は、タイトルと画像を伏せる」節。

```ruby
# 挑戦アイテムに添える「どのお題への挑戦か」の最小表現。マイページの
# 「自分の挑戦」「下書き」カードが使う（サムネイル・タイトル・リンク先）。
#
# PostSerializer と違い、集計（attempts_count / likes_count）も favorited も持たない。
# カードが使わないうえ、preload した Post には with_counts が SELECT 句で付ける
# 別名属性が乗っていないため（取り直すと 2 クエリ増える）。
#
# discarded を持つのはこの表現だけ。マイページは削除済みのお題にぶら下がる自分の挑戦も
# 出すので（4-4 案A：片付ける手段を残す）、フロントが描き分けるのに要る。公開 API の
# お題一覧・詳細には削除済みが出てこないので、PostSerializer 側には足さない。
class PostSummarySerializer
  def self.call(post)
    {
      id: post.id,
      title: post.title,
      image_public_id: post.image_public_id,
      discarded: post.discarded?
    }
  end
end
```

`backend/config/routes.rb`：`get "me/posts" => "me#posts"` の下に足す：

```ruby
    get "me/attempts" => "me#attempts"
```

`backend/app/controllers/api/me_controller.rb`：`include Paginating` の上に `include AttemptRendering` を足し、`posts` の下にアクション、末尾に private メソッド2つを足す：

```ruby
    include AttemptRendering
    include Paginating
```

```ruby
    def attempts = render_attempts(Attempt.listing_for_user(current_user, status: :published))
```

```ruby
    private

    def render_attempts(relation)
      attempts = relation.page(page_param)
      # 一覧ぶんのいいね済み判定を 1 クエリでまとめて引く（1 件ずつ引くと N+1 になる）。
      #
      # 自分の挑戦にはいいねできない（5-1）ので実質いつも空集合が返るが、false を
      # 直接埋めない。それは別 issue のルールに寄りかかった推論で、5-5 でいいねの
      # 可視化を検討するときに黙って嘘になる（設計書参照）。
      liked_ids = Like.liked_attempt_ids(current_user, attempts.map(&:id))

      render json: {
        attempts: attempts.map { |attempt| my_attempt_json(attempt, liked_ids) },
        meta: PaginationSerializer.call(attempts)
      }
    end

    # マイページの挑戦カードは「どのお題への挑戦か」が要る。AttemptSerializer は変えず、
    # 呼び出し側で最小サマリを足す（お題詳細の挑戦一覧では post が自明なので付けない）。
    def my_attempt_json(attempt, liked_ids)
      attempt_list_json(attempt, liked_ids).merge(post: PostSummarySerializer.call(attempt.post))
    end
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `docker compose exec backend bundle exec rspec spec/requests/api/me`
Expected: PASS

- [ ] **Step 5: rubocop を通す**

Run: `docker compose exec backend bundle exec rubocop`
Expected: no offenses

- [ ] **Step 6: コミット**

```bash
git add backend/app/serializers/post_summary_serializer.rb backend/config/routes.rb backend/app/controllers/api/me_controller.rb backend/spec/requests/api/me/attempts_spec.rb
git commit -m "feat: GET /api/me/attempts（マイページの挑戦タブ）"
```

---

## Task 9: `GET /api/me/drafts`

**Files:**
- Modify: `backend/config/routes.rb`
- Modify: `backend/app/controllers/api/me_controller.rb`
- Create: `backend/spec/requests/api/me/drafts_spec.rb`

**Interfaces:**
- Consumes: `Attempt.listing_for_user(user, status:)`（Task 6）／`MeController#render_attempts`（Task 8）
- Produces: `GET /api/me/drafts` → `{ "attempts": [...], "meta": {...} }`（**キーは `drafts` ではなく `attempts`**。要素の形が `me/attempts` と同一で、フロントが型とレンダラを二重に持たずに済むため）

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/me/drafts_spec.rb`（新規）:

```ruby
require "rails_helper"

RSpec.describe "GET /api/me/drafts", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }

  it "未認証だと 401 を返す" do
    get "/api/me/drafts"

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("unauthorized")
  end

  # 下書きも Attempt なので応答キーは attempts のまま。URL だけを分ける（設計書参照）。
  # 新着順であることを見るため、作成順は期待する順序と逆にする。
  it "自分の下書きを attempts キーに新着順で返す" do
    older = create(:attempt, user: user, created_at: 2.days.ago)
    newer = create(:attempt, user: user, created_at: 1.day.ago)

    get "/api/me/drafts", headers: auth_headers(token)

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["attempts"].map { |attempt| attempt["id"] }).to eq([ newer.id, older.id ])
  end

  it "公開済み・生成中・失敗・削除済みを含めない" do
    create(:attempt, :published, user: user)
    create(:attempt, :generating, user: user)
    create(:attempt, :failed, user: user)
    create(:attempt, user: user).discard!

    get "/api/me/drafts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"]).to be_empty
  end

  it "他人の下書きを含めない" do
    create(:attempt)

    get "/api/me/drafts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"]).to be_empty
  end

  it "1 件も無ければ空配列と total_count 0 を返す" do
    get "/api/me/drafts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"]).to eq([])
    expect(response.parsed_body["meta"]["total_count"]).to eq(0)
  end

  # ブリーフの下書きタブは「お題サムネイル＋描写文」を出す。
  it "下書きカードに描写文とお題サマリが入る" do
    post_record = create(:post, title: "夕暮れの商店街")
    create(:attempt, post: post_record, user: user, description: "赤い提灯が並ぶ路地")

    get "/api/me/drafts", headers: auth_headers(token)

    item = response.parsed_body["attempts"].first
    expect(item["status"]).to eq("draft")
    expect(item["description"]).to eq("赤い提灯が並ぶ路地")
    expect(item["post"]).to eq(
      "id" => post_record.id,
      "title" => "夕暮れの商店街",
      "image_public_id" => post_record.image_public_id,
      "discarded" => false
    )
  end

  # 削除済みお題の下書きこそ、片付ける手段（DELETE /api/attempts/:id）に
  # 辿り着ける必要がある（4-4 案A の前提）。
  it "削除済みのお題にぶら下がる下書きも返り、post.discarded が true になる" do
    post_record = create(:post)
    create(:attempt, post: post_record, user: user)
    post_record.discard!

    get "/api/me/drafts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"].size).to eq(1)
    expect(response.parsed_body["attempts"].first["post"]["discarded"]).to be(true)
  end

  it "1 ページ 12 件で、13 件目は 2 ページ目に出る" do
    create_list(:attempt, 13, user: user)

    get "/api/me/drafts", headers: auth_headers(token)
    expect(response.parsed_body["attempts"].size).to eq(12)
    expect(response.parsed_body["meta"]).to eq(
      "current_page" => 1, "total_pages" => 2, "total_count" => 13
    )

    get "/api/me/drafts", params: { page: 2 }, headers: auth_headers(token)
    expect(response.parsed_body["attempts"].size).to eq(1)
    expect(response.parsed_body["meta"]["current_page"]).to eq(2)
  end

  # headers を測定の外で組み立てるのが要点（me/attempts と同じ理由）。
  it "下書きが増えてもクエリ数が増えない（N+1 を作り込まない）" do
    headers = auth_headers(token)
    create(:attempt, user: user)
    with_one = count_select_queries { get "/api/me/drafts", headers: headers }

    create_list(:attempt, 2, user: user)
    with_three = count_select_queries { get "/api/me/drafts", headers: headers }

    expect(with_three).to eq(with_one)
  end
end
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `docker compose exec backend bundle exec rspec spec/requests/api/me/drafts_spec.rb`
Expected: FAIL（`ActionController::RoutingError: No route matches [GET] "/api/me/drafts"`）

- [ ] **Step 3: ルートとアクションを足す**

`backend/config/routes.rb`：`get "me/attempts" => "me#attempts"` の下に足す：

```ruby
    get "me/drafts" => "me#drafts"
```

`backend/app/controllers/api/me_controller.rb`：`attempts` の下に足す：

```ruby

    # 下書きも Attempt なので応答キーは attempts のまま。URL だけを分ける。
    def drafts = render_attempts(Attempt.listing_for_user(current_user, status: :draft))
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `docker compose exec backend bundle exec rspec spec/requests/api/me`
Expected: PASS

- [ ] **Step 5: rubocop を通す**

Run: `docker compose exec backend bundle exec rubocop`
Expected: no offenses

- [ ] **Step 6: コミット**

```bash
git add backend/config/routes.rb backend/app/controllers/api/me_controller.rb backend/spec/requests/api/me/drafts_spec.rb
git commit -m "feat: GET /api/me/drafts（マイページの下書きタブ）"
```

---

## Task 10: `GET /api/me/favorites`

**Files:**
- Modify: `backend/config/routes.rb`
- Modify: `backend/app/controllers/api/me_controller.rb`
- Create: `backend/spec/requests/api/me/favorites_spec.rb`

**Interfaces:**
- Consumes: `Post.favorited_by(user)`（Task 5）／`Paginating#page_param`（Task 1）／既存の `PostSerializer.call(post, favorited:)`
- Produces: `GET /api/me/favorites` → `{ "posts": [...], "meta": {...} }`（`favorited` は常に `true`）

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/me/favorites_spec.rb`（新規）:

```ruby
require "rails_helper"

RSpec.describe "GET /api/me/favorites", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }

  it "未認証だと 401 を返す" do
    get "/api/me/favorites"

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("unauthorized")
  end

  # 「お気に入りした順」であることを見るため、お題の作成順は期待する順序と逆にする。
  # 揃えると、並び替えを消して新着順のままでも通ってしまう。
  it "お気に入りした新しい順に返る" do
    older_post = create(:post, created_at: 1.day.ago)
    newer_post = create(:post, created_at: 2.days.ago)
    create(:favorite, user: user, post: older_post, created_at: 2.days.ago)
    create(:favorite, user: user, post: newer_post, created_at: 1.day.ago)

    get "/api/me/favorites", headers: auth_headers(token)

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["posts"].map { |post| post["id"] }).to eq([ newer_post.id, older_post.id ])
  end

  it "お気に入りしていないお題を含めない" do
    create(:post)

    get "/api/me/favorites", headers: auth_headers(token)

    expect(response.parsed_body["posts"]).to be_empty
  end

  it "他人のお気に入りを含めない" do
    create(:favorite, post: create(:post))

    get "/api/me/favorites", headers: auth_headers(token)

    expect(response.parsed_body["posts"]).to be_empty
  end

  # 5-2 が削除済みお題への解除を 404 にしているので、出すと必ず 404 を返す
  # 解除ボタンが画面に並ぶ（設計書参照）。挑戦タブと扱いが逆になるのは、
  # 片付ける手段が残っているかどうかが逆だから。
  it "削除済みのお題を含めない" do
    post_record = create(:post)
    create(:favorite, user: user, post: post_record)
    post_record.discard!

    get "/api/me/favorites", headers: auth_headers(token)

    expect(response.parsed_body["posts"]).to be_empty
    expect(response.parsed_body["meta"]["total_count"]).to eq(0)
  end

  it "お気に入りを解除すると消える" do
    post_record = create(:post)
    create(:favorite, user: user, post: post_record)

    delete "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token)
    expect(response).to have_http_status(:ok)

    get "/api/me/favorites", headers: auth_headers(token)

    expect(response.parsed_body["posts"]).to be_empty
  end

  it "1 件も無ければ空配列と total_count 0 を返す" do
    get "/api/me/favorites", headers: auth_headers(token)

    expect(response.parsed_body["posts"]).to eq([])
    expect(response.parsed_body["meta"]["total_count"]).to eq(0)
  end

  it "お題一覧と同じ形で返し、favorited は常に true" do
    post_record = create(:post)
    create(:favorite, user: user, post: post_record)
    create_list(:like, 2, attempt: create(:attempt, :published, post: post_record))

    get "/api/me/favorites", headers: auth_headers(token)

    item = response.parsed_body["posts"].first
    expect(item["attempts_count"]).to eq(1)
    expect(item["likes_count"]).to eq(2)
    expect(item["favorited"]).to be(true)
  end

  it "1 ページ 12 件で、13 件目は 2 ページ目に出る" do
    create_list(:post, 13).each { |post_record| create(:favorite, user: user, post: post_record) }

    get "/api/me/favorites", headers: auth_headers(token)
    expect(response.parsed_body["posts"].size).to eq(12)
    expect(response.parsed_body["meta"]).to eq(
      "current_page" => 1, "total_pages" => 2, "total_count" => 13
    )

    get "/api/me/favorites", params: { page: 2 }, headers: auth_headers(token)
    expect(response.parsed_body["posts"].size).to eq(1)
    expect(response.parsed_body["meta"]["current_page"]).to eq(2)
  end

  # headers を測定の外で組み立てるのが要点（me/posts と同じ理由）。
  it "お気に入りが増えてもクエリ数が増えない（N+1 を作り込まない）" do
    headers = auth_headers(token)
    create(:favorite, user: user, post: create(:post))
    with_one = count_select_queries { get "/api/me/favorites", headers: headers }

    create_list(:post, 2).each { |post_record| create(:favorite, user: user, post: post_record) }
    with_three = count_select_queries { get "/api/me/favorites", headers: headers }

    expect(with_three).to eq(with_one)
  end
end
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `docker compose exec backend bundle exec rspec spec/requests/api/me/favorites_spec.rb`
Expected: FAIL（`ActionController::RoutingError: No route matches [GET] "/api/me/favorites"`）

- [ ] **Step 3: ルートとアクションを足す**

`backend/config/routes.rb`：`get "me/drafts" => "me#drafts"` の下に足す：

```ruby
    get "me/favorites" => "me#favorites"
```

`backend/app/controllers/api/me_controller.rb`：`drafts` の下（`private` の上）に足す：

```ruby

    def favorites
      posts = Post.favorited_by(current_user).page(page_param)

      render json: {
        # この一覧に載っている時点でお気に入り済みなので、判定クエリは引かない。
        # me/attempts の liked と違い、行の存在そのものが根拠になる（設計書参照）。
        posts: posts.map { |post| PostSerializer.call(post, favorited: true) },
        meta: PaginationSerializer.call(posts)
      }
    end
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `docker compose exec backend bundle exec rspec spec/requests/api/me`
Expected: PASS

- [ ] **Step 5: スイート全体と rubocop を通す**

Run: `docker compose exec backend bundle exec rspec`
Expected: PASS（全件）

Run: `docker compose exec backend bundle exec rubocop`
Expected: no offenses

- [ ] **Step 6: コミット**

```bash
git add backend/config/routes.rb backend/app/controllers/api/me_controller.rb backend/spec/requests/api/me/favorites_spec.rb
git commit -m "feat: GET /api/me/favorites（マイページのお気に入りタブ）"
```

---

## Task 11: 動作確認（ローカル）とドキュメント反映

**Files:**
- Modify: `docs/issues_backlog.md`（6-3 の節）
- Modify: `docs/screen_and_api_design.md`（「ランキング・マイページ・通報」の表と補足）

**Interfaces:**
- Consumes: Task 4・7〜10 で実装したエンドポイント
- Produces: なし（ドキュメントのみ）

CLAUDE.md の「① issue を実装するたび：ローカルでブラウザから動作確認 ＋ 該当する RSpec を回す」に沿う。フロントはまだ無いので `curl` で確認する。

- [ ] **Step 1: 開発コンテナで実際に叩いて確認する**

```bash
docker compose up -d
docker compose exec backend bin/rails db:migrate
```

サインインしてトークンを取り、4本を叩く（ユーザーが無ければ `POST /api/auth/sign_up` で作る）：

```bash
TOKEN=$(curl -si -X POST http://localhost:3000/api/auth/sign_in \
  -H "Content-Type: application/json" \
  -d '{"user":{"email":"me@example.com","password":"password123"}}' \
  | grep -i "^authorization:" | sed "s/^[Aa]uthorization: //" | tr -d "\r")

for path in me me/posts me/attempts me/drafts me/favorites; do
  echo "--- /api/$path"
  curl -s -H "Authorization: $TOKEN" "http://localhost:3000/api/$path"
  echo
done
```

Expected: `/api/me` が `stats` を含む JSON を返し、4本が `200` で `posts` または `attempts` と `meta` を返す。未認証（`-H` を外す）だと `{"error":"unauthorized"}` が返る。

- [ ] **Step 2: `docs/issues_backlog.md` の 6-3 を更新する**

「### 🟢 6-3. マイページ API」の節の、既存の `**制約：me/favorites は Post.kept で絞る**` の段落の下に補足を足す（既存の行は消さない）：

```markdown
- **補足：`me/attempts` / `me/drafts` は逆に `Post.kept` で絞らない**。`Post#discard` は挑戦に
  カスケードしないので、削除済みお題の下に自分の挑戦が残る。4-4 の推奨案（案A）は
  「`DELETE` は許可して、お題が消えたあとも自分の下書きを片付けられるようにする」なので、
  ここで隠すとその前提が成立しない。削除済みかどうかは挑戦に添える `post` サマリの
  `discarded` で返し、フロントが描き分ける。**お気に入りと扱いが逆になるのは、片付ける
  手段が残っているかどうかが逆だから**（お気に入りの解除は 5-2 が 404 にしている）。
- **補足：プロフィールヘッダーの統計は `GET /api/me` に足す**（`stats`）。獲得いいね合計は
  4本の一覧からは導けない（1ページ12件ぶんの `likes_count` しか返らない）ため。
  `posts_count` / `attempts_count` は対応するタブの `meta.total_count` と一致する定義にする。
- 補足：`me/drafts` の応答キーは `drafts` ではなく **`attempts`**。下書きは `status` が
  `draft` の Attempt であって別リソースではなく、要素の形も同じなので、キーを変えると
  フロントが型とレンダラを二重に持つことになる。
- 補足：`me/favorites` の並びは**お気に入りした新しい順**（お題の新着順にすると、古いお題を
  今お気に入りしても奥に埋もれる）。他の3本は新着順。
- 設計書：`docs/superpowers/specs/2026-08-23-issue-6-3-mypage-api-design.md`
```

- [ ] **Step 3: `docs/screen_and_api_design.md` を更新する**

「### ランキング・マイページ・通報」の表のうち、マイページの4行を応答が分かる形に書き換える（`GET /api/rankings` と `POST /api/attempts/:id/report` の行はそのまま）：

```markdown
| GET | `/api/me/posts` | 自分の投稿一覧（`kept`・新着順・12件/頁） | マイページ |
| GET | `/api/me/attempts` | 自分の公開済み挑戦一覧（`status: published`・新着順・12件/頁） | マイページ |
| GET | `/api/me/drafts` | 自分の下書き一覧（`status: draft`／保存したプロンプト・新着順・12件/頁） | マイページ |
| GET | `/api/me/favorites` | お気に入り一覧（`Post.kept` のみ・お気に入りした新しい順・12件/頁） | マイページ |
```

表の下に補足を足す：

```markdown
- 4本とも**要ログイン**。`meta` は他の一覧と同じ形（`current_page` / `total_pages` / `total_count`）。
- `me/posts` と `me/favorites` の要素は**お題一覧と同じ形**（`favorited` を含む）。
  `me/favorites` の `favorited` は定義上つねに `true`。
- `me/attempts` と `me/drafts` の要素は**挑戦一覧と同じ形に `post` を 1 つ足した形**。
  `post` は `{ id, title, image_public_id, discarded }` の最小サマリで、集計も `favorited` も持たない。
  応答キーはどちらも `attempts`（下書きは `status` が `draft` の Attempt なので形が同じ）。
- **`me/attempts` / `me/drafts` は削除済みのお題にぶら下がる自分の挑戦も返す**（`post.discarded`
  が `true` になる）。`Post#discard` は挑戦にカスケードせず、片付ける手段（`DELETE /api/attempts/:id`）
  を画面に残すため（4-4 案A）。`me/favorites` だけは逆に `Post.kept` で絞る（解除の口が 5-2 で
  404 になっており、出すと必ず失敗するボタンが並ぶため）。
- `GET /api/me` は `id` / `name` / `email` に加えて `stats`
  （`posts_count` / `attempts_count` / `likes_received_count`）を返す。マイページのヘッダー用。
  `posts_count` は `me/posts`、`attempts_count` は `me/attempts` の `meta.total_count` と一致する。
  `POST /api/auth/sign_up` と `POST /api/auth/sign_in` の応答には `stats` を**含めない**。
```

- [ ] **Step 4: スイート全体と rubocop を最終確認する**

Run: `docker compose exec backend bundle exec rspec`
Expected: PASS（全件）

Run: `docker compose exec backend bundle exec rubocop`
Expected: no offenses

- [ ] **Step 5: コミット**

```bash
git add docs/issues_backlog.md docs/screen_and_api_design.md
git commit -m "docs: マイページ API（issue 6-3）の決定事項と公開仕様を反映する"
```

---

## Task 12: レビューと PR

**Files:** なし（レビューと PR 作成）

- [ ] **Step 1: `/code-review` を通す**

プッシュ前に独立レビューを挟む（過去に自己レビュー1件に対して独立レビューが9件出た前例がある）。指摘は `superpowers:receiving-code-review` の作法で扱う（鵜呑みにせず、根拠を確認してから直す）。

- [ ] **Step 2: 指摘を反映してから再度スイートを回す**

Run: `docker compose exec backend bundle exec rspec`
Expected: PASS（全件）

Run: `docker compose exec backend bundle exec rubocop`
Expected: no offenses

- [ ] **Step 3: プッシュして PR を作る**

プッシュは本番に影響しない（Render は main 追跡・PR プレビュー無効）。**PR 本文に `Closes #21` を必ず書く**（issue テンプレに明記があるのに 2 回続けて忘れた前例がある）。

```bash
git push -u origin feat/issue-6-3-mypage-api
gh pr create --title "feat: マイページ API（issue 6-3）" --body "$(cat <<'EOF'
## 概要
マイページ（7-6）の4タブとプロフィールヘッダーが必要とするデータを返す API。

Closes #21

## 変更点
- `GET /api/me/posts` / `me/attempts` / `me/drafts` / `me/favorites` の4本（要ログイン・12件/頁）
- `GET /api/me` に `stats`（投稿数・公開済み挑戦数・獲得いいね合計）を追加。sign_up / sign_in の応答は据え置き
- `PostSummarySerializer` を新設（挑戦カードに添えるお題の最小表現。`discarded` を持つ）
- リファクタ：`page_param` を `Paginating` に、`attempt_list_json` を `AttemptRendering` に切り出し（6-1 の申し送りどおり）

## 決めたこと
- `me/attempts` / `me/drafts` は削除済みのお題にぶら下がる挑戦も返す（4-4 案A が `DELETE` を残す前提のため）。`me/favorites` だけは `Post.kept` で絞る（解除の口が 5-2 で 404 のため）
- `me/drafts` の応答キーは `attempts`（要素の形が同一のため）
- `me/favorites` の並びはお気に入りした新しい順
- `me/favorites` の `favorited` は行の存在が根拠なので `true` を直接入れる。`me/attempts` の `liked` は 5-1 のルールに寄りかからず実際に引く

設計書：`docs/superpowers/specs/2026-08-23-issue-6-3-mypage-api-design.md`

## テスト
- model spec：`User` の統計3メソッド、`Post.favorited_by`、`Attempt.listing_for_user`
- request spec：4本ぶん（未認証・絞り込み・並び順・ページング・空状態・N+1）＋ `/api/me` の `stats`
- `bundle exec rspec` / `bundle exec rubocop` 通過

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## 完了条件（PR マージ前のチェック）

- [ ] マイページ4タブぶんのデータが取得できる（4本とも認証必須・ページング付き・空状態あり）
- [ ] `GET /api/me` が `stats` を返し、`posts_count` / `attempts_count` が対応するタブの `meta.total_count` と一致する
- [ ] `me/favorites` に削除済みのお題が出ない
- [ ] `me/attempts` / `me/drafts` に削除済みのお題にぶら下がる自分の挑戦が出て、`post.discarded` が `true` になる
- [ ] 件数を増やしてもクエリ本数が変わらない（4本すべてに N+1 検査）
- [ ] `bundle exec rubocop` と `bundle exec rspec` が green
- [ ] CI（GitHub Actions）が green
- [ ] PR 本文に `Closes #21` がある
