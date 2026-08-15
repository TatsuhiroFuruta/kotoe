# お気に入り API（issue 5-2）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** お題（Post）へのお気に入りをオン／オフする冪等なトグル API を追加し、お題を返すすべての応答に「自分がお気に入り済みか」を示す `favorited` を含める。

**Architecture:** 既存の再現いいね API（issue 5-1）と同型。`Api::FavoritesController` が HTTP の入口を担い、冪等化の rescue は `IdempotentToggle` concern に、お題の JSON 化は `PostRendering` concern に切り出して `LikesController` / `PostsController` / `AttemptsController` と共有する。一覧の `favorited` 判定は `Favorite.favorited_post_ids` が id 集合に対して 1 クエリで引き、N+1 を作らない。マイグレーションは無い（`favorites` テーブル・`Favorite` モデル・factory はマイルストーン1で作成済み）。

**Tech Stack:** Ruby on Rails 8（API モード）、RSpec、FactoryBot、shoulda-matchers、devise-jwt、discard、kaminari、PostgreSQL

**Spec:** `docs/superpowers/specs/2026-08-15-issue-5-2-favorite-api-design.md`

## Global Constraints

- **ブランチ**：`feat/issue-5-2-favorite-api`（作成済み・設計書のコミット `883adf4` が乗っている）。main へ直接コミットしない。
- **文字列はダブルクォート**。spec ファイルも含めプロジェクト全体で統一（`rubocop-rails-omakase`）。
- **配列リテラルは内側にスペース**：`[ post.id ]`（rails-omakase の `Layout/SpaceInsideArrayLiteralBrackets`）。
- **コマンドはすべて Docker 経由**：`docker compose exec backend bundle exec rspec` / `docker compose exec backend bundle exec rubocop`。プロジェクトルート（`/Users/tatsuhirofuruta/workspace/projects/kotoe`）から実行する。
- **物理削除するのは `favorites` / `likes` のみ**。他は必ず `discard`。
- **エラーは文言でなくエラーコードで返す**（i18n はフロント）。形は `{ "errors": { "属性名": [ "コード" ] } }`。
- **`favorites_count` は返さない**。`Post.with_counts` は変更しない。
- **セルフお気に入りは禁止しない**（自分のお題もお気に入りできる）。
- **削除済みのお題は POST も DELETE も 404**。
- 各タスクの最後に `bundle exec rubocop` と `bundle exec rspec` を通してからコミットする。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `backend/app/models/favorite.rb` | **変更**。`favorited_post_ids` を追加（一覧ぶんのお気に入り判定を 1 クエリで引く） |
| `backend/app/serializers/post_serializer.rb` | **変更**。`favorited:` を必須キーワードで受け取り、出力に追加 |
| `backend/app/controllers/concerns/post_rendering.rb` | **新規**。お題の JSON 化（`post_json` / `favorited?`）を `PostsController` / `AttemptsController` / `FavoritesController` で共有 |
| `backend/app/controllers/concerns/idempotent_toggle.rb` | **新規**。トグル ON の冪等化（`toggle_on` / `duplicate_only?`）を `LikesController` / `FavoritesController` で共有 |
| `backend/app/controllers/api/favorites_controller.rb` | **新規**。`create` / `destroy` |
| `backend/app/controllers/api/likes_controller.rb` | **変更**。rescue と `duplicate_only?` を concern へ移す |
| `backend/app/controllers/api/posts_controller.rb` | **変更**。`index` / `show` / `create` で `favorited` を通す |
| `backend/app/controllers/api/attempts_controller.rb` | **変更**。`show` の post に `favorited` を通す |
| `backend/config/routes.rb` | **変更**。`resource :favorite` を posts にネスト |

---

### Task 1: `Favorite.favorited_post_ids`

一覧ぶんのお気に入り判定を 1 クエリで引くクラスメソッド。以降のすべてのタスクがこれに依存する。HTTP を経由しないので model spec だけで閉じる。

**Files:**
- Modify: `backend/app/models/favorite.rb`
- Test: `backend/spec/models/favorite_spec.rb`（末尾に追記）

**Interfaces:**
- Consumes: なし（`Favorite` モデル・`favorites` テーブル・`spec/factories/favorites.rb` は作成済み）
- Produces: `Favorite.favorited_post_ids(user, post_ids) -> Set<Integer>`。`user` が `nil`、または `post_ids` が空なら DB を触らず `Set.new` を返す。

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/models/favorite_spec.rb` の最後の `end` の直前に追記する（`RSpec.describe Favorite` ブロックの中）。

```ruby
  describe ".favorited_post_ids" do
    it "そのユーザーがお気に入り済みの post_id だけを Set で返す" do
      user = create(:user)
      favorited = create(:post)
      not_favorited = create(:post)
      create(:favorite, user: user, post: favorited)

      result = Favorite.favorited_post_ids(user, [ favorited.id, not_favorited.id ])

      expect(result).to eq(Set[favorited.id])
    end

    it "他人のお気に入りは含めない" do
      user = create(:user)
      post_record = create(:post)
      create(:favorite, post: post_record)

      result = Favorite.favorited_post_ids(user, [ post_record.id ])

      expect(result).to be_empty
    end

    # 未ログインの一覧で毎回 SELECT を撃たないことまで固定する。
    it "user が nil なら DB を触らず空集合を返す" do
      post_record = create(:post)

      expect(Favorite).not_to receive(:where)
      expect(Favorite.favorited_post_ids(nil, [ post_record.id ])).to be_empty
    end

    it "post_ids が空なら DB を触らず空集合を返す" do
      user = create(:user)

      expect(Favorite).not_to receive(:where)
      expect(Favorite.favorited_post_ids(user, [])).to be_empty
    end
  end
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
docker compose exec backend bundle exec rspec spec/models/favorite_spec.rb -e ".favorited_post_ids"
```

Expected: FAIL。`NoMethodError: undefined method 'favorited_post_ids' for class Favorite`（4 examples, 4 failures）

- [ ] **Step 3: 最小の実装を書く**

`backend/app/models/favorite.rb` を次の内容にする。

```ruby
class Favorite < ApplicationRecord
  belongs_to :user
  belongs_to :post

  validates :user_id, uniqueness: { scope: :post_id }

  # 表示するお題のうち、そのユーザーがお気に入り済みのものを id の Set で返す。
  # 一覧で 1 件ずつ exists? を呼ぶと N+1 になるため、id 集合に対して 1 クエリで引く。
  # 未ログイン（user が nil）は常に空集合＝すべて false。
  def self.favorited_post_ids(user, post_ids)
    return Set.new if user.nil? || post_ids.empty?

    where(user: user, post_id: post_ids).pluck(:post_id).to_set
  end
end
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/models/favorite_spec.rb
```

Expected: PASS（既存 6 examples ＋ 新規 4 examples ＝ 10 examples, 0 failures）

- [ ] **Step 5: rubocop を通す**

```bash
docker compose exec backend bundle exec rubocop app/models/favorite.rb spec/models/favorite_spec.rb
```

Expected: `no offenses detected`

- [ ] **Step 6: コミット**

```bash
git add backend/app/models/favorite.rb backend/spec/models/favorite_spec.rb
git commit -m "$(cat <<'EOF'
feat: Favorite.favorited_post_ids を追加（issue 5-2）

一覧ぶんのお気に入り判定を id 集合に対して 1 クエリで引く。
1 件ずつ exists? を呼ぶと N+1 になるため。Like.liked_attempt_ids と同じ形。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `favorited` をお題の応答に通す

`PostSerializer` に必須キーワード `favorited:` を足す。必須にすると 4 つの呼び出し元が同時に壊れるので、このタスクは全経路の配線までを 1 単位で行う（途中でコミットするとテストが赤いままになる）。

**Files:**
- Create: `backend/app/controllers/concerns/post_rendering.rb`
- Modify: `backend/app/serializers/post_serializer.rb`
- Modify: `backend/app/controllers/api/posts_controller.rb`（`index` / `create` / `show`）
- Modify: `backend/app/controllers/api/attempts_controller.rb`（`show`）
- Test: `backend/spec/requests/api/posts_spec.rb`、`backend/spec/requests/api/attempts_spec.rb`

**Interfaces:**
- Consumes: `Favorite.favorited_post_ids(user, post_ids) -> Set<Integer>`（Task 1）
- Produces:
  - `PostSerializer.call(post, favorited:) -> Hash`。`favorited:` は必須キーワード。
  - `PostRendering#post_json(post) -> Hash`（private）。`Post` を `with_counts` 経由で取り直してシリアライズする。
  - `PostRendering#favorited?(post) -> Boolean`（private）。単体のお題に対する判定。

- [ ] **Step 1: 失敗するテストを書く（`posts_spec.rb` の既存の期待値を更新）**

`backend/spec/requests/api/posts_spec.rb:13-20` の完全一致ハッシュに `"favorited" => false` を足す。`eq` なのでキーが増えると必ず赤くなる。

```ruby
    expect(response.parsed_body["posts"].first).to eq(
      "id" => post_record.id,
      "title" => "夕暮れの交差点",
      "image_public_id" => "kotoe/test/posts/a",
      "user" => { "id" => author.id, "name" => "投稿者" },
      "attempts_count" => 1,
      "likes_count" => 2,
      "favorited" => false,
      "created_at" => post_record.created_at.utc.iso8601
    )
```

同ファイル `POST /api/posts` の `include` にも足す（`backend/spec/requests/api/posts_spec.rb:131-136`）。

```ruby
    expect(response.parsed_body["post"]).to include(
      "id" => created.id,
      "title" => "夕暮れの交差点",
      "attempts_count" => 0,
      "likes_count" => 0,
      "favorited" => false
    )
```

- [ ] **Step 2: 失敗するテストを書く（`posts_spec.rb` に `favorited` の振る舞いを新規追加）**

`RSpec.describe "GET /api/posts"` ブロックの中、N+1 検査（`it "お題が増えてもクエリ数が増えない..."`）の直前に追記する。

```ruby
  it "ログインしていれば自分がお気に入りしたお題だけ favorited が true になる" do
    user = create(:user)
    token = sign_in_and_get_token(user)
    favorited = create(:post)
    not_favorited = create(:post)
    create(:favorite, user: user, post: favorited)

    get "/api/posts", headers: auth_headers(token)

    flags = response.parsed_body["posts"].to_h { |p| [ p["id"], p["favorited"] ] }
    expect(flags).to eq(favorited.id => true, not_favorited.id => false)
  end

  it "他人がお気に入りしていても自分の favorited は false" do
    user = create(:user)
    token = sign_in_and_get_token(user)
    post_record = create(:post)
    create(:favorite, post: post_record)

    get "/api/posts", headers: auth_headers(token)

    expect(response.parsed_body["posts"].first["favorited"]).to be(false)
  end

  # ログイン状態で測るのが要点。未認証だと Favorite.favorited_post_ids が early return
  # して DB を触らないため、favorited の判定を 1 件ずつの exists? に書き換えても
  # 上の未認証の N+1 検査では検知できない。
  it "ログイン状態でもお題が増えてクエリ数が増えない（favorited の判定で N+1 を作り込まない）" do
    user = create(:user)
    token = sign_in_and_get_token(user)
    create(:post)
    with_one = count_select_queries { get "/api/posts", headers: auth_headers(token) }

    create_list(:post, 2)
    with_three = count_select_queries { get "/api/posts", headers: auth_headers(token) }

    expect(with_three).to eq(with_one)
  end
```

`RSpec.describe "GET /api/posts/:id"` ブロックの中、`it "ログインしていれば自分がいいねした挑戦だけ liked が true になる"` の直後に追記する。

```ruby
  it "お題の favorited を返す" do
    user = create(:user)
    token = sign_in_and_get_token(user)
    post_record = create(:post)
    create(:favorite, user: user, post: post_record)

    get "/api/posts/#{post_record.id}", headers: auth_headers(token)

    expect(response.parsed_body["post"]["favorited"]).to be(true)
  end

  it "未認証なら favorited は false" do
    post_record = create(:post)
    create(:favorite, post: post_record)

    get "/api/posts/#{post_record.id}"

    expect(response.parsed_body["post"]["favorited"]).to be(false)
  end
```

- [ ] **Step 3: 失敗するテストを書く（`attempts_spec.rb`）**

`backend/spec/requests/api/attempts_spec.rb:280-283` の `include` に `favorited` を足し、その直後に新しい example を追加する。

```ruby
      # 比較ビューが「元画像 vs 再現画像」を並べるため、元画像がこの1本で揃う。
      expect(response.parsed_body["post"]).to include(
        "id" => post_record.id,
        "image_public_id" => post_record.image_public_id,
        "favorited" => false
      )
    end

    it "自分がお気に入りしているお題は post の favorited が true になる" do
      attempt = create(:attempt, :published, post: post_record)
      create(:favorite, user: user, post: post_record)

      get "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(response.parsed_body["post"]["favorited"]).to be(true)
    end
```

- [ ] **Step 4: テストが失敗することを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb spec/requests/api/attempts_spec.rb
```

Expected: FAIL。`favorited` キーが無いことによる期待値の不一致が複数（`GET /api/posts` の `eq` 比較、`include` 比較、新規 example）。

- [ ] **Step 5: `PostSerializer` に `favorited:` を足す**

`backend/app/serializers/post_serializer.rb` を次の内容にする。

```ruby
# お題 1 件の表現。一覧・詳細・作成の応答で共通に使う。
#
# attempts_count / likes_count は Post.with_counts が SELECT 句で付ける別名属性なので、
# そのスコープを通っていない Post を渡すと ActiveModel::MissingAttributeError になる。
# 0 を既定値にして握りつぶさないのは、with_counts の付け忘れが「黙って 0 が並ぶ一覧」
# として表に出るより、その場で落ちたほうが直せるため。
#
# favorited（そのリクエストの本人がお気に入り済みか）もキーワードを必須にしてある。
# デフォルト値を置くと、渡し忘れたときに黙って false が入り
# 「お気に入りしたのにボタンが白いまま」になって気づけない。
#
# favorites_count は返さない。お気に入りは自分だけのブックマークで、
# 何人がお気に入りしたかは公開しない（いいねとの役割分担は 5-4 の前提）。
class PostSerializer
  def self.call(post, favorited:)
    {
      id: post.id,
      title: post.title,
      image_public_id: post.image_public_id,
      user: UserSerializer.public_profile(post.user),
      attempts_count: post.attempts_count,
      likes_count: post.likes_count,
      favorited: favorited,
      created_at: post.created_at.utc.iso8601
    }
  end
end
```

- [ ] **Step 6: `PostRendering` concern を作る**

`backend/app/controllers/concerns/post_rendering.rb` を新規作成する。`app/controllers/concerns/` は既存ディレクトリなので、Rails の restart は不要（新規ディレクトリを作ったときだけ必要）。

```ruby
# お題を JSON にする手順の共有。PostsController / AttemptsController / FavoritesController が使う。
module PostRendering
  extend ActiveSupport::Concern

  private

  # PostSerializer は with_counts が SELECT 句で付ける別名属性に依存している。
  # 新規作成直後やお気に入りの増減後のレコードには乗っていないので、そのスコープ経由で取り直す。
  # 0 を直接埋めないのは、シリアライザの前提を1か所でも崩すと後で気づけなくなるため。
  def post_json(post)
    fresh = Post.includes(:user).with_counts.find(post.id)
    PostSerializer.call(fresh, favorited: favorited?(fresh))
  end

  # 単体のお題に対する判定。一覧は Favorite.favorited_post_ids を直接呼んで 1 クエリにまとめる。
  def favorited?(post)
    Favorite.favorited_post_ids(current_user, [ post.id ]).include?(post.id)
  end
end
```

- [ ] **Step 7: `PostsController` を配線する**

`backend/app/controllers/api/posts_controller.rb` の 3 か所を変更する。

クラス宣言の直後に include を足す（`MAX_PAGE` の定義より前）。

```ruby
  class PostsController < ApplicationController
    include PostRendering

    # kaminari は OFFSET = 12 * (page - 1) を組み立てるため、巨大な値を渡されると
```

`index` を差し替える。

```ruby
    def index
      posts = Post.listing(q: params[:q], sort: params[:sort]).page(page_param)
      # 一覧ぶんのお気に入り済み判定を 1 クエリでまとめて引く（1 件ずつ引くと N+1 になる）。
      # 未ログインなら空集合が返り、すべて false になる。
      favorited_ids = Favorite.favorited_post_ids(current_user, posts.map(&:id))

      render json: {
        posts: posts.map { |post| PostSerializer.call(post, favorited: favorited_ids.include?(post.id)) },
        meta: PaginationSerializer.call(posts)
      }
    end
```

`create` の末尾 2 行（取り直しとレンダリング）を `post_json` に寄せる。

```ruby
      post.image_public_id = Images::Uploader.call(image, kind: :post)
      post.save!

      # 新規レコードには with_counts の別名属性が乗っていないため、
      # post_json が取り直してから表現を組み立てる（一覧と同じ形になる）。
      render json: { post: post_json(post) }, status: :created
    rescue Images::Uploader::UploadError
```

`show` の `post:` の行を差し替える。ここは既に `with_counts` 経由で取っているので `post_json` では取り直さず、`favorited?` だけを使う。

```ruby
      render json: {
        post: PostSerializer.call(post, favorited: favorited?(post)),
```

- [ ] **Step 8: `AttemptsController` を配線する**

`backend/app/controllers/api/attempts_controller.rb` の include に `PostRendering` を足す。

```ruby
  class AttemptsController < ApplicationController
    include AttemptRendering
    include PostRendering
```

`show` の `post:` の行を差し替える。

```ruby
      render json: {
        attempt: AttemptSerializer.call(attempt, liked: liked?(attempt)),
        post: PostSerializer.call(post, favorited: favorited?(post))
      }
```

- [ ] **Step 9: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec
```

Expected: PASS（全 spec）。ここで `PostSerializer` の呼び出し漏れがあれば `ArgumentError: missing keyword: :favorited` で落ちるので、4 経路すべてを直したことが担保される。

- [ ] **Step 10: rubocop を通す**

```bash
docker compose exec backend bundle exec rubocop
```

Expected: `no offenses detected`

- [ ] **Step 11: コミット**

```bash
git add backend/app/serializers/post_serializer.rb \
        backend/app/controllers/concerns/post_rendering.rb \
        backend/app/controllers/api/posts_controller.rb \
        backend/app/controllers/api/attempts_controller.rb \
        backend/spec/requests/api/posts_spec.rb \
        backend/spec/requests/api/attempts_spec.rb
git commit -m "$(cat <<'EOF'
feat: お題の応答に favorited を足す（issue 5-2）

フロントがお気に入りボタンの状態を描けるようにする。PostSerializer は
一覧・詳細・作成・挑戦詳細の 4 経路で共有されているため、必須キーワードに
して呼び出し漏れが ArgumentError で即座に出るようにした。

取り直しとシリアライズは PostRendering concern に切り出し、
一覧は Favorite.favorited_post_ids で 1 クエリにまとめて N+1 を避ける。
ログイン状態の N+1 検査を新設した（未認証だと early return して検知できないため）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `IdempotentToggle` concern を切り出す

`LikesController#create` の冪等化ロジックを concern へ移す純粋なリファクタ。振る舞いは変わらないので、既存の `likes_spec.rb` が green のままであることが合格条件になる。Task 4 の `FavoritesController` がこの concern を使う。

**Files:**
- Create: `backend/app/controllers/concerns/idempotent_toggle.rb`
- Modify: `backend/app/controllers/api/likes_controller.rb`
- Test: `backend/spec/requests/api/likes_spec.rb`（**変更しない**。既存のまま通ることを確認する）

**Interfaces:**
- Consumes: `ApplicationController#render_validation_errors(record)`（protected、既存）
- Produces: `IdempotentToggle#toggle_on(association, target) { ... } -> Object`（private）。`association.find_or_create_by!(target)` を実行し、成功／重複ならブロックを評価する。重複以外の検証エラーのときだけブロックを評価せず 422 をレンダリングする。

- [ ] **Step 1: 現状が green であることを確認する（リファクタの基準線）**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/likes_spec.rb
```

Expected: PASS（0 failures）。ここが赤いならリファクタを始めない。

- [ ] **Step 2: `IdempotentToggle` concern を作る**

`backend/app/controllers/concerns/idempotent_toggle.rb` を新規作成する。コメントは `LikesController` にあったものを移設している。

```ruby
# トグル（いいね／お気に入り）の ON を冪等にする手順の共有。
# LikesController と FavoritesController が使う。
#
# POST を「レコードを作成せよ」ではなく「その状態にせよ」という命令として解釈する。
# すでにその状態でも、並行リクエストと競合しても、成功としてブロックを評価する。
module IdempotentToggle
  extend ActiveSupport::Concern

  private

  # 成功時はブロックの戻り値を返す（応答の組み立ては呼び出し元の責務）。
  #
  # 捕まえる例外が 2 つあるのは、複合ユニークインデックスとアプリ側の uniqueness
  # バリデーションのどちらが先に当たるかが、競合相手の状態で変わるため。
  # RecordNotUnique だけを rescue すると、競合相手がコミット済みのケースで 500 になる。
  def toggle_on(association, target)
    association.find_or_create_by!(target)
    yield
  rescue ActiveRecord::RecordNotUnique
    # 並行リクエストの INSERT がまだ進行中で、複合ユニークインデックスが検知した場合。
    # 最終状態は要求どおり「ON」なので成功として扱う。
    # rescue しないと同時クリックで 500 になる。
    yield
  rescue ActiveRecord::RecordInvalid => e
    # 並行リクエストの INSERT がコミット済みで、uniqueness バリデーションが
    # 検知した場合。重複だけを成功に読み替える。
    #
    # RecordInvalid をまとめて握り潰さないのは、将来バリデーションが増えたときに、
    # 弾かれたトグルが 200 と false で返り、エラーコードも出ないまま
    # フロントが失敗に気づけなくなるため。重複以外は通常の検証エラーとして返す。
    duplicate_only?(e.record) ? yield : render_validation_errors(e.record)
  end

  # 「重複していた」だけが原因か。of_kind? では足りない。あれは重複が**含まれていれば**
  # true なので、重複と別の原因が同時に立ったときに別の原因ごと成功に読み替えてしまう。
  # errors が空の RecordInvalid を重複と誤認しないよう any? も見る（all? は空で true）。
  #
  # Like も Favorite も uniqueness を user_id にスコープ付きで宣言しているため、
  # 重複のエラーは attribute が :user_id、type が :taken で共通になる。
  def duplicate_only?(record)
    record.errors.any? &&
      record.errors.all? { |error| error.attribute == :user_id && error.type == :taken }
  end
end
```

- [ ] **Step 3: `LikesController` を concern に寄せる**

`backend/app/controllers/api/likes_controller.rb` を次の内容にする。`create` の rescue 3 本と `duplicate_only?` が消え、`likeable_attempt` / `render_error` は残る。

```ruby
module Api
  # 再現いいね（Like）。トグルは冪等で、同じリクエストを何度送っても状態が変わらない。
  # POST は「この挑戦を、自分がいいねしている状態にせよ」という意味になる。
  class LikesController < ApplicationController
    include AttemptRendering
    include IdempotentToggle

    before_action :authenticate_user!

    def create
      attempt = likeable_attempt
      # いいねは再現度への投票で、ベスト再現（6-1）と全体ランキング（6-2）の順位を
      # 直接決める。自分で自分に投票できると同着が自票で覆る。
      return render_error("cannot_like_own_attempt") if attempt.user_id == current_user.id

      toggle_on(current_user.likes, attempt: attempt) do
        render json: { attempt: attempt_json(attempt) }
      end
    end

    def destroy
      attempt = likeable_attempt
      # 解除は物理削除。likes には discarded_at が無く、行を残すと複合ユニークに
      # 引っかかって二度といいねし直せなくなる（CLAUDE.md の論理削除ルールの例外。
      # likes は何からも参照されておらず、取り消しに記録を残す意味も無い）。
      #
      # いいねしていなければ何もしない（冪等）。自分の挑戦でも 422 にしない。
      # セルフいいねを禁じている以上「いいねしていない状態」で確定しており、
      # 冪等な DELETE の定義どおり現状を返せばよい。
      current_user.likes.find_by(attempt: attempt)&.destroy

      render json: { attempt: attempt_json(attempt) }
    end

    private

    # いいねできるのは、生きているお題にぶら下がる公開済みの挑戦だけ。下書き・生成中・
    # 失敗・削除済み・存在しない ID は、すべて RecordNotFound → 404 になる。403 と
    # 分けないのは、他人の下書きの存在を漏らさないため（visible_attempt と同じ方針）。
    #
    # お題側も見るのは、Post#discard が挑戦にカスケードしないため。挑戦だけを見ると
    # kept かつ published のままで、読み取り API からは辿れない（お題が 404 になる）のに
    # いいねだけ書き込めてしまう。その票は Attempt.likes_count_sql に効き、
    # ベスト再現（6-1）と全体ランキング（6-2）で削除済みのお題の挑戦が順位を持つ。
    def likeable_attempt
      Attempt.kept.published.joins(:post).merge(Post.kept).find(params[:attempt_id])
    end

    def render_error(code)
      render json: { error: code }, status: :unprocessable_content
    end
  end
end
```

- [ ] **Step 4: 既存テストが変わらず通ることを確認する**

`likes_spec.rb` は 1 行も変更していない。並行競合のテストは `CollectionProxy#find_or_create_by!` をスタブしており、呼び出し場所が concern に移っても効き続ける。

```bash
docker compose exec backend bundle exec rspec spec/requests/api/likes_spec.rb
```

Expected: PASS（Step 1 と同じ example 数、0 failures）

- [ ] **Step 5: 全体が green であることを確認する**

```bash
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec rubocop
```

Expected: rspec は 0 failures、rubocop は `no offenses detected`

- [ ] **Step 6: コミット**

```bash
git add backend/app/controllers/concerns/idempotent_toggle.rb \
        backend/app/controllers/api/likes_controller.rb
git commit -m "$(cat <<'EOF'
refactor: 冪等トグルの rescue を IdempotentToggle concern に切り出す（issue 5-2）

Favorite の uniqueness も user_id にスコープ付きで宣言されており、重複時の
エラーの形（attribute: :user_id / type: :taken）が Like と完全に一致する。
FavoritesController でコメント込み 30 行を複製する代わりに共有する。

振る舞いは変えていない。likes_spec.rb は無変更で通る。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `POST /api/posts/:post_id/favorite`

ルート・コントローラ・お気に入り登録側の spec。

**Files:**
- Modify: `backend/config/routes.rb`
- Create: `backend/app/controllers/api/favorites_controller.rb`
- Test: `backend/spec/requests/api/favorites_spec.rb`（新規）

**Interfaces:**
- Consumes: `IdempotentToggle#toggle_on`（Task 3）、`PostRendering#post_json`（Task 2）、`Favorite.favorited_post_ids`（Task 1）
- Produces: `POST /api/posts/:post_id/favorite` → `200 { "post": {...} }`。`Api::FavoritesController#favoritable_post`（private）が `Post.kept.find(params[:post_id])` で対象を絞る。

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/favorites_spec.rb` を新規作成する。

```ruby
require "rails_helper"

RSpec.describe "お気に入り API", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }
  let(:post_record) { create(:post) }

  describe "POST /api/posts/:post_id/favorite" do
    it "お気に入りに登録すると 200 と更新後のお題を返す" do
      expect {
        post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json
      }.to change(Favorite, :count).by(1)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["post"]).to include(
        "id" => post_record.id,
        "favorited" => true
      )
    end

    # いいねと違い、お気に入りは自分だけのブックマークで公開も集計もされない。
    # 順位に効かないためセルフ登録を禁じる理由が無く、5-1 とここだけ非対称になる。
    # 対称化されないよう固定する。
    it "自分のお題もお気に入りできる" do
      own = create(:post, user: user)

      expect {
        post "/api/posts/#{own.id}/favorite", headers: auth_headers(token), as: :json
      }.to change(Favorite, :count).by(1)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["post"]).to include("favorited" => true)
    end

    it "二重に登録しても増えず、200 を返す" do
      create(:favorite, user: user, post: post_record)

      expect {
        post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json
      }.not_to change(Favorite, :count)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["post"]).to include("favorited" => true)
    end

    it "お気に入り数は応答に含めない" do
      create(:favorite, post: post_record)

      post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response.parsed_body["post"]).not_to have_key("favorites_count")
    end

    it "削除済みのお題には 404" do
      post_record.discard!

      post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body).to eq("error" => "not_found")
    end

    it "存在しない ID は 404" do
      post "/api/posts/0/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "未認証は 401" do
      post "/api/posts/#{post_record.id}/favorite", as: :json

      expect(response).to have_http_status(:unauthorized)
    end

    # 並行リクエストの再現は request spec では作れないため、ここだけ例外をスタブして
    # rescue 節が生きていることを確かめる。DB 制約とアプリ側の uniqueness バリデーションの
    # どちらが先に当たるかは競合相手がコミット済みかどうかで変わるので、両方を見る。
    #
    # any_instance_of が広いのは承知のうえ。request spec からは current_user.favorites だけを
    # 名指しできない。このリクエストで find_or_create_by! を呼ぶのが 1 か所しかないことに
    # 依存しているので、コントローラに別の呼び出しを足すときはここを見直すこと。
    it "DB 制約の競合（RecordNotUnique）でも 200 を返す" do
      allow_any_instance_of(ActiveRecord::Associations::CollectionProxy)
        .to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordNotUnique)

      post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:ok)
    end

    it "バリデーションの競合（RecordInvalid）でも 200 を返す" do
      duplicate = Favorite.new
      duplicate.errors.add(:user_id, :taken)
      allow_any_instance_of(ActiveRecord::Associations::CollectionProxy)
        .to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordInvalid.new(duplicate))

      post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:ok)
    end

    # 「重複していた」以外の検証失敗まで成功にすると、将来 Favorite にバリデーションが
    # 増えたとき 200 と favorited: false を返し、フロントが失敗に気づけなくなる。
    # 文言ではなくエラーコードを返すこと（i18n はフロント）もここで固定する。
    it "重複以外の検証失敗はエラーコードで返す" do
      other = Favorite.new
      other.errors.add(:base, :invalid)
      allow_any_instance_of(ActiveRecord::Associations::CollectionProxy)
        .to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordInvalid.new(other))

      post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("errors" => { "base" => [ "invalid" ] })
    end

    # of_kind? は「重複が含まれていれば true」なので、重複と別の原因が同時に立つと
    # 別の原因ごと握り潰してしまう。重複「だけ」が原因のときに限る。
    it "重複と別の検証失敗が同時なら成功にしない" do
      both = Favorite.new
      both.errors.add(:user_id, :taken)
      both.errors.add(:base, :invalid)
      allow_any_instance_of(ActiveRecord::Associations::CollectionProxy)
        .to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordInvalid.new(both))

      post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]).to include("base" => [ "invalid" ])
    end
  end
end
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/favorites_spec.rb
```

Expected: FAIL。ルートが無いため `ActionController::RoutingError: No route matches [POST] "/api/posts/1/favorite"`（11 examples, 11 failures）

- [ ] **Step 3: ルートを足す**

`backend/config/routes.rb` の posts のブロックを差し替える。

```ruby
    # お題（issue 3-2）。一覧・詳細は認証不要、投稿・削除は要ログイン。
    resources :posts, only: %i[index create show destroy] do
      resources :attempts, only: %i[create]

      # お気に入り（issue 5-2）。単数リソースなので /api/posts/:post_id/favorite の
      # 1 パスに POST（登録）と DELETE（解除）が生える。attempts の like と対称。
      resource :favorite, only: %i[create destroy]
    end
```

- [ ] **Step 4: `FavoritesController` を作る**

`backend/app/controllers/api/favorites_controller.rb` を新規作成する。`destroy` は Task 5 で足すため、ここでは `create` だけを書く。

```ruby
module Api
  # お気に入り（Favorite）。トグルは冪等で、同じリクエストを何度送っても状態が変わらない。
  # POST は「このお題を、自分がお気に入りしている状態にせよ」という意味になる。
  #
  # いいね（5-1）と違い、所有者チェックは無い。お気に入りは公開されず集計もされず
  # 順位にも効かない自分だけのブックマークなので、自分のお題をストックするのは正当な使い方。
  class FavoritesController < ApplicationController
    include IdempotentToggle
    include PostRendering

    before_action :authenticate_user!

    def create
      post = favoritable_post

      toggle_on(current_user.favorites, post: post) do
        render json: { post: post_json(post) }
      end
    end

    private

    # お気に入りできるのは生きているお題だけ。削除済み・存在しない ID は
    # RecordNotFound → 404 になる。お題には published に相当する状態が無いので、
    # 5-1 の likeable_attempt のような二段構えは要らない。
    def favoritable_post
      Post.kept.find(params[:post_id])
    end
  end
end
```

- [ ] **Step 5: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/favorites_spec.rb
```

Expected: PASS（11 examples, 0 failures）

- [ ] **Step 6: 全体と rubocop を通す**

```bash
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec rubocop
```

Expected: rspec は 0 failures、rubocop は `no offenses detected`

- [ ] **Step 7: コミット**

```bash
git add backend/config/routes.rb \
        backend/app/controllers/api/favorites_controller.rb \
        backend/spec/requests/api/favorites_spec.rb
git commit -m "$(cat <<'EOF'
feat: お気に入り登録 API（issue 5-2）

POST /api/posts/:post_id/favorite。冪等で、二重登録も並行リクエストの
競合も 200 で現状を返す。対象は Post.kept のみで、削除済み・存在しない ID は 404。

いいねと違い所有者チェックは入れない。お気に入りは公開も集計もされず順位にも
効かないため、自分のお題をストックするのは正当な使い方。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `DELETE /api/posts/:post_id/favorite`

解除側。ルートは Task 4 で `only: %i[create destroy]` として既に生えているので、コントローラのアクションと spec だけを足す。

**Files:**
- Modify: `backend/app/controllers/api/favorites_controller.rb`
- Test: `backend/spec/requests/api/favorites_spec.rb`（`describe "POST ..."` の後ろに追記）

**Interfaces:**
- Consumes: `Api::FavoritesController#favoritable_post`、`PostRendering#post_json`（Task 4 / Task 2）
- Produces: `DELETE /api/posts/:post_id/favorite` → `200 { "post": {...} }`（`favorited: false`）

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/favorites_spec.rb` の `describe "POST /api/posts/:post_id/favorite"` ブロックの `end` の後ろ、ファイル末尾の `end` の前に追記する。

```ruby
  describe "DELETE /api/posts/:post_id/favorite" do
    it "お気に入りを解除すると 200 と更新後のお題を返す" do
      create(:favorite, user: user, post: post_record)

      expect {
        delete "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json
      }.to change(Favorite, :count).by(-1)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["post"]).to include(
        "id" => post_record.id,
        "favorited" => false
      )
    end

    it "お気に入りしていなくても 200 を返し、何も消えない" do
      expect {
        delete "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json
      }.not_to change(Favorite, :count)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["post"]).to include("favorited" => false)
    end

    it "他人のお気に入りは消えない" do
      create(:favorite, user: user, post: post_record)
      create(:favorite, post: post_record)

      delete "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response.parsed_body["post"]).to include("favorited" => false)
      expect(Favorite.where(post: post_record).count).to eq(1)
    end

    # 解除は物理削除（CLAUDE.md の論理削除ルールの例外）。行を残すと
    # (user_id, post_id) の複合ユニークに引っかかり、同じお題をお気に入りし直せなくなる。
    it "解除したお題をもう一度お気に入りにできる" do
      create(:favorite, user: user, post: post_record)

      delete "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json
      post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["post"]).to include("favorited" => true)
    end

    # 削除済みのお題は POST と同じく 404。6-3 の /api/me/favorites は Post.kept で
    # 絞る想定なので、その行はどの画面にも出てこず、片付ける導線に意味がない。
    it "削除済みのお題には 404" do
      create(:favorite, user: user, post: post_record)
      post_record.discard!

      delete "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body).to eq("error" => "not_found")
    end

    it "存在しない ID は 404" do
      delete "/api/posts/0/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "未認証は 401" do
      delete "/api/posts/#{post_record.id}/favorite", as: :json

      expect(response).to have_http_status(:unauthorized)
    end
  end
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/favorites_spec.rb -e "DELETE /api/posts/:post_id/favorite"
```

Expected: FAIL。`destroy` アクションが無いため `AbstractController::ActionNotFound`（7 examples、未認証の 1 本を除く 6 本が失敗）

- [ ] **Step 3: `destroy` を実装する**

`backend/app/controllers/api/favorites_controller.rb` の `create` の直後、`private` の前に足す。

```ruby
    def destroy
      post = favoritable_post
      # 解除は物理削除。favorites には discarded_at が無く、行を残すと複合ユニークに
      # 引っかかって二度とお気に入りにし直せなくなる（CLAUDE.md の論理削除ルールの例外。
      # favorites は何からも参照されておらず、取り消しに記録を残す意味も無い）。
      #
      # お気に入りしていなければ何もしない（冪等）。
      current_user.favorites.find_by(post: post)&.destroy

      render json: { post: post_json(post) }
    end
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/favorites_spec.rb
```

Expected: PASS（18 examples, 0 failures）

- [ ] **Step 5: 全体と rubocop を通す**

```bash
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec rubocop
```

Expected: rspec は 0 failures、rubocop は `no offenses detected`

- [ ] **Step 6: コミット**

```bash
git add backend/app/controllers/api/favorites_controller.rb \
        backend/spec/requests/api/favorites_spec.rb
git commit -m "$(cat <<'EOF'
feat: お気に入り解除 API（issue 5-2）

DELETE /api/posts/:post_id/favorite。冪等で、お気に入りしていなくても 200。
解除は物理削除（複合ユニークと両立せず、行を残すとお気に入りし直せなくなる）。

削除済みのお題は POST と同じく 404。6-3 の /api/me/favorites は Post.kept で
絞る想定で、その行はどの画面にも出てこないため片付ける導線に意味がない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: ドキュメントを更新する

API 仕様と backlog の状態を実装に合わせる。コードは触らない。

**Files:**
- Modify: `docs/screen_and_api_design.md`（お気に入りの節）
- Modify: `docs/issues_backlog.md`（5-2 の節）

**Interfaces:**
- Consumes: Task 1〜5 で確定した API の振る舞い
- Produces: なし（ドキュメントのみ）

- [ ] **Step 1: `docs/screen_and_api_design.md` にお気に入り API の仕様を足す**

`### お気に入り（Favorite）` の表（`| DELETE | /api/posts/:id/favorite | お気に入り解除 |` の行）の直後、`### ランキング・マイページ・通報` の前に挿入する。いいねの節と同じ粒度で書く。

```markdown

- **どちらも冪等**。すでにお気に入り済みの `POST`、お気に入りしていない `DELETE` は
  エラーにせず、現在の状態を `200` で返す。二重登録は `favorites(user_id, post_id)` の
  複合ユニークインデックスが防ぐ。
- 応答は `{ "post": {...} }`（更新後の `favorited` を含む）。ボディを返すので
  `204` ではなく `200`。
- 対象は **`kept` のお題のみ**。削除済み・存在しない ID は `404`。お題には
  `published` に相当する状態が無いため、いいねのような二段構えの絞り込みは要らない。
- **自分のお題もお気に入りできる**（いいねと非対称）。お気に入りは公開されず集計もされず
  順位にも効かない自分だけのブックマークなので、セルフ登録を禁じる理由が無い。
- 解除は**物理削除**（`discard` を使わない）。行を残すと複合ユニークに引っかかり、
  同じお題をお気に入りし直せなくなる。
- **`favorites_count` は返さない**。何人がお気に入りしたかは公開しない。数を出すと
  事実上の公開シグナルになり、いいね（再現度への投票）と役割が重なる（5-4 の前提）。
- お題の応答に含まれる `favorited` は、**そのリクエストの本人**がお気に入り済みかどうか。
  未認証なら常に `false`。`liked` と同じく、お題を返す応答はユーザー依存になる。
- お気に入り**一覧**はここではなくマイページの `GET /api/me/favorites`（6-3）が担当する。
  `GET /api/posts?favorited=true` は作らない（一覧の口が二重になるため）。
```

- [ ] **Step 2: `docs/issues_backlog.md` の 5-2 を完了にする**

`### 🟢 5-2. お気に入り API` の節を次の内容に差し替える。

```markdown
### 🟢 5-2. お気に入り API
- 依存：3-2
- タスク：
  - [x] `POST/DELETE /api/posts/:id/favorite`（トグル、複合ユニーク）
  - [x] 冪等にする（二重登録・未登録の解除はエラーにせず 200 で現状を返す）
  - [x] お題の応答に `favorited`（本人がお気に入り済みか）を追加。一覧は 1 クエリで引き N+1 を避ける
  - [x] request spec / model spec
- 完了条件：お気に入りのオン/オフができる。
- 補足：**セルフお気に入りは禁止しない**（5-1 のいいねと非対称）。お気に入りは公開も集計も
  されず順位にも効かない自分だけのブックマークのため。**`favorites_count` は返さない**
  （数を出すといいねと役割が重なる。役割分担の判断は 5-4 の前提）。**解除は物理削除**
  （CLAUDE.md の論理削除ルールの例外）。冪等化の rescue は `IdempotentToggle` concern に
  切り出して 5-1 と共有した。
  設計は `docs/superpowers/specs/2026-08-15-issue-5-2-favorite-api-design.md`
```

- [ ] **Step 3: 差分を確認する**

```bash
git diff docs/
```

Expected: 上記 2 ファイルのみの変更。コードの差分が混ざっていないこと。

- [ ] **Step 4: コミット**

```bash
git add docs/screen_and_api_design.md docs/issues_backlog.md
git commit -m "$(cat <<'EOF'
docs: お気に入り API の仕様と 5-2 の完了を記録する（issue 5-2）

screen_and_api_design.md にいいねの節と同じ粒度で応答仕様を追記し、
issues_backlog.md の 5-2 を完了にした。5-1 と非対称な判断
（セルフ登録可・favorites_count を返さない）を補足に残す。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 完了後の確認

すべてのタスクが終わったら、PR を出す前に次を確認する。

- [ ] `docker compose exec backend bundle exec rspec` が green
- [ ] `docker compose exec backend bundle exec rubocop` が `no offenses detected`
- [ ] `docker compose exec backend bundle exec brakeman` に新規の警告が出ていない
- [ ] `docker compose up` でアプリが起動し、ブラウザ／curl から手で叩ける（`app/controllers/concerns/` は既存ディレクトリなので restart は不要だが、新しいコントローラが autoload されることを実際に確認する）

手での確認コマンド（`$TOKEN` はログインして得た `Authorization` ヘッダの値、`$POST_ID` は既存のお題の id）:

```bash
curl -i -X POST "http://localhost:3000/api/posts/$POST_ID/favorite" -H "Authorization: $TOKEN"
curl -s "http://localhost:3000/api/posts" -H "Authorization: $TOKEN" | jq '.posts[0].favorited'
curl -i -X DELETE "http://localhost:3000/api/posts/$POST_ID/favorite" -H "Authorization: $TOKEN"
```

期待値：POST が `200` で `"favorited": true`、一覧の `favorited` が `true`、DELETE が `200` で `"favorited": false`。

- [ ] プッシュ前に `/code-review` を通す（自己レビューだけでは自分の前提を疑えない）
- [ ] PR を出す。本番反映はマイルストーン 5 の区切りで行う（この PR では本番に出さない）
