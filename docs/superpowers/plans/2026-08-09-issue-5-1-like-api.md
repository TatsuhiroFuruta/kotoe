# issue 5-1 再現いいね API 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 挑戦（Attempt）への「再現いいね」を冪等にオン／オフできる `POST/DELETE /api/attempts/:attempt_id/like` を追加し、フロントがボタンの状態を描けるよう `liked` フィールドを返す。

**Architecture:** 専用の `Api::LikesController` を、attempts にネストした単数リソース（`resource :like`）として生やす。いいね済み判定は `Like.liked_attempt_ids`（id 集合に対する 1 クエリ）に寄せて N+1 を避ける。挑戦を JSON にする手順は `AttemptRendering` concern に切り出し、`AttemptsController` と `LikesController` で共有する。

**Tech Stack:** Ruby on Rails 8（API モード）、RSpec、FactoryBot、shoulda-matchers、PostgreSQL

**設計:** `docs/superpowers/specs/2026-08-09-issue-5-1-like-api-design.md`

## Global Constraints

- 作業ブランチは `feat/issue-5-1-like-api`（作成済み）。main へ直接コミットしない。
- 文字列は**ダブルクォート**（spec ファイルも含む）。`bundle exec rubocop` は `rubocop-rails-omakase` ベース。
- コミット前に `bundle exec rubocop` と `bundle exec rspec` を通す。
- **マイグレーションは無い。** `likes` テーブルは既存で、`(user_id, attempt_id)` に複合ユニークインデックスがある。`db:prepare` の再実行も不要。
- いいね解除は**物理削除**（`discard` を使わない）。CLAUDE.md の論理削除ルールの明示的な例外。理由は設計ドキュメント参照。
- エラーは**コード**を返す（文言は返さない）。i18n はフロントの責務。
- 見えないリソースは 403 ではなく **404** で存在ごと隠す。

## コマンド

```bash
docker compose up -d                                     # 未起動なら
docker compose exec backend bundle exec rspec            # 全体
docker compose exec backend bundle exec rspec spec/path  # 個別
docker compose exec backend bundle exec rubocop
```

以下の手順で `Run:` と書かれたコマンドは、すべて `docker compose exec backend` を前置して実行する。

## File Structure

| ファイル | 責務 |
|---|---|
| `backend/app/models/like.rb` | いいね済み判定のクエリ（`liked_attempt_ids`） |
| `backend/app/serializers/attempt_serializer.rb` | 挑戦 1 件の JSON 表現。`liked` を追加 |
| `backend/app/controllers/concerns/attempt_rendering.rb` | 挑戦を JSON にする手順の共有（新規） |
| `backend/app/controllers/api/likes_controller.rb` | いいねの HTTP 入出力（新規） |
| `backend/app/controllers/api/attempts_controller.rb` | concern を include、`attempt_json` を移譲 |
| `backend/app/controllers/api/posts_controller.rb` | お題詳細の挑戦一覧に `liked` を通す |
| `backend/config/routes.rb` | `resource :like` をネスト |

---

### Task 1: `Like.liked_attempt_ids`

いいね済み判定を 1 クエリで行うクラスメソッド。一覧で 1 件ずつ `exists?` を呼ぶと N+1 になるため、id 集合に対してまとめて引く。

**Files:**
- Modify: `backend/app/models/like.rb`
- Test: `backend/spec/models/like_spec.rb`（末尾の `end` の直前に追記）

**Interfaces:**
- Consumes: なし
- Produces: `Like.liked_attempt_ids(user, attempt_ids) -> Set<Integer>`
  - `user` は `User` または `nil`（未ログイン）
  - `attempt_ids` は `Integer` の配列
  - 戻り値は、そのユーザーがいいね済みの `attempt_id` だけを含む `Set`

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/models/like_spec.rb` の最後の `end`（`RSpec.describe` を閉じるもの）の直前に追記する。

```ruby
  describe ".liked_attempt_ids" do
    let(:user) { create(:user) }

    it "そのユーザーがいいね済みの挑戦 id だけを返す" do
      liked = create(:attempt, :published)
      not_liked = create(:attempt, :published)
      create(:like, user: user, attempt: liked)

      result = described_class.liked_attempt_ids(user, [ liked.id, not_liked.id ])

      expect(result).to eq(Set[liked.id])
    end

    it "他人のいいねは含めない" do
      attempt = create(:attempt, :published)
      create(:like, attempt: attempt)

      expect(described_class.liked_attempt_ids(user, [ attempt.id ])).to be_empty
    end

    it "未ログイン（user が nil）なら空集合" do
      attempt = create(:attempt, :published)
      create(:like, user: user, attempt: attempt)

      expect(described_class.liked_attempt_ids(nil, [ attempt.id ])).to be_empty
    end

    it "id が空なら空集合" do
      expect(described_class.liked_attempt_ids(user, [])).to be_empty
    end
  end
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `bundle exec rspec spec/models/like_spec.rb`
Expected: FAIL。`undefined method 'liked_attempt_ids' for class Like`（4 examples failed）

- [ ] **Step 3: 実装する**

`backend/app/models/like.rb` の `validates` の行の下に追記する（`end` の前）。

```ruby

  # 表示する挑戦のうち、そのユーザーがいいね済みのものを id の Set で返す。
  # 一覧で 1 件ずつ exists? を呼ぶと N+1 になるため、id 集合に対して 1 クエリで引く。
  # 未ログイン（user が nil）は常に空集合＝すべて false。
  def self.liked_attempt_ids(user, attempt_ids)
    return Set.new if user.nil? || attempt_ids.empty?

    where(user: user, attempt_id: attempt_ids).pluck(:attempt_id).to_set
  end
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `bundle exec rspec spec/models/like_spec.rb`
Expected: PASS（既存 5 examples ＋ 新規 4 examples、0 failures）

- [ ] **Step 5: rubocop を通す**

Run: `bundle exec rubocop app/models/like.rb spec/models/like_spec.rb`
Expected: no offenses

- [ ] **Step 6: コミット**

```bash
git add backend/app/models/like.rb backend/spec/models/like_spec.rb
git commit -m "feat: いいね済みの挑戦 id を 1 クエリで引く Like.liked_attempt_ids を足す"
```

---

### Task 2: `liked` フィールドを返す

`AttemptSerializer` に `liked` を必須キーワードで足し、既存の呼び出し 3 か所を更新する。あわせて `attempt_json` を concern に切り出す（Task 3 の `LikesController` が同じ処理を必要とするため）。

必須キーワードにしてデフォルト値を持たせないのは、既存の `attempt_json` のコメント「0 を直接埋めないのは、シリアライザの前提を1か所でも崩すと後で気づけなくなるため」と同じ方針。呼び出し漏れが `ArgumentError` として即座に出る。

**Files:**
- Create: `backend/app/controllers/concerns/attempt_rendering.rb`
- Modify: `backend/app/serializers/attempt_serializer.rb`
- Modify: `backend/app/controllers/api/attempts_controller.rb`
- Modify: `backend/app/controllers/api/posts_controller.rb`
- Test: `backend/spec/requests/api/posts_spec.rb`, `backend/spec/requests/api/attempts_spec.rb`

**Interfaces:**
- Consumes: `Like.liked_attempt_ids(user, attempt_ids) -> Set<Integer>`（Task 1）
- Produces:
  - `AttemptSerializer.call(attempt, liked:) -> Hash` — `liked:` は必須キーワード（真偽値）
  - `AttemptRendering#attempt_json(attempt) -> Hash` — private。`with_likes_count` で取り直してシリアライズする
  - `AttemptRendering#liked?(attempt) -> Boolean` — private

- [ ] **Step 1: 失敗するテストを書く（お題詳細）**

`backend/spec/requests/api/posts_spec.rb` の `RSpec.describe "GET /api/posts/:id"` 内、「認証なしでお題と挑戦一覧を取得できる」の `expect(response.parsed_body["attempts"].first).to eq(...)` のハッシュに `"liked" => false` を足す。`"likes_count" => 3,` の直後に置く。

```ruby
      "likes_count" => 3,
      "liked" => false,
```

同じ `describe` 内に、ログイン済みのケースを追記する。

```ruby
  it "ログインしていれば自分がいいねした挑戦だけ liked が true になる" do
    user = create(:user)
    token = sign_in_and_get_token(user)
    post_record = create(:post)
    liked = create(:attempt, :published, post: post_record)
    not_liked = create(:attempt, :published, post: post_record)
    create(:like, user: user, attempt: liked)

    get "/api/posts/#{post_record.id}", headers: auth_headers(token)

    liked_flags = response.parsed_body["attempts"].to_h { |a| [ a["id"], a["liked"] ] }
    expect(liked_flags).to eq(liked.id => true, not_liked.id => false)
  end
```

- [ ] **Step 2: 失敗するテストを書く（挑戦詳細・作成）**

`backend/spec/requests/api/attempts_spec.rb` を 2 か所修正する。

(a) `describe "POST /api/posts/:post_id/attempts"` の「下書きを作れる」の `include(...)` に `"liked" => false` を足す。`"likes_count" => 0,` の直後。

```ruby
        "likes_count" => 0,
        "liked" => false,
```

(b) `describe "GET /api/attempts/:id"` の「公開済みの挑戦は未認証でも取得でき、お題も一緒に返る」の `include(...)` に `"liked" => false` を足す。`"likes_count" => 2` の後ろ（カンマを足す）。

```ruby
        "likes_count" => 2,
        "liked" => false
```

さらに `describe "GET /api/attempts/:id"` 内に、いいね済みのケースを追記する。

```ruby
    it "自分がいいねしている挑戦は liked が true になる" do
      attempt = create(:attempt, :published, post: post_record)
      create(:like, user: user, attempt: attempt)

      get "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(response.parsed_body["attempt"]["liked"]).to be(true)
    end
```

- [ ] **Step 3: テストが落ちることを確認する**

Run: `bundle exec rspec spec/requests/api/posts_spec.rb spec/requests/api/attempts_spec.rb`
Expected: FAIL。既存の 2 例は `liked` キーが無いことによる差分、新規 2 例は `liked` が `nil` になる

- [ ] **Step 4: シリアライザに `liked` を足す**

`backend/app/serializers/attempt_serializer.rb` を、ファイル全体こう書き換える。

```ruby
# 挑戦 1 件の表現。お題詳細の挑戦一覧で使う（4-2 以降の挑戦 API でも使い回す）。
#
# likes_count は Attempt.with_likes_count が SELECT 句で付ける別名属性なので、
# そのスコープを通っていない Attempt を渡すと ActiveModel::MissingAttributeError になる。
#
# liked（そのリクエストの本人がいいね済みか）はキーワードを必須にしてある。
# デフォルト値を置くと、渡し忘れたときに黙って false が入り
# 「いいねしたのにハートが白いまま」になって気づけない。
class AttemptSerializer
  def self.call(attempt, liked:)
    {
      id: attempt.id,
      description: attempt.description,
      generated_image_public_id: attempt.generated_image_public_id,
      status: attempt.status,
      failure_reason: attempt.failure_reason,
      similarity_score: attempt.similarity_score,
      user: UserSerializer.public_profile(attempt.user),
      likes_count: attempt.likes_count,
      liked: liked,
      created_at: attempt.created_at.utc.iso8601
    }
  end
end
```

- [ ] **Step 5: concern を作る**

`backend/app/controllers/concerns/attempt_rendering.rb` を新規作成する。ディレクトリは既存なので、コンテナの restart は不要。

```ruby
# 挑戦を JSON にする手順の共有。AttemptsController と LikesController が使う。
module AttemptRendering
  extend ActiveSupport::Concern

  private

  # AttemptSerializer は with_likes_count が SELECT 句で付ける別名属性に依存している。
  # 新規・更新直後やいいねの増減後のレコードには乗っていないので、そのスコープ経由で取り直す。
  # 0 を直接埋めないのは、シリアライザの前提を1か所でも崩すと後で気づけなくなるため。
  def attempt_json(attempt)
    fresh = Attempt.includes(:user).with_likes_count.find(attempt.id)
    AttemptSerializer.call(fresh, liked: liked?(fresh))
  end

  # 単体の挑戦に対する判定。一覧は Like.liked_attempt_ids を直接呼んで 1 クエリにまとめる。
  def liked?(attempt)
    Like.liked_attempt_ids(current_user, [ attempt.id ]).include?(attempt.id)
  end
end
```

- [ ] **Step 6: `AttemptsController` を更新する**

`backend/app/controllers/api/attempts_controller.rb` を 3 か所変更する。

(a) クラス宣言の直後に include を足す。

```ruby
  class AttemptsController < ApplicationController
    include AttemptRendering

    # show だけ認証不要。公開済みの挑戦は誰でも見られる（共有用パーマリンク）。
    before_action :authenticate_user!, except: :show
```

(b) `show` を書き換える。

```ruby
    def show
      attempt = visible_attempt
      post = Post.kept.includes(:user).with_counts.find(attempt.post_id)

      render json: {
        attempt: AttemptSerializer.call(attempt, liked: liked?(attempt)),
        post: PostSerializer.call(post)
      }
    end
```

(c) private の `attempt_json` を、コメントごと削除する（concern に移った）。削除するのはこのブロック。

```ruby
    # AttemptSerializer は with_likes_count が SELECT 句で付ける別名属性に依存している。
    # 新規・更新直後のレコードには乗っていないので、そのスコープ経由で取り直す。
    # 0 を直接埋めないのは、シリアライザの前提を1か所でも崩すと後で気づけなくなるため。
    def attempt_json(attempt)
      AttemptSerializer.call(Attempt.includes(:user).with_likes_count.find(attempt.id))
    end
```

`create` / `update` / `generate` の `attempt_json(attempt)` 呼び出しはそのままでよい（concern の同名メソッドが使われる）。

- [ ] **Step 7: `PostsController#show` を更新する**

`backend/app/controllers/api/posts_controller.rb` の `show` を書き換える。

```ruby
    def show
      post = Post.kept.includes(:user).with_counts.find(params[:id])
      attempts = Attempt.listing_for(post).page(page_param)
      # 一覧ぶんのいいね済み判定を 1 クエリでまとめて引く（1 件ずつ引くと N+1 になる）。
      # 未ログインなら空集合が返り、すべて false になる。
      liked_ids = Like.liked_attempt_ids(current_user, attempts.map(&:id))

      render json: {
        post: PostSerializer.call(post),
        # 挑戦の並びは新着順で固定。いいね順（ベスト再現）は 6-1 で
        # ここに sort の分岐を足す。
        attempts: attempts.map { |attempt| AttemptSerializer.call(attempt, liked: liked_ids.include?(attempt.id)) },
        meta: PaginationSerializer.call(attempts)
      }
    end
```

- [ ] **Step 8: テストが通ることを確認する**

Run: `bundle exec rspec`
Expected: PASS（0 failures）。`ArgumentError: missing keyword: :liked` が出たら `AttemptSerializer.call` の呼び忘れが残っている

- [ ] **Step 9: rubocop を通す**

Run: `bundle exec rubocop`
Expected: no offenses

- [ ] **Step 10: コミット**

```bash
git add backend/app/serializers/attempt_serializer.rb \
        backend/app/controllers/concerns/attempt_rendering.rb \
        backend/app/controllers/api/attempts_controller.rb \
        backend/app/controllers/api/posts_controller.rb \
        backend/spec/requests/api/posts_spec.rb \
        backend/spec/requests/api/attempts_spec.rb
git commit -m "feat: 挑戦の応答に自分がいいね済みかを示す liked を足す"
```

---

### Task 3: `POST /api/attempts/:attempt_id/like`

いいねを付ける。冪等（すでにいいね済みでも 200）、自分の挑戦は 422、公開済み以外は 404。

**Files:**
- Modify: `backend/config/routes.rb`
- Create: `backend/app/controllers/api/likes_controller.rb`
- Test: `backend/spec/requests/api/likes_spec.rb`（新規）

**Interfaces:**
- Consumes: `AttemptRendering#attempt_json(attempt)`（Task 2）
- Produces: `Api::LikesController#create`、private の `likeable_attempt` / `render_error(code)`

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/likes_spec.rb` を新規作成する。

```ruby
require "rails_helper"

RSpec.describe "再現いいね API", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }
  # いいねできるのは他人の公開済みの挑戦。
  let(:attempt) { create(:attempt, :published) }

  describe "POST /api/attempts/:attempt_id/like" do
    it "いいねすると 200 と更新後の挑戦を返す" do
      expect {
        post "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json
      }.to change(Like, :count).by(1)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]).to include(
        "id" => attempt.id,
        "likes_count" => 1,
        "liked" => true
      )
    end

    it "二重にいいねしても増えず、200 を返す" do
      create(:like, user: user, attempt: attempt)

      expect {
        post "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json
      }.not_to change(Like, :count)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]).to include("likes_count" => 1, "liked" => true)
    end

    it "自分の挑戦には 422 と cannot_like_own_attempt を返す" do
      own = create(:attempt, :published, user: user)

      expect {
        post "/api/attempts/#{own.id}/like", headers: auth_headers(token), as: :json
      }.not_to change(Like, :count)

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("error" => "cannot_like_own_attempt")
    end

    it "下書きには 404" do
      draft = create(:attempt)

      post "/api/attempts/#{draft.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body).to eq("error" => "not_found")
    end

    it "生成中には 404" do
      generating = create(:attempt, :generating)

      post "/api/attempts/#{generating.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "失敗した挑戦には 404" do
      failed = create(:attempt, :failed)

      post "/api/attempts/#{failed.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "削除済みの挑戦には 404" do
      attempt.discard!

      post "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "存在しない ID は 404" do
      post "/api/attempts/0/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "未認証は 401" do
      post "/api/attempts/#{attempt.id}/like", as: :json

      expect(response).to have_http_status(:unauthorized)
    end

    # 並行リクエストの再現は request spec では作れないため、ここだけ例外をスタブして
    # rescue 節が生きていることを確かめる。DB 制約とアプリ側の uniqueness バリデーションの
    # どちらが先に当たるかは競合相手がコミット済みかどうかで変わるので、両方を見る。
    it "DB 制約の競合（RecordNotUnique）でも 200 を返す" do
      allow_any_instance_of(ActiveRecord::Associations::CollectionProxy)
        .to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordNotUnique)

      post "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:ok)
    end

    it "バリデーションの競合（RecordInvalid）でも 200 を返す" do
      allow_any_instance_of(ActiveRecord::Associations::CollectionProxy)
        .to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordInvalid.new(Like.new))

      post "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:ok)
    end
  end
end
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `bundle exec rspec spec/requests/api/likes_spec.rb`
Expected: FAIL。ルーティングが無いため `ActionController::RoutingError`（11 examples failed）

- [ ] **Step 3: ルーティングを足す**

`backend/config/routes.rb` の `resources :attempts` ブロックを書き換える。

```ruby
    # 挑戦（issue 4-2）。閲覧（show）だけ認証不要で、公開済み以外は本人にしか見えない。
    resources :attempts, only: %i[show update destroy] do
      post :generate, on: :member

      # 再現いいね（issue 5-1）。単数リソースなので /api/attempts/:attempt_id/like の
      # 1 パスに POST（いいね）と DELETE（解除）が生える。
      resource :like, only: %i[create destroy]
    end
```

- [ ] **Step 4: コントローラを作る**

`backend/app/controllers/api/likes_controller.rb` を新規作成する。この時点では `destroy` は書かない（Task 4）。

```ruby
module Api
  # 再現いいね（Like）。トグルは冪等で、同じリクエストを何度送っても状態が変わらない。
  # POST は「この挑戦を、自分がいいねしている状態にせよ」という意味になる。
  class LikesController < ApplicationController
    include AttemptRendering

    before_action :authenticate_user!

    def create
      attempt = likeable_attempt
      # いいねは再現度への投票で、ベスト再現（6-1）と全体ランキング（6-2）の順位を
      # 直接決める。自分で自分に投票できると同着が自票で覆る。
      return render_error("cannot_like_own_attempt") if attempt.user_id == current_user.id

      current_user.likes.find_or_create_by!(attempt: attempt)
      render json: { attempt: attempt_json(attempt) }
    rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotUnique
      # 並行リクエストが先に作っていた場合。競合相手の INSERT がコミット済みなら
      # uniqueness バリデーションが（RecordInvalid）、まだ進行中なら複合ユニーク
      # インデックスが（RecordNotUnique）検知する。どちらも最終状態は要求どおり
      # 「いいね済み」なので成功として扱う。rescue しないと同時クリックで 500 になる。
      render json: { attempt: attempt_json(attempt) }
    end

    private

    # いいねできるのは公開済みの挑戦だけ。下書き・生成中・失敗・削除済み・存在しない ID は
    # すべて RecordNotFound → 404 になる。403 と分けないのは、他人の下書きの存在を
    # 漏らさないため（AttemptsController#visible_attempt と同じ方針）。
    def likeable_attempt
      Attempt.kept.published.find(params[:attempt_id])
    end

    def render_error(code)
      render json: { error: code }, status: :unprocessable_content
    end
  end
end
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `bundle exec rspec spec/requests/api/likes_spec.rb`
Expected: PASS（11 examples, 0 failures）

- [ ] **Step 6: 全体のテストと rubocop を通す**

Run: `bundle exec rspec && bundle exec rubocop`
Expected: どちらも 0 failures / no offenses

- [ ] **Step 7: コミット**

```bash
git add backend/config/routes.rb \
        backend/app/controllers/api/likes_controller.rb \
        backend/spec/requests/api/likes_spec.rb
git commit -m "feat: 挑戦にいいねする POST /api/attempts/:id/like を足す"
```

---

### Task 4: `DELETE /api/attempts/:attempt_id/like`

いいねを解除する。冪等（いいねしていなくても 200）、物理削除。

**Files:**
- Modify: `backend/app/controllers/api/likes_controller.rb`
- Test: `backend/spec/requests/api/likes_spec.rb`

**Interfaces:**
- Consumes: `AttemptRendering#attempt_json(attempt)`（Task 2）、`Api::LikesController#likeable_attempt`（Task 3）
- Produces: `Api::LikesController#destroy`

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/likes_spec.rb` の `describe "POST ..."` ブロックを閉じた直後（一番外側の `end` の直前）に追記する。

```ruby
  describe "DELETE /api/attempts/:attempt_id/like" do
    it "いいねを解除すると 200 と更新後の挑戦を返す" do
      create(:like, user: user, attempt: attempt)

      expect {
        delete "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json
      }.to change(Like, :count).by(-1)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]).to include(
        "id" => attempt.id,
        "likes_count" => 0,
        "liked" => false
      )
    end

    it "いいねしていなくても 200 を返し、何も消えない" do
      expect {
        delete "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json
      }.not_to change(Like, :count)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]).to include("likes_count" => 0, "liked" => false)
    end

    it "他人のいいねは消えない" do
      create(:like, user: user, attempt: attempt)
      create(:like, attempt: attempt)

      delete "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json

      expect(response.parsed_body["attempt"]).to include("likes_count" => 1, "liked" => false)
      expect(Like.where(attempt: attempt).count).to eq(1)
    end

    it "下書きには 404" do
      draft = create(:attempt)

      delete "/api/attempts/#{draft.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "削除済みの挑戦には 404" do
      attempt.discard!

      delete "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "存在しない ID は 404" do
      delete "/api/attempts/0/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "未認証は 401" do
      delete "/api/attempts/#{attempt.id}/like", as: :json

      expect(response).to have_http_status(:unauthorized)
    end
  end
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `bundle exec rspec spec/requests/api/likes_spec.rb -e "DELETE"`
Expected: FAIL。`The action 'destroy' could not be found for Api::LikesController`（7 examples failed）

- [ ] **Step 3: `destroy` を実装する**

`backend/app/controllers/api/likes_controller.rb` の `create` の `end`（`rescue` 節を含むメソッド全体の終わり）と `private` の間に追記する。

```ruby

    def destroy
      attempt = likeable_attempt
      # 解除は物理削除。likes には discarded_at が無く、行を残すと複合ユニークに
      # 引っかかって二度といいねし直せなくなる（CLAUDE.md の論理削除ルールの例外。
      # likes は何からも参照されておらず、取り消しに記録を残す意味も無い）。
      # いいねしていなければ何もしない（冪等）。
      current_user.likes.find_by(attempt: attempt)&.destroy

      render json: { attempt: attempt_json(attempt) }
    end
```

自分の挑戦への DELETE を 422 にしないのは、セルフいいねを禁じている以上「いいねしていない状態」で確定しており、冪等な DELETE の定義どおり現状を返せばよいため。ここだけ 422 にすると POST と非対称になる。

- [ ] **Step 4: テストが通ることを確認する**

Run: `bundle exec rspec spec/requests/api/likes_spec.rb`
Expected: PASS（18 examples, 0 failures）

- [ ] **Step 5: 全体のテストと rubocop を通す**

Run: `bundle exec rspec && bundle exec rubocop`
Expected: どちらも 0 failures / no offenses

- [ ] **Step 6: コミット**

```bash
git add backend/app/controllers/api/likes_controller.rb backend/spec/requests/api/likes_spec.rb
git commit -m "feat: いいねを解除する DELETE /api/attempts/:id/like を足す"
```

---

### Task 5: ドキュメント更新

API 仕様・backlog・CLAUDE.md を実装に合わせる。物理削除は必守ルールの例外なので、CLAUDE.md 側に但し書きを残さないと次に読んだときに矛盾に見える。

**Files:**
- Modify: `docs/screen_and_api_design.md`
- Modify: `docs/issues_backlog.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 1〜4 の実装結果
- Produces: なし（ドキュメントのみ）

- [ ] **Step 1: API 仕様を追記する**

`docs/screen_and_api_design.md` の「### 再現いいね（Like）」の表の直後（次の「### お気に入り（Favorite）」の前）に追記する。

```markdown
- **どちらも冪等**。すでにいいね済みの `POST`、いいねしていない `DELETE` はエラーにせず、
  現在の状態を `200` で返す（ボタン連打・通信リトライ・別タブとの状態ズレで無意味なエラーを出さない）。
  二重いいねは `likes(user_id, attempt_id)` の複合ユニークインデックスが防ぐ。
- 応答は `{ "attempt": {...} }`（更新後の `likes_count` と `liked` を含む）。ボディを返すので
  `204` ではなく `200`。
- 対象は **`kept` かつ `published`** の挑戦のみ。下書き・生成中・失敗・削除済み・存在しない ID は
  すべて `404`（403 にせず存在ごと隠す）。
- **自分の挑戦にはいいねできない**。`422 { "error": "cannot_like_own_attempt" }`。
  いいねはベスト再現（6-1）と全体ランキング（6-2）の順位を決める投票のため。
- 解除は**物理削除**（`discard` を使わない）。行を残すと複合ユニークに引っかかり、
  同じ挑戦にいいねし直せなくなる。
- 挑戦の応答に含まれる `liked` は、**そのリクエストの本人**がいいね済みかどうか。
  未認証なら常に `false`。**誰がいいねしたかは公開しない**（一覧 API も通知も持たない。5-5 で検討）。
```

- [ ] **Step 2: backlog の 5-1 を完了にする**

`docs/issues_backlog.md` の「### 🟢 5-1. 再現いいね API」のブロックを、まるごとこう置き換える。

```markdown
### 🟢 5-1. 再現いいね API
- 依存：4-2
- タスク：
  - [x] `POST/DELETE /api/attempts/:id/like`（トグル、複合ユニーク）
  - [x] 冪等にする（二重いいね・未いいねの解除はエラーにせず 200 で現状を返す）
  - [x] セルフいいねの禁止（422 `cannot_like_own_attempt`）
  - [x] 挑戦の応答に `liked`（本人がいいね済みか）を追加。一覧は 1 クエリで引き N+1 を避ける
  - [x] request spec / model spec
- 完了条件：いいねのオン/オフができ、二重いいねが防止される。
- 補足：**いいね解除は物理削除**（CLAUDE.md の論理削除ルールの例外。複合ユニークと両立せず、
  行を残すといいねし直せなくなる）。**誰がいいねしたかは公開せず、通知もしない**（5-5 で検討）。
  設計は `docs/superpowers/specs/2026-08-09-issue-5-1-like-api-design.md`
```

- [ ] **Step 3: backlog に 5-5 を追記する**

`docs/issues_backlog.md` の「### 🔵 5-4. 挑戦のお気に入り（本リリースで検討）」の完了条件の行の後、マイルストーン6 の前にある `---` の直前に追記する。

```markdown
### 🔵 5-5. いいねの可視化と通知（本リリースで検討）
- 背景：MVP のいいねは合計数（`likes_count`）と自分の状態（`liked`）だけを返し、
  **誰がいいねしたかは公開しない・通知もしない**（設計判断は
  `docs/superpowers/specs/2026-08-09-issue-5-1-like-api-design.md`）。
  挑戦者は自分の再現に誰が反応したかを知る手段が無い。ここでそれを扱う。
- 依存：5-1
- 前提（先に決めること）：**いいねした人を公開してよいか**。これが No なら通知も不要になるため、
  先にこの製品判断を行う。
  - 公開する利点：反応が見えて挑戦の動機になる。挑戦者と描写者の交流が生まれる。
  - 公開しない利点：いいねが「再現度への投票」として機能する（忖度が入らない）。
    押した側が名前を出さずに済む。ランキング（6-1 / 6-2）の質に直結する。
  - 折衷案：通知だけ行い、一覧は公開しない（挑戦者本人にのみ「誰が」を見せる）。
- タスク：
  - [ ] `GET /api/attempts/:id/likes`（いいねしたユーザー一覧、kaminari）※公開する判断の場合
  - [ ] 通知の記録（新しいいいねを挑戦者に伝える）とその既読管理
  - [ ] 通知の配信手段（画面内のベルアイコンのみか、メールも出すか）
- 完了条件：決めた公開範囲に沿って、いいねの反応を挑戦者が確認できる。
- 補足：データは残っている。`likes` は解除時に物理削除するが、消えるのは「解除されたいいね」だけで、
  生きているいいねの `user_id` と `created_at` は保持される。後から一覧も通知も組み立てられる。
```

- [ ] **Step 4: CLAUDE.md に但し書きを足す**

`CLAUDE.md` の「### Rails（backend/）」にある論理削除の行を、こう置き換える。

置換前:

```markdown
- 論理削除は必ず `discard` を使う（`discarded_at`）。**物理削除しない**（他テーブルからの参照が壊れるため）。通常のクエリは `kept` スコープで未削除を対象にする。
```

置換後:

```markdown
- 論理削除は必ず `discard` を使う（`discarded_at`）。**物理削除しない**（他テーブルからの参照が壊れるため）。通常のクエリは `kept` スコープで未削除を対象にする。
  - **例外：トグル用の中間テーブル（`likes` / `favorites`）は物理削除する。** 理由は3つ。(1) `(user_id, attempt_id)` の複合ユニーク制約と両立せず、行を残すと同じ対象にいいね／お気に入りをし直せなくなる。(2) これらのテーブルには `discarded_at` が無く、`has_many ..., dependent: :destroy` も物理削除前提で書かれている。(3) 何からも参照されておらず、「取り消し」に記録を残す意味が無いため、上のルールの趣旨（参照が壊れる）が当てはまらない。
```

- [ ] **Step 5: コミット**

```bash
git add docs/screen_and_api_design.md docs/issues_backlog.md CLAUDE.md
git commit -m "docs: いいね API の仕様と、トグル用中間テーブルの物理削除を記録する"
```

---

### Task 6: 最終確認とレビュー

**Files:** なし（検証のみ）

- [ ] **Step 1: 全テストと rubocop**

Run: `bundle exec rspec && bundle exec rubocop`
Expected: 0 failures / no offenses。実際の出力を確認してから green と report すること

- [ ] **Step 2: brakeman**

Run: `bundle exec brakeman -q --no-pager`
Expected: 0 security warnings

- [ ] **Step 3: ローカルでブラウザ／curl から確認する**

`docker compose up` した状態で、実際に叩いて確認する。ユーザー2人ぶんのトークンが要る（自分の挑戦にはいいねできないため）。

```bash
# 挑戦者としてログイン → 公開済みの挑戦を1つ作る（または既存のものを使う）
# 別ユーザーでログインしてトークンを取り、その挑戦にいいねする
curl -i -X POST http://localhost:3000/api/attempts/1/like -H "Authorization: Bearer <token>"
curl -i -X POST http://localhost:3000/api/attempts/1/like -H "Authorization: Bearer <token>"   # 2回目も 200、likes_count は変わらない
curl -i -X DELETE http://localhost:3000/api/attempts/1/like -H "Authorization: Bearer <token>"
curl -i -X DELETE http://localhost:3000/api/attempts/1/like -H "Authorization: Bearer <token>"  # 2回目も 200
curl -s http://localhost:3000/api/posts/1 | jq '.attempts[] | {id, likes_count, liked}'          # 未認証は liked が false
```

- [ ] **Step 4: `/code-review` を通す**

プッシュ前に独立レビューを挟む。指摘があれば対応してから次へ進む。

- [ ] **Step 5: プッシュして PR を作る**

```bash
git push -u origin feat/issue-5-1-like-api
gh pr create --title "feat: 再現いいね API（issue 5-1）" --body "..."
```

PR 本文には次を書く。
- 追加した2本のエンドポイントと応答（200 / 422 / 404）
- **冪等にした理由**（連打・リトライ・別タブの状態ズレ）
- **いいね解除を物理削除にした理由**と、CLAUDE.md に但し書きを足したこと
- `AttemptSerializer.call` のシグネチャを変えた（`liked:` が必須）こと
- 誰がいいねしたかは公開せず、5-5 として backlog に積んだこと

---

## Self-Review

**1. Spec coverage**

| 設計ドキュメントの項目 | 対応するタスク |
|---|---|
| 応答は `{ "attempt": {...} }`、200 | Task 3 / 4 |
| 対象は `kept` かつ `published`、それ以外 404 | Task 3 Step 4（`likeable_attempt`）、Task 3/4 の 404 テスト |
| セルフいいね禁止（422） | Task 3 |
| 冪等（POST / DELETE 両方） | Task 3 Step 1、Task 4 Step 1 |
| 並行リクエストの rescue（2 例外） | Task 3 Step 1 の最後 2 例、Step 4 の rescue |
| いいね解除は物理削除 | Task 4 Step 3、Task 5 Step 4（CLAUDE.md） |
| 誰がいいねしたかは非公開・通知なし | Task 5 Step 3（5-5 として記録） |
| `liked` フィールド | Task 2 |
| ルーティング（ネストした単数リソース） | Task 3 Step 3 |
| `AttemptRendering` concern | Task 2 Step 5 |
| `Like.liked_attempt_ids` | Task 1 |
| テスト（request / model / 既存更新） | Task 1、2、3、4 |
| 変更ファイル一覧の全項目 | 全タスクで網羅 |

漏れなし。

**2. Placeholder scan**

コード step にはすべて実際のコードがある。「適切なエラーハンドリングを追加」のような指示は無い。Task 6 Step 5 の PR 本文だけ `--body "..."` としているが、直後に書くべき内容を箇条書きで示してある。

**3. Type consistency**

- `Like.liked_attempt_ids(user, attempt_ids) -> Set` … Task 1 で定義、Task 2 Step 5（concern の `liked?`）と Step 7（`PostsController#show`）で使用。引数の順序・型とも一致。
- `AttemptSerializer.call(attempt, liked:)` … Task 2 Step 4 で定義、Step 5・6・7 の 3 呼び出し箇所すべてで `liked:` を渡している。
- `attempt_json(attempt)` … Task 2 Step 5 で concern に定義、Task 3 Step 4 と Task 4 Step 3 で使用。`AttemptsController` の `create` / `update` / `generate` は既存の呼び出しがそのまま concern 版に解決される。
- `likeable_attempt` … Task 3 Step 4 で定義、Task 4 Step 3 で使用。
- `render_error(code)` … Task 3 Step 4 で定義（引数1つ）。`AttemptsController` の同名メソッドは `(code, extra = {})` だが別クラスなので衝突しない。
