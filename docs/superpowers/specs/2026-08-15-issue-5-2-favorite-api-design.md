# issue 5-2 お気に入り API 設計

- 対象 issue：`docs/issues_backlog.md` 5-2
- 依存：3-2（お題の CRUD）
- 作成日：2026-08-15
- 前提：`docs/superpowers/specs/2026-08-09-issue-5-1-like-api-design.md`（同型のトグル API）

## この issue で作るもの

`POST/DELETE /api/posts/:post_id/favorite`。お題（Post）への「お気に入り」をオン／オフする。

モデル層は追加しない。マイルストーン1で `favorites` テーブル（`(user_id, post_id)` の複合ユニークインデックス付き）、`Favorite` モデル、factory、model spec が作られている。この issue で足りないのは HTTP の入口と、フロントがボタンの状態を描くための `favorited` フィールド。

マイグレーションは無い。DB は変更しない。

**5-1 の写しではあるが、同一ではない。** 判断が分かれるのは「セルフ登録の可否」「対象の絞り込み」「集計値を返すか」の3点で、いずれも**いいね＝公開の投票／お気に入り＝自分だけのブックマーク**という役割の違いから来る。後述の「5-1 と異なる点」にまとめた。

## エンドポイント仕様

### `POST /api/posts/:post_id/favorite`

認証必須。

| 状況 | 応答 |
|---|---|
| 未登録 → お気に入り成立 | `200` `{ "post": {...} }`（`favorited: true`） |
| すでにお気に入り済み | `200` 同じ内容（DB は変化なし） |
| **自分のお題** | **`200`（禁止しない）** |
| 削除済み・存在しない ID | `404` `{ "error": "not_found" }` |
| 未認証 | `401` |

### `DELETE /api/posts/:post_id/favorite`

認証必須。

| 状況 | 応答 |
|---|---|
| お気に入り済み → 解除 | `200` `{ "post": {...} }`（`favorited: false`） |
| お気に入りしていない | `200` 同じ内容（DB は変化なし） |
| 削除済み・存在しない ID | `404` |
| 未認証 | `401` |

## 5-1 と異なる点

同型の API なので、まず**違うところ**を先に置く。5-1 をなぞって書くと間違える箇所がここに集まっている。

| | 5-1 いいね（Attempt） | 5-2 お気に入り（Post） |
|---|---|---|
| 自分のリソース | `422 cannot_like_own_attempt` | **許可（200）** |
| 対象の絞り込み | `kept` かつ `published`、**お題も `kept`** | `kept` のみ |
| 集計値を返すか | `likes_count` を返す | **`favorites_count` は返さない** |
| 一覧の口 | 6-1 / 6-2（ランキング） | 6-3（`/api/me/favorites`） |

### セルフお気に入りは禁止しない

いいねは「再現度」への投票で、ベスト再現（6-1）と全体ランキング（6-2）の順位を直接決める。自分で自分に投票できると同着が自票で覆るため 422 で禁止した。

お気に入りにはこの構造が無い。**公開されず、集計もされず、順位にも効かない**。自分だけのブックマークなので、自分が出したお題を後で見返すためにストックするのは正当な使い方であり、むしろ塞ぐほうが不自然になる。所有者チェックは入れない。

この判断は「お気に入りを公開しない」ことに依存している。将来お気に入り数を公開したり順位に使う場合は、5-1 と同じ理由でセルフ登録の可否を再検討すること。

### 対象は `kept` のお題のみ（`published` 相当の条件は無い）

`Post.kept.find(params[:post_id])` の一撃で絞る。削除済み・存在しない ID は `RecordNotFound` → 404。

5-1 が `joins(:post).merge(Post.kept)` まで見たのは、`Post#discard` が挑戦にカスケードせず、挑戦だけを見ると読み取り API から辿れないのに書き込めてしまうためだった。お気に入りの対象は Post そのものなので、この二段構えは要らない。

お題には `published` に相当する状態が無い（投稿された時点で公開）。`PostsController#destroy` が `current_user.posts.kept.find` を使っているのと同じ絞り方になる。

### `favorites_count` は返さない

`PostSerializer` は `attempts_count` と `likes_count` を返しているが、`favorites_count` は足さない。

お気に入りは**自分だけのブックマーク**で、何人がお気に入りしたかは誰にも見せない。数を返すと、それは事実上の公開シグナルになり、いいね（再現度への投票）と役割が重なる。5-4 が「いいねとお気に入りの役割分担を先に決める」を前提に置いているのは、まさにこの線引きの話。ここで数を出すと、その判断を先取りして潰すことになる。

集計を返さないので `Post.with_counts` は変更しない（相関サブクエリを1本増やす必要がない）。

## 決めたこと

### 応答は `{ "post": {...} }`

5-1 と同じ形にする。`Favorite` レコードそのもの（id / user_id / post_id）を返しても画面は更新できない。フロントが必要なのは更新後の `favorited` で、これは `Favorite` の属性ではなくリクエスト本人との関係だから。

`index` / `show` / `create` と同じ `PostSerializer` の形が返るので、フロントは返ってきた post でカードを差し替えるだけで済む。ボディを返す以上ステータスは `204` ではなく `200`。

`attempts_count` / `likes_count` は `Post.with_counts` が SELECT 句で付ける別名属性なので、そのスコープ経由で取り直してからシリアライズする（`PostsController#create` が既にやっていること）。

### 冪等にする

`POST` を「お気に入りレコードを新規作成せよ」ではなく「**このお題を、自分がお気に入りしている状態にせよ**」という命令として解釈する。すでにその状態なら DB は変わらないが、エラーではなく 200 で現在の post を返す。`DELETE` も同様。

厳密にエラー（422 `already_favorited` / 404）にする案は採らない。ボタン連打・通信リトライ・別タブとの状態ズレのたびにエラーが返り、フロントに「このエラーコードだけは握りつぶす」分岐と辞書エントリが必要になる。

issue の完了条件「お気に入りのオン/オフができる」は、`favorites` に2行できないことで満たす。これは複合ユニークインデックスが保証しており、冪等かどうかとは独立している。

### 並行リクエストは rescue して成功扱い

5-1 と同じ構造。`find_or_create_by!` の SELECT と INSERT の間に別リクエストが割り込むと例外になる。rescue して 200 にする。

**捕まえる例外は2つ。** `Favorite` には DB の複合ユニークインデックスと、`validates :user_id, uniqueness: { scope: :post_id }` のアプリ側バリデーションの両方がある。どちらが先に当たるかは競合相手の状態で変わる。

- 競合相手の INSERT が**コミット済み** → バリデーションが検知 → `ActiveRecord::RecordInvalid`
- 競合相手の INSERT が**まだ進行中** → バリデーションは通過し、DB 制約が検知 → `ActiveRecord::RecordNotUnique`

`RecordInvalid` はまとめて握り潰さず、**重複だけ**を成功に読み替える。将来 `Favorite` にバリデーションが増えたとき、弾かれたお気に入りが 200 と `favorited: false` で返り、エラーコードも出ないままフロントが失敗に気づけなくなるため。

エラーの形は `Like` と完全に同一（`errors` の attribute が `:user_id`、type が `:taken`）。スコープが `attempt_id` か `post_id` かはエラーに現れない。この一致が、次項の concern 切り出しの前提になっている。

### お気に入り解除は物理削除（CLAUDE.md の例外）

CLAUDE.md の「論理削除は必ず `discard`」には従わない。5-1 で追記した但し書き（トグル用の中間テーブルは物理削除する）が `favorites` を名指しで含んでおり、この issue はその既定に乗るだけ。CLAUDE.md 側の追記は不要。

理由も同じ3点。(1) 行を残すと `(user_id, post_id)` の複合ユニークに引っかかり、同じお題をお気に入りし直せない。(2) `favorites` に `discarded_at` カラムが無く、`Post` / `User` の `has_many :favorites, dependent: :destroy` も物理削除前提。(3) `favorites` を参照しているテーブルは無く、取り消しに記録を残す意味がない。

### 削除済みのお題は `POST` も `DELETE` も 404

`DELETE` だけ通す案（お題が消えたあとも自分のお気に入りを片付けられるようにする）は採らない。

issue 4-4 の案A は「削除済みのお題にぶら下がる**自分の下書き**は `DELETE` を許す」だが、あれは**マイページの下書きタブに見えている**データの話で、片付ける動機がある。お気に入りは違う。6-3 の `/api/me/favorites` は `Post.kept` で絞る想定なので、削除済みのお題のお気に入りは**どの画面にも出てこない**。ユーザーから見えず、集計もされず、順位にも効かない行を消す導線に意味がない。

`POST` と `DELETE` で対象の絞り方が同じになるぶん、コントローラも単純になる（`before_action` 1本で済む）。

将来 `/api/me/favorites` に削除済みのお題を「削除されました」として表示する判断をするなら、そのときに `DELETE` を開ければよい。順序としてはそちらが先。

### `favorited` フィールドを 5-2 に含める

現在の `PostSerializer` は `attempts_count` / `likes_count` しか返さないため、お気に入りボタンを塗りつぶすか白抜きにするかをフロントが決められない。お題一覧（7-3）とお題詳細（7-4）はどちらもこの情報を必要とする。

`PostSerializer` は `PostsController` の `index` / `show` / `create` と、`AttemptsController#show`（比較ビュー用に post を同梱している）の**4経路**で共有されている。後の issue に回すと、その4経路と2本の request spec をもう一度触ることになり、作業量は変わらないまま PR が2回に分かれる。5-1 で `liked` を同じ PR に入れたのと揃える。

一覧の絞り込み（`GET /api/posts?favorited=true`）は**作らない**。お気に入り一覧はマイページの機能で、`docs/screen_and_api_design.md` は `GET /api/me/favorites`（6-3）を担当と定めている。両方作ると、同じ「お気に入りしたお題の一覧」を返す口が2本になり、ページネーションと並び順の仕様を二重に持つことになる。

### 冪等化の rescue を concern に切り出す

`LikesController#create` の rescue 2本と `duplicate_only?` は、`FavoritesController` でもそのまま必要になる。前述のとおりエラーの形まで同一なので、コメント込みで約30行がそっくり複製される。

`app/controllers/concerns/idempotent_toggle.rb` に切り出して両者で共有する。5-4（挑戦のお気に入り）で3つ目のトグルが来ることも見込んでいる。

```ruby
# トグル（いいね／お気に入り）の ON を冪等にする。
# 「作成せよ」ではなく「その状態にせよ」という命令として扱い、すでにその状態でも、
# 並行リクエストと競合しても、成功としてブロックを実行する。
module IdempotentToggle
  extend ActiveSupport::Concern

  private

  def toggle_on(association, target)
    begin
      association.find_or_create_by!(target)
    rescue ActiveRecord::RecordNotUnique
      nil
    rescue ActiveRecord::RecordInvalid => e
      return render_validation_errors(e.record) unless duplicate_only?(e.record)
    end

    yield
  end

  def duplicate_only?(record)
    record.errors.any? &&
      record.errors.all? { |error| error.attribute == :user_id && error.type == :taken }
  end
end
```

呼び出し側は「成功したら何を返すか」だけを書く。

```ruby
toggle_on(current_user.favorites, post: post) do
  render json: { post: post_json(post) }
end
```

`rescue` の範囲は `find_or_create_by!` だけに閉じ、`yield` はメソッドの末尾に 1 回だけ置く。メソッド全体を `rescue` して各節で `yield` する書き方（5-1 の `LikesController` がそうだった）は、ブロック自身がこの 2 つの例外を投げたときに二重に描画され、`AbstractController::DoubleRenderError` が元の原因を覆い隠す。現在のブロックは読み取りしかしないので到達しないが、3 つ目のトグル（5-4）が来る共有部品でこの形を残す理由が無い。

マージ済みの `LikesController` に手を入れることになるが、`likes_spec.rb` の並行競合テストは `CollectionProxy#find_or_create_by!` をスタブしており、呼び出し場所が concern に移っても効き続ける（あの spec のコメントが「このリクエストで `find_or_create_by!` を呼ぶのが1か所しかないことに依存している」と断っている条件は維持される）。

`Favorites::Toggle` のようなサービスオブジェクトは挟まない。ロジックが `find_or_create_by!` / `find_by&.destroy` しかなく、間接参照が増えるだけ（5-1 と同じ判断）。

## 実装の構え

### ルーティング

```ruby
resources :posts, only: %i[index create show destroy] do
  resources :attempts, only: %i[create]
  resource :favorite, only: %i[create destroy]   # /api/posts/:post_id/favorite
end
```

ネストした単数リソースにすると `docs/screen_and_api_design.md` のパスとそのまま一致し、`attempts` にネストした `resource :like` と対称になる。

`PostsController` に `favorite` / `unfavorite` を足す案は採らない。「お題の管理」と「お気に入り」で責務が混ざる（5-1 と同じ判断）。

### `Api::FavoritesController`（新規）

```ruby
module Api
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

    def destroy
      post = favoritable_post
      current_user.favorites.find_by(post: post)&.destroy
      render json: { post: post_json(post) }
    end

    private

    def favoritable_post = Post.kept.find(params[:post_id])
  end
end
```

所有者チェックが無いぶん、`LikesController` より短くなる。

### `PostRendering`（新規 concern）

`PostsController#create` は「`with_counts` 経由で取り直してシリアライズ」を既にやっており、`FavoritesController` も同じものを必要とする。`AttemptRendering` と同じ構えで切り出す。

```ruby
# お題を JSON にする手順の共有。PostsController と FavoritesController が使う。
module PostRendering
  extend ActiveSupport::Concern

  private

  # PostSerializer は with_counts が SELECT 句で付ける別名属性に依存している。
  # 新規作成直後やお気に入りの増減後のレコードには乗っていないので、
  # そのスコープ経由で取り直す。
  def post_json(post)
    fresh = Post.kept.includes(:user).with_counts.find(post.id)
    PostSerializer.call(fresh, favorited: favorited?(fresh))
  end

  # 単体のお題に対する判定。一覧は Favorite.favorited_post_ids を直接呼んで 1 クエリにまとめる。
  def favorited?(post)
    Favorite.favorited_post_ids(current_user, [ post.id ]).include?(post.id)
  end
end
```

`app/controllers/concerns/` は既存ディレクトリなので、autoload の取りこぼし（新規ディレクトリ作成時に restart が要る問題）は起きない。

`PostsController#show` は既に `with_counts` 経由で post を取っているので `post_json` は使わず、`favorited?` だけを使う（取り直すと無駄なクエリが1本増える）。

取り直しは `Post.kept` で絞る。現在の呼び出し元（`PostsController#create` の作りたてのレコード、`FavoritesController` の `favoritable_post`）はすべて手前で絞っているので振る舞いは変わらないが、ここが「お題を1件返す」共通の入口になる以上、絞らない呼び出し元が増えたときに、他のすべての経路が 404 を返す削除済みのお題をここだけ 200 で返してしまう。

**同じ理由で `AttemptRendering#attempt_json` にも `Attempt.kept` を足す。** 5-1 で作った時点では付いておらず、呼び出し元（`owned_attempt` / `likeable_attempt` / 作りたての新規レコード）が全て絞っているので実害は無い。それでもこの issue で直すのは、`post_json` にだけ `.kept` があると、同じ型で書かれた 2 つの concern が 1 語だけ違うことになり、その差に意味があるのかを読む側が毎回確かめる羽目になるため。非対称を作ったのがこの変更なので、ここで閉じる。

### `Favorite.favorited_post_ids`

```ruby
# 表示するお題のうち、そのユーザーがお気に入り済みのものを id の Set で返す。
# 一覧で 1 件ずつ exists? を呼ぶと N+1 になるので、id 集合に対して 1 クエリで引く。
# 未ログイン（user が nil）は常に空集合＝すべて false。
def self.favorited_post_ids(user, post_ids)
  return Set.new if user.nil? || post_ids.empty?

  where(user: user, post_id: post_ids).pluck(:post_id).to_set
end
```

追加クエリはリクエストあたり1本だけ。`Like.liked_attempt_ids` と同じ形。

`PostsController#index` と `#show` は認証不要だが、devise-jwt の warden は `current_user` を呼んだ時点で遅延認証するため、トークンがあれば正しく判定され、無ければ `nil` → 全件 `false` になる。

### `PostSerializer`

```ruby
def self.call(post, favorited:)
```

`favorited:` にデフォルト値を置かない。既存のコメント「0 を既定値にして握りつぶさないのは、`with_counts` の付け忘れが黙って 0 が並ぶ一覧として表に出るより、その場で落ちたほうが直せるため」と同じ方針。必須にしておけば呼び出し漏れが `ArgumentError` として即座に出る。

`create` の応答も `false` を直書きせず、他と同じく計算する。「作りたてのお題は誰もお気に入りしていない」は真だが、そこに依存を作ると、将来 `create` の直後に何かが変わったときに黙って嘘をつく。

### `PostsController`

```ruby
def index
  posts = Post.listing(q: params[:q], sort: params[:sort]).page(page_param)
  # 一覧ぶんのお気に入り済み判定を 1 クエリでまとめて引く（1 件ずつ引くと N+1 になる）。
  favorited_ids = Favorite.favorited_post_ids(current_user, posts.map(&:id))

  render json: {
    posts: posts.map { |post| PostSerializer.call(post, favorited: favorited_ids.include?(post.id)) },
    meta: PaginationSerializer.call(posts)
  }
end
```

`show` は `PostSerializer.call(post, favorited: favorited?(post))`、`create` は末尾を `post_json(created)` に置き換える（取り直しの行が concern に移るので2行減る）。

### `AttemptsController#show`

比較ビュー用に post を同梱しており、ここも `PostSerializer` を通る。既に `Post.kept.includes(:user).with_counts.find` で取っているので、`PostRendering` を include して `favorited?` だけを使う。

```ruby
post: PostSerializer.call(post, favorited: favorited?(post))
```

`AttemptRendering` と `PostRendering` の2つを include することになるが、責務は分かれている（挑戦の JSON 化とお題の JSON 化）ので混ざらない。この画面はお題のお気に入りボタンも出すため、`favorited` はここでも要る。

## テスト

### 新規：`spec/requests/api/favorites_spec.rb`

`POST`

- 他人のお題 → 200、`favorited: true`、`Favorite` が1件できる
- 続けてもう一度 POST → 200、`favorited: true` のまま、`Favorite` は1件のまま（冪等）
- **自分のお題 → 200、お気に入りできる**（5-1 と非対称な点の固定）
- 削除済み（`discarded`）のお題 → 404
- 存在しない ID → 404
- 未認証 → 401
- `find_or_create_by!` が `RecordNotUnique` を投げるようスタブ → 200
- `find_or_create_by!` が `RecordInvalid`（重複のみ）を投げるようスタブ → 200
- `RecordInvalid`（重複以外）→ 422、エラーコードで返る
- `RecordInvalid`（重複と別原因が同時）→ 422（`duplicate_only?` が `of_kind?` で妥協していないことの固定）

最後の4本だけモックを使う。実際の競合は request spec で再現できないが、rescue 節が両方の例外に効いていること、そして重複以外を握り潰さないことは担保したい。

`DELETE`

- お気に入り済み → 200、`favorited: false`、`Favorite` が消える
- お気に入りしていない → 200、変化なし（冪等）
- 他人のお気に入りは消えない（2人がお気に入り済みの状態で自分だけ解除 → 相手の行は残る）
- 削除済み・存在しない ID → 404
- 未認証 → 401

### 追記：`spec/models/favorite_spec.rb`

`Favorite.favorited_post_ids` … お気に入り済みの id だけを返す／他人のお気に入りは含まない／`user` が `nil` なら空集合／`post_ids` が空なら空集合

### 更新：`spec/requests/api/posts_spec.rb`

- `index` … 各要素に `favorited` が入る。自分がお気に入りした1件だけ `true`。未認証なら全件 `false`
- `show` … `favorited` が入る
- `create` … `favorited: false` が入る
- **ログイン状態での N+1 検査を新設**

既存の N+1 検査（`posts_spec.rb:100`）は未認証で測っている。`favorited_post_ids` は未ログインだと早期 return して DB を触らないため、`favorited` の判定を1件ずつの `exists?` に書き換えても検知できない。詳細側（`posts_spec.rb:272`）が `liked` のために同じ理由でログイン状態の検査を別に持っているので、それに倣う。

### 更新：`spec/requests/api/attempts_spec.rb`

`GET /api/attempts/:id` の応答に含まれる `post` に `favorited` が入る。未認証なら `false`。

### 影響を受ける既存 spec

`PostSerializer` を経由する request spec は `posts_spec.rb` と `attempts_spec.rb` の2本だけ（`me_spec.rb` は `GET /api/me` のみで、6-3 の一覧はまだ無い）。`likes_spec.rb` は concern 切り出し後も通ることを確認する（`CollectionProxy#find_or_create_by!` のスタブは呼び出し場所が移っても効く）。

## 変更するファイル

| ファイル | 内容 |
|---|---|
| `backend/config/routes.rb` | `resource :favorite, only: %i[create destroy]` を posts にネスト |
| `backend/app/controllers/api/favorites_controller.rb` | 新規。create / destroy |
| `backend/app/controllers/concerns/idempotent_toggle.rb` | 新規。`toggle_on` / `duplicate_only?` |
| `backend/app/controllers/concerns/post_rendering.rb` | 新規。`post_json` / `favorited?` |
| `backend/app/controllers/concerns/attempt_rendering.rb` | `attempt_json` の取り直しを `Attempt.kept` で絞る（`post_json` と揃える。下記） |
| `backend/app/controllers/api/likes_controller.rb` | `IdempotentToggle` を include、rescue と `duplicate_only?` を削除 |
| `backend/app/controllers/api/posts_controller.rb` | `PostRendering` を include、`index` / `show` / `create` に `favorited` を通す |
| `backend/app/controllers/api/attempts_controller.rb` | `PostRendering` を include、`show` の post に `favorited` を通す |
| `backend/app/models/favorite.rb` | `self.favorited_post_ids` を追加 |
| `backend/app/serializers/post_serializer.rb` | `favorited:` を必須キーワードで受け取り、`favorited` を出力に追加 |
| `docs/issues_backlog.md` | 5-2 のタスクを完了に、設計書への参照と補足を追記 |
| `docs/screen_and_api_design.md` | お気に入り API の応答仕様（200 / 404、冪等、セルフ可）を追記 |
| `backend/spec/requests/api/favorites_spec.rb` | 新規 |
| `backend/spec/models/favorite_spec.rb` | `favorited_post_ids` を追記 |
| `backend/spec/requests/api/posts_spec.rb` | `favorited` の期待値と、ログイン状態の N+1 検査を追記 |
| `backend/spec/requests/api/attempts_spec.rb` | `show` の post に `favorited` が入ることを追記 |

`CLAUDE.md` は変更しない（5-1 で追記した物理削除の但し書きが `favorites` を既に名指ししている）。

## 完了条件

- お気に入りのオン／オフができ、二重登録が `favorites` に2行を作らない
- 同じリクエストを繰り返してもエラーにならず、状態が変わらない
- 削除済み・存在しないお題にはお気に入りできず、404 が返る
- 自分のお題もお気に入りできる
- お題一覧・お題詳細・作成・挑戦詳細の応答に `favorited` が入り、フロントがボタンの状態を描ける
- 一覧のクエリ数がお題の件数に比例しない（ログイン状態で検査）
- `bundle exec rubocop` と `bundle exec rspec` が green

## この issue で作らないもの

- **お気に入り一覧**（`GET /api/me/favorites`）… 6-3
- **お気に入り数の公開**（`favorites_count`）… 役割分担の判断は 5-4 の前提
- **一覧の絞り込み**（`GET /api/posts?favorited=true`）… 6-3 と役割が重なるため作らない
- **挑戦のお気に入り**（`POST/DELETE /api/attempts/:id/favorite`）… 5-4（本リリースで検討）
- **フロントのお気に入りボタン**… 7-3 / 7-4
