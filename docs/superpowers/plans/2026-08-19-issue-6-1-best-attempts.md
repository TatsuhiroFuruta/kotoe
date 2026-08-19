# お題ごとのベスト再現（issue 6-1）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** お題詳細 `GET /api/posts/:id` に、挑戦の再現度（いいね）順の並び替え（`?sort=likes`）と、`sort` / `page` によらず常にいいね上位3件を返す `best_attempts` フィールドを足す。

**Architecture:** モデル層に `Attempt.popular`（いいね降順）と `Attempt.best_for(post)`（いいね順の先頭3件）を足し、既存の `Attempt.listing_for` にキーワード引数 `sort:` を追加して並び替えの分岐を1か所に閉じる。`PostsController#show` はその2つを呼び、いいね済み判定は表彰台と一覧の id を束ねて `Like.liked_attempt_ids` を1回だけ呼ぶ。マイグレーション無し、新規ファイル無し、DB 変更無し。

**Tech Stack:** Ruby on Rails 8（API モード）、RSpec、FactoryBot、shoulda-matchers、kaminari、discard、PostgreSQL

**Spec:** `docs/superpowers/specs/2026-08-19-issue-6-1-best-attempts-design.md`

## Global Constraints

- **ブランチ**：`feat/issue-6-1-best-attempts`（作成済み・設計書のコミット `d4886fe` が乗っている）。main へ直接コミットしない。
- **文字列はダブルクォート**。spec ファイルも含めプロジェクト全体で統一（`rubocop-rails-omakase`）。
- **配列リテラルは内側にスペース**：`[ many.id, few.id ]`（rails-omakase の `Layout/SpaceInsideArrayLiteralBrackets`）。
- **コマンドはすべて Docker 経由**。プロジェクトルート（`/Users/tatsuhirofuruta/workspace/projects/kotoe`）から実行する：
  - `docker compose exec backend bundle exec rspec`
  - `docker compose exec backend bundle exec rubocop`
- **公開クエリの値は `sort=likes`**（お題一覧の `sort=popular` とは不揃い。`docs/screen_and_api_design.md` がそう定義している）。内部のスコープ名は `Attempt.popular` にして `Post.popular` と対称にする。
- **未知の `sort` は新着順にフォールバック**。エラーにしない（`Post.listing` と同じ扱い）。
- **`likes_count` は SELECT 句の相関サブクエリの別名**。`with_likes_count` を通っていない `Attempt` を `AttemptSerializer` に渡すと `ActiveModel::MissingAttributeError` になる。並び替えも `listing_for` / `best_for` 経由でのみ行う。
- **カウンタキャッシュ列（`attempts.likes_count`）は足さない**。インデックスも足さない（設計書「集計ソート用のインデックスは足さない」参照）。
- **`AttemptSerializer` は変更しない**。`rank` フィールドは足さない。
- 各タスクの最後に `bundle exec rubocop` と `bundle exec rspec` を通してからコミットする。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `backend/app/models/attempt.rb` | **変更**。`BEST_LIMIT` 定数、`popular` スコープ、`listing_for(post, sort:)`、`best_for(post)` |
| `backend/app/controllers/api/posts_controller.rb` | **変更**。`show` が `sort` を通し、`best_attempts` を返す |
| `backend/spec/models/attempt_spec.rb` | **変更**。`.listing_for` の sort、`.best_for` の describe を追記 |
| `backend/spec/requests/api/posts_spec.rb` | **変更**。`GET /api/posts/:id` に `sort=likes` と `best_attempts` を追記 |
| `docs/issues_backlog.md` | **変更**。6-1 を完了に、3-2 の「6-1 に委譲」を解消 |
| `docs/screen_and_api_design.md` | **変更**。`GET /api/posts/:id` の行に `best_attempts` と `sort=likes` を明記 |

新規ファイルは無い。`app/` に新ディレクトリを作らないので、コンテナの restart は不要。

---

### Task 1: `Attempt.popular` と `listing_for(post, sort:)`

挑戦をいいねの多い順に並べる。`Post.popular` / `Post.listing` とまったく同じ形にする。以降のすべてのタスクがこれに依存する。

**Files:**
- Modify: `backend/app/models/attempt.rb:37-43`（`recent` スコープの直後と `listing_for`）
- Test: `backend/spec/models/attempt_spec.rb:58-92`（既存の `describe ".listing_for"` に追記）

**Interfaces:**
- Consumes: `Attempt.with_likes_count`（SELECT 句に `likes_count` の別名を付ける既存スコープ）、`Attempt.recent`、`Attempt.kept`、`Attempt.published`
- Produces:
  - `Attempt.popular -> ActiveRecord::Relation` … `likes_count DESC, created_at DESC, id DESC`。`with_likes_count` を通した relation にのみ使える
  - `Attempt.listing_for(post, sort: nil) -> ActiveRecord::Relation` … `sort` が `"likes"` なら `popular`、それ以外は `recent`。既存の `listing_for(post)` の呼び出しは既定値 `nil` で今までどおり新着順

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/models/attempt_spec.rb` の `describe ".listing_for"` ブロック内、最後の `it "likes_count を持つ"` の直後（91行目 `end` の後）に追記する。

```ruby
    # いいねの多い挑戦をわざと「古い」ほうに置く。こうしないと新着順でも同じ並びになり、
    # popular を実装しなくてもテストが通ってしまう。
    it "sort: \"likes\" でいいねの多い順に並ぶ" do
      many = create(:attempt, :published, post: post, created_at: 2.days.ago)
      few = create(:attempt, :published, post: post, created_at: 1.day.ago)
      create_list(:like, 3, attempt: many)
      create(:like, attempt: few)

      expect(Attempt.listing_for(post, sort: "likes").map(&:id)).to eq([ many.id, few.id ])
    end

    # 同着で順序が不定になると、ページをまたいで重複や抜けが出る（Post.popular と同じ理由）。
    it "sort: \"likes\" の同着は新着順、created_at も同着なら id の降順" do
      old = create(:attempt, :published, post: post, created_at: 2.days.ago)
      same_a = create(:attempt, :published, post: post, created_at: 1.day.ago)
      same_b = create(:attempt, :published, post: post, created_at: 1.day.ago)

      expect(Attempt.listing_for(post, sort: "likes").map(&:id)).to eq([ same_b.id, same_a.id, old.id ])
    end

    it "未知の sort は新着順にフォールバックする" do
      old_and_popular = create(:attempt, :published, post: post, created_at: 2.days.ago)
      newer = create(:attempt, :published, post: post, created_at: 1.day.ago)
      create_list(:like, 3, attempt: old_and_popular)

      expect(Attempt.listing_for(post, sort: "nonsense").map(&:id)).to eq([ newer.id, old_and_popular.id ])
    end
```

- [ ] **Step 2: テストが落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/models/attempt_spec.rb -e ".listing_for"
```

期待：追加した3本が `ArgumentError: unknown keyword: :sort` で落ちる。既存の5本は green のまま。

`ArgumentError` 以外（`NoMethodError` や構文エラー）で落ちたら、テストの書き間違いなので直してから進む。

- [ ] **Step 3: 最小の実装を書く**

`backend/app/models/attempt.rb` の `scope :recent` の直後に `popular` を足し、`listing_for` を差し替える。

```ruby
  # 同着の順序を一意に定める（Post.recent と同じ理由）。
  scope :recent, -> { order(created_at: :desc, id: :desc) }

  # likes_count は with_likes_count が SELECT 句で付ける別名。単体では使えないので
  # 必ず listing_for / best_for 経由で呼ぶこと（Post.popular と同じ理由・同じ形）。
  scope :popular, -> { order(Arel.sql("likes_count DESC")).order(created_at: :desc, id: :desc) }

  # お題詳細に出す挑戦の組み立て口。他人の下書きを見せないのがここの要点。
  #
  # 公開クエリの値は "likes"（お題一覧の "popular" と不揃いだが
  # docs/screen_and_api_design.md がそう定義している）。翻訳はここ1か所で行う。
  # 未知の値は Post.listing と同じくエラーにせず新着順に落とす。
  def self.listing_for(post, sort: nil)
    relation = kept.published.where(post: post).includes(:user).with_likes_count

    sort == "likes" ? relation.popular : relation.recent
  end
```

`Arel.sql` は必須。素の文字列を `order` に渡すと Rails 8 の `ActiveRecord::UnknownAttributeReference` で落ちる。

- [ ] **Step 4: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/models/attempt_spec.rb
```

期待：`.listing_for` の8本すべてを含め、ファイル全体が green。警告・エラー出力なし。

- [ ] **Step 5: rubocop を通してコミットする**

```bash
docker compose exec backend bundle exec rubocop app/models/attempt.rb spec/models/attempt_spec.rb
```

```bash
git add backend/app/models/attempt.rb backend/spec/models/attempt_spec.rb
git commit -m "$(cat <<'EOF'
feat: 挑戦をいいね順に並べる Attempt.popular を足す（issue 6-1）

listing_for に sort: キーワードを足し、"likes" のときだけ popular を使う。
公開クエリの値（likes）とスコープ名（popular）の翻訳はここ1か所に閉じる。
未知の値は Post.listing と同じく新着順にフォールバックする。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `Attempt.best_for`

「ベスト再現＝いいね順の先頭3件」の定義を1か所に閉じる。`listing_for(post, sort: "likes")` に `limit` を掛けるだけにすることで、`best_attempts` と `attempts?sort=likes` の並び順が定義上ずれない。

**Files:**
- Modify: `backend/app/models/attempt.rb`（`BEST_LIMIT` 定数と `best_for`）
- Test: `backend/spec/models/attempt_spec.rb`（`describe ".listing_for"` の直後に `describe ".best_for"` を新設）

**Interfaces:**
- Consumes: `Attempt.listing_for(post, sort:)`（Task 1）
- Produces:
  - `Attempt::BEST_LIMIT = 3`
  - `Attempt.best_for(post) -> ActiveRecord::Relation` … いいね降順の先頭 `BEST_LIMIT` 件。下書き・削除済み・他のお題の挑戦は含まない（`listing_for` 経由のため）

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/models/attempt_spec.rb` の `describe ".listing_for" do ... end` の閉じ `end` の直後（`RSpec.describe Attempt` ブロックの中）に追記する。

```ruby
  describe ".best_for" do
    let(:post) { create(:post) }

    it "いいねの多い順に BEST_LIMIT 件まで返す" do
      attempts = create_list(:attempt, 4, :published, post: post)
      attempts.each_with_index { |attempt, index| create_list(:like, index + 1, attempt: attempt) }

      expect(Attempt.best_for(post).map(&:id)).to eq(attempts.reverse.first(3).map(&:id))
    end

    it "挑戦が BEST_LIMIT 件未満ならその件数だけ返す" do
      older = create(:attempt, :published, post: post, created_at: 2.days.ago)
      newer = create(:attempt, :published, post: post, created_at: 1.day.ago)

      expect(Attempt.best_for(post).map(&:id)).to eq([ newer.id, older.id ])
    end

    it "挑戦が無ければ空" do
      expect(Attempt.best_for(post)).to be_empty
    end

    # listing_for 経由であることの固定。ここが直接 kept.where(post:) を書くように
    # 変わると、下書きが表彰台に出る。
    it "下書き・削除済み・他のお題の挑戦を含めない" do
      create(:attempt, post: post)
      create(:attempt, :published, post: post).discard!
      create(:attempt, :published, post: create(:post))
      published = create(:attempt, :published, post: post)

      expect(Attempt.best_for(post).map(&:id)).to eq([ published.id ])
    end
  end
```

- [ ] **Step 2: テストが落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/models/attempt_spec.rb -e ".best_for"
```

期待：4本すべてが `NoMethodError: undefined method 'best_for' for class Attempt` で落ちる。

- [ ] **Step 3: 最小の実装を書く**

`backend/app/models/attempt.rb` の `MAX_DESCRIPTION_LENGTH` の直後に定数を足す。

```ruby
  # 表彰台（ベスト再現）の枠数。デザイン上の「1位を中央に大きく」は3枠が前提。
  BEST_LIMIT = 3
```

`listing_for` の直後に `best_for` を足す。

```ruby
  # ベスト再現＝いいね順の先頭 BEST_LIMIT 件。定義をここ1か所に閉じることで、
  # best_attempts と attempts?sort=likes の並びが定義上ずれない。
  def self.best_for(post) = listing_for(post, sort: "likes").limit(BEST_LIMIT)
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/models/attempt_spec.rb
```

期待：ファイル全体が green。

- [ ] **Step 5: rubocop を通してコミットする**

```bash
docker compose exec backend bundle exec rubocop app/models/attempt.rb spec/models/attempt_spec.rb
```

```bash
git add backend/app/models/attempt.rb backend/spec/models/attempt_spec.rb
git commit -m "$(cat <<'EOF'
feat: ベスト再現の取得口 Attempt.best_for を足す（issue 6-1）

listing_for(sort: "likes") に limit を掛けるだけにして、表彰台と
いいね順一覧の並びが定義上ずれないようにする。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: お題詳細の挑戦一覧に `sort` を通す

`GET /api/posts/:id?sort=likes` を HTTP から使えるようにする。`best_attempts` はまだ足さない（Task 4）。

**Files:**
- Modify: `backend/app/controllers/api/posts_controller.rb:43-56`（`show`）
- Test: `backend/spec/requests/api/posts_spec.rb`（`RSpec.describe "GET /api/posts/:id"` ブロック内）

**Interfaces:**
- Consumes: `Attempt.listing_for(post, sort:)`（Task 1）、既存の `page_param`
- Produces: `GET /api/posts/:id?sort=likes` が `attempts` をいいね降順で返す。既定と未知の値は新着順

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/posts_spec.rb` の `RSpec.describe "GET /api/posts/:id"` ブロック内、`it "挑戦一覧も 1 ページ 12 件でページングする"` の直後に追記する。

```ruby
  it "sort=likes で挑戦がいいねの多い順になる" do
    post_record = create(:post)
    popular = create(:attempt, :published, post: post_record, created_at: 2.days.ago)
    newer = create(:attempt, :published, post: post_record, created_at: 1.day.ago)
    create_list(:like, 2, attempt: popular)

    get "/api/posts/#{post_record.id}", params: { sort: "likes" }

    expect(response.parsed_body["attempts"].map { |a| a["id"] }).to eq([ popular.id, newer.id ])
  end

  it "未知の sort は新着順にフォールバックする" do
    post_record = create(:post)
    popular = create(:attempt, :published, post: post_record, created_at: 2.days.ago)
    newer = create(:attempt, :published, post: post_record, created_at: 1.day.ago)
    create_list(:like, 2, attempt: popular)

    get "/api/posts/#{post_record.id}", params: { sort: "nonsense" }

    expect(response.parsed_body["attempts"].map { |a| a["id"] }).to eq([ newer.id, popular.id ])
  end
```

- [ ] **Step 2: テストが落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb -e "sort=likes で挑戦がいいねの多い順になる"
```

期待：`expected: [popular.id, newer.id]` に対し `got: [newer.id, popular.id]` で落ちる（`sort` が無視され新着順のまま）。

「未知の sort」のほうは**この時点で green になる**（既定が新着順なので）。これは正常。並び替えを実装したあとにフォールバックが壊れていないことを守るための回帰テストで、Step 4 で意味を持つ。

- [ ] **Step 3: 最小の実装を書く**

`backend/app/controllers/api/posts_controller.rb` の `show` の2行目を差し替える。

```ruby
      attempts = Attempt.listing_for(post, sort: params[:sort]).page(page_param)
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb
```

期待：ファイル全体が green（既存の `GET /api/posts/:id` 10本＋新規2本を含む）。

- [ ] **Step 5: rubocop を通してコミットする**

```bash
docker compose exec backend bundle exec rubocop app/controllers/api/posts_controller.rb spec/requests/api/posts_spec.rb
```

```bash
git add backend/app/controllers/api/posts_controller.rb backend/spec/requests/api/posts_spec.rb
git commit -m "$(cat <<'EOF'
feat: お題詳細の挑戦一覧に sort を通す（issue 6-1）

GET /api/posts/:id?sort=likes で挑戦が再現度（いいね）順になる。
既定と未知の値は新着順のまま。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: お題詳細に `best_attempts` を足す

表彰台（いいね上位3件）を、一覧の `sort` と `page` から独立したフィールドとして返す。この issue の本体。

**Files:**
- Modify: `backend/app/controllers/api/posts_controller.rb:43-56`（`show`）＋ private に `attempt_list_json` を追加
- Test: `backend/spec/requests/api/posts_spec.rb`（`RSpec.describe "GET /api/posts/:id"` ブロック内）

**Interfaces:**
- Consumes: `Attempt.best_for(post)`（Task 2）、`Like.liked_attempt_ids(user, attempt_ids) -> Set<Integer>`（既存）、`AttemptSerializer.call(attempt, liked:)`（既存・変更しない）
- Produces: `GET /api/posts/:id` のレスポンスに `best_attempts`（`attempts` と同じ要素の形の配列、最大3件）が加わる

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/posts_spec.rb` の `RSpec.describe "GET /api/posts/:id"` ブロック内、Task 3 で足した2本の直後に追記する。

```ruby
  it "best_attempts がいいね上位3件を返す" do
    post_record = create(:post)
    attempts = create_list(:attempt, 4, :published, post: post_record)
    attempts.each_with_index { |attempt, index| create_list(:like, index + 1, attempt: attempt) }

    get "/api/posts/#{post_record.id}"

    expect(response.parsed_body["best_attempts"].map { |a| a["id"] })
      .to eq(attempts.reverse.first(3).map(&:id))
  end

  # 案C（page=1 のときだけ返す）を採らなかったことの固定。
  it "best_attempts は sort の指定によらず同じ内容を返す" do
    post_record = create(:post)
    popular = create(:attempt, :published, post: post_record, created_at: 2.days.ago)
    newer = create(:attempt, :published, post: post_record, created_at: 1.day.ago)
    create_list(:like, 2, attempt: popular)

    get "/api/posts/#{post_record.id}", params: { sort: "likes" }
    with_likes = response.parsed_body["best_attempts"].map { |a| a["id"] }

    get "/api/posts/#{post_record.id}"
    with_default = response.parsed_body["best_attempts"].map { |a| a["id"] }

    expect(with_likes).to eq([ popular.id, newer.id ])
    expect(with_default).to eq(with_likes)
  end

  it "best_attempts は page=2 でも同じ内容で入る" do
    post_record = create(:post)
    create_list(:attempt, 13, :published, post: post_record)
    best = create(:attempt, :published, post: post_record)
    create_list(:like, 5, attempt: best)

    get "/api/posts/#{post_record.id}", params: { page: 2 }

    expect(response.parsed_body["best_attempts"].first["id"]).to eq(best.id)
    expect(response.parsed_body["attempts"].size).to eq(2)
  end

  it "best_attempts の要素は attempts と同じ形で、liked も埋まる" do
    user = create(:user)
    token = sign_in_and_get_token(user)
    post_record = create(:post)
    attempt = create(:attempt, :published, post: post_record)
    create(:like, user: user, attempt: attempt)

    get "/api/posts/#{post_record.id}", headers: auth_headers(token)

    best = response.parsed_body["best_attempts"].first
    expect(best).to eq(response.parsed_body["attempts"].first)
    expect(best["liked"]).to be(true)
    expect(best["likes_count"]).to eq(1)
  end

  it "best_attempts に下書き・削除済みは入らない" do
    post_record = create(:post)
    create(:attempt, post: post_record)
    create(:attempt, :published, post: post_record).discard!

    get "/api/posts/#{post_record.id}"

    expect(response.parsed_body["best_attempts"]).to eq([])
  end

  # 空配列と「フィールドごと無い」を区別する。フロントは
  # 「まだ誰も挑戦していない」と「挑戦はあるがいいねが0」を出し分ける。
  it "挑戦が無ければ best_attempts は空配列" do
    post_record = create(:post)

    get "/api/posts/#{post_record.id}"

    expect(response.parsed_body["best_attempts"]).to eq([])
  end
```

- [ ] **Step 2: テストが落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb -e "best_attempts"
```

期待：6本のうち少なくとも「best_attempts がいいね上位3件を返す」が `NoMethodError: undefined method 'map' for nil`（レスポンスに `best_attempts` キーが無い）で落ちる。「下書き・削除済みは入らない」「挑戦が無ければ空配列」の2本は `expected [] got nil` で落ちる。

- [ ] **Step 3: 最小の実装を書く**

`backend/app/controllers/api/posts_controller.rb` の `show` を差し替える。

```ruby
    def show
      post = Post.kept.includes(:user).with_counts.find(params[:id])
      attempts = Attempt.listing_for(post, sort: params[:sort]).page(page_param)
      best_attempts = Attempt.best_for(post)
      # 一覧ぶんのいいね済み判定を 1 クエリでまとめて引く（1 件ずつ引くと N+1 になる）。
      # 表彰台と一覧は同じ挑戦を含みうるので、id を束ねて 1 回だけ引く。
      # 未ログインなら空集合が返り、すべて false になる。
      liked_ids = Like.liked_attempt_ids(current_user, attempts.map(&:id) | best_attempts.map(&:id))

      render json: {
        post: PostSerializer.call(post, favorited: favorited?(post)),
        # 表彰台は sort / page によらず常にいいね上位。一覧とは別のセクションなので、
        # 同じ挑戦が両方に現れる。一覧から除くと kaminari の total_count と OFFSET が
        # ずれ、ページ境界で重複・抜けが出る（設計書参照）。
        best_attempts: best_attempts.map { |attempt| attempt_list_json(attempt, liked_ids) },
        attempts: attempts.map { |attempt| attempt_list_json(attempt, liked_ids) },
        meta: PaginationSerializer.call(attempts)
      }
    end
```

`private` 以下、`page_param` の直前に足す。

```ruby
    # 一覧・表彰台に並べる挑戦 1 件。いいね済みかは id の集合から引く
    # （AttemptRendering#liked? は 1 件ずつ DB を引くので一覧では使えない）。
    def attempt_list_json(attempt, liked_ids)
      AttemptSerializer.call(attempt, liked: liked_ids.include?(attempt.id))
    end
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb
```

期待：ファイル全体が green（既存18本＋Task 3 の2本＋今回の6本）。

**既存の N+1 検査が green のままであることを必ず確認する。** `it "挑戦が増えてもクエリ数が増えない（liked の判定で N+1 を作り込まない）"` が落ちた場合、`liked_ids` を2回引いている（表彰台と一覧で別々に `Like.liked_attempt_ids` を呼んでいる）か、`best_attempts` の中で `attempt.user` を1件ずつ引いている。Step 3 のコードどおりなら起きない。

- [ ] **Step 5: rubocop を通してコミットする**

```bash
docker compose exec backend bundle exec rubocop app/controllers/api/posts_controller.rb spec/requests/api/posts_spec.rb
```

```bash
git add backend/app/controllers/api/posts_controller.rb backend/spec/requests/api/posts_spec.rb
git commit -m "$(cat <<'EOF'
feat: お題詳細に best_attempts を足す（issue 6-1）

いいね上位3件を、一覧の sort と page から独立したフィールドで返す。
デザインブリーフが表彰台と挑戦一覧を同一画面に並べており、表彰台は
一覧の並び替えやページ送りで内容が変わってはならないため。

いいね済み判定は表彰台と一覧の id を束ねて 1 クエリのまま引く。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: ドキュメントを更新する

バックログの 6-1 を完了にし、3-2 が 6-1 に委譲していた `sort=likes` の宿題を解消する。API 一覧に `best_attempts` を明記する。

**Files:**
- Modify: `docs/issues_backlog.md`（3-2 の委譲メモ、6-1 の節）
- Modify: `docs/screen_and_api_design.md:59`（`GET /api/posts/:id` の行）

**Interfaces:**
- Consumes: Task 1〜4 の実装
- Produces: なし（ドキュメントのみ）

- [ ] **Step 1: `docs/screen_and_api_design.md` の 59 行目を差し替える**

現在：

```
| GET | `/api/posts/:id` | お題詳細＋挑戦一覧（`sort=likes` で再現度順＝ベスト再現の取得にも使用） | 詳細 |
```

差し替え後：

```
| GET | `/api/posts/:id` | お題詳細＋挑戦一覧。`?sort=likes` で挑戦を再現度（いいね）順、既定は新着順／`?page=`（1ページ12件）。あわせて `best_attempts`（いいね上位3件。`sort`・`page` によらず固定、ページングなし）を返す | 詳細 |
```

- [ ] **Step 2: `docs/issues_backlog.md` の 3-2 の委譲メモを解消する**

現在（132〜135行目付近）：

```
  - [x] `GET /api/posts/:id`（お題＋挑戦一覧）
        → `sort=likes`（ベスト再現）は **6-1 に委譲**。6-1 は 5-1（いいね API）に依存しており、
          3-2 の時点ではいいねを作る手段が無いため。設計は
          `docs/superpowers/specs/2026-07-29-issue-3-2-post-crud-design.md`
```

末尾に1行足す（既存の行は消さない。委譲した経緯は残す）：

```
        → **2026-08-19 に 6-1 で実装済み**（`sort=likes` と `best_attempts`）。
```

- [ ] **Step 3: `docs/issues_backlog.md` の 6-1 の節を差し替える**

現在：

```
### 🟢 6-1. お題ごとのベスト再現
- 依存：5-1
- タスク：`GET /api/posts/:id?sort=likes` で挑戦を再現度（いいね）順に返す（上位3件を強調表示できるように）。
- 完了条件：お題詳細でベスト再現を取得できる。
```

差し替え後：

```
### 🟢 6-1. お題ごとのベスト再現
- 依存：5-1
- タスク：
  - [x] `GET /api/posts/:id?sort=likes` で挑戦を再現度（いいね）順に返す（既定・未知の値は新着順）
  - [x] `best_attempts`（いいね上位3件）を独立したフィールドで返す
- 設計は `docs/superpowers/specs/2026-08-19-issue-6-1-best-attempts-design.md`
- **表彰台を独立フィールドにした理由**：`docs/design_briefs.md` の 3 が「ベスト再現（上位3件・表彰台風）」と
  「みんなの挑戦（再現度順／新着順の切替＋ページング）」を**同一画面に並べる**と定めている。表彰台は一覧の
  `sort` と `page` に影響されてはならないため、一覧の並び替え結果とは別のデータになる。一覧の先頭3件を
  流用する案だと、フロントに「今のソートが likes かつ 1 ページ目なら流用、そうでなければ再取得」という
  分岐が生まれる。
- 補足：**表彰台の3件は「みんなの挑戦」一覧にも重複して出る**。一覧から除外すると kaminari の
  `total_count` と OFFSET がずれ、12件のはずのページが9件になったりページ境界で重複・抜けが出る。
- 補足：いいねが0件でも `best_attempts` は上位3件（実質は新着3件）を返す。「全員0なら表彰台を出さない」は
  見せ方の判断なのでフロントが `likes_count` を見て決める。
- **7-3 への申し送り**：`best_attempts` はページングを持たない。`meta` は `attempts` のページングだけを指す。
- 完了条件：お題詳細でベスト再現を取得できる。
```

- [ ] **Step 4: rspec 全体を通す**

```bash
docker compose exec backend bundle exec rspec
```

期待：全 spec が green。ドキュメントのみの変更なので落ちる要素は無いが、Task 1〜4 をまとめて通す最終確認として実行する。

- [ ] **Step 5: rubocop 全体を通してコミットする**

```bash
docker compose exec backend bundle exec rubocop
```

```bash
git add docs/issues_backlog.md docs/screen_and_api_design.md
git commit -m "$(cat <<'EOF'
docs: issue 6-1 の完了をバックログと API 一覧に反映

表彰台を独立フィールドにした理由と、一覧に重複して出す理由を残す。
3-2 が 6-1 に委譲していた sort=likes の宿題も解消する。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 仕上げ（全タスク完了後）

- [ ] **`/code-review` を実行する**（プッシュ前に必ず挟む。指摘があれば対応してから進む）
- [ ] **ローカルでブラウザ／curl から動作確認する**

```bash
docker compose exec backend bin/rails runner 'puts Post.kept.first&.id'
```

出力された id を使って（`<ID>` を置き換える）：

```bash
curl -s "http://localhost:3000/api/posts/<ID>" | jq 'keys'
curl -s "http://localhost:3000/api/posts/<ID>?sort=likes" | jq '{best: [.best_attempts[].id], list: [.attempts[].id]}'
```

期待：`keys` に `best_attempts` が含まれる。`sort=likes` を付けても外しても `best` の並びが変わらない。

- [ ] **プッシュして PR を作る**。PR 本文に `Closes #19` を書く（issue テンプレの必須項目）

```bash
git push -u origin feat/issue-6-1-best-attempts
```

## 完了条件

- `GET /api/posts/:id?sort=likes` で挑戦がいいねの多い順に返る。既定・未知の値は新着順に落ちる
- `best_attempts` がいいね上位3件を返し、`sort` と `page` を変えても内容が変わらない
- `best_attempts` に下書き・削除済み・他のお題の挑戦が混ざらない
- 挑戦の件数が増えてもクエリ数が増えない（既存の N+1 検査が green）
- `bundle exec rubocop` と `bundle exec rspec` が green
