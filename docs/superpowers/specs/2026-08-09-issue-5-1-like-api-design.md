# issue 5-1 再現いいね API 設計

- 対象 issue：`docs/issues_backlog.md` 5-1
- 依存：4-2（挑戦の生成）
- 作成日：2026-08-09

## この issue で作るもの

`POST/DELETE /api/attempts/:attempt_id/like`。挑戦（Attempt）への「再現いいね」をオン／オフする。

モデル層は追加しない。マイルストーン1で `likes` テーブル（`(user_id, attempt_id)` の複合ユニークインデックス付き）、`Like` モデル、factory、model spec が作られており、`Attempt.with_likes_count` と `AttemptSerializer#likes_count` も既にある。この issue で足りないのは HTTP の入口と、フロントがボタンの状態を描くための `liked` フィールドだけ。

マイグレーションは無い。DB は変更しない。

## エンドポイント仕様

### `POST /api/attempts/:attempt_id/like`

認証必須。

| 状況 | 応答 |
|---|---|
| 未いいね → いいね成立 | `200` `{ "attempt": {...} }`（`likes_count` +1、`liked: true`） |
| すでにいいね済み | `200` 同じ内容（DB は変化なし） |
| 自分の挑戦 | `422` `{ "error": "cannot_like_own_attempt" }` |
| 未公開・削除済み・存在しない ID | `404` `{ "error": "not_found" }` |
| 未認証 | `401` |

### `DELETE /api/attempts/:attempt_id/like`

認証必須。

| 状況 | 応答 |
|---|---|
| いいね済み → 解除 | `200` `{ "attempt": {...} }`（`likes_count` −1、`liked: false`） |
| いいねしていない | `200` 同じ内容（DB は変化なし） |
| 未公開・削除済み・存在しない ID | `404` |
| 未認証 | `401` |

## 決めたこと

### 応答は `{ "attempt": {...} }`

`Like` レコードそのもの（id / user_id / attempt_id）を返しても画面は何も更新できない。フロントが表示したい `likes_count` は `Like` の属性ではなく、`Attempt` に紐づく集計値（`Attempt.with_likes_count` の相関サブクエリ）だから。

既存の `create` / `update` / `generate` と同じ形になるので、フロントは返ってきた attempt でカードを差し替えるだけで済む。ボディを返す以上ステータスは `204` ではなく `200`（`204 No Content` はボディを含められない）。

`likes_count` は SELECT 句の別名属性なので、いいねの増減後は `with_likes_count` 経由で取り直してからシリアライズする。

### 対象は `kept` かつ `published`、お題も `kept` の挑戦のみ

`Attempt.kept.published.joins(:post).merge(Post.kept).find(params[:attempt_id])` の一撃で絞る。下書き・生成中・失敗・削除済み・お題が削除済みは、すべて `RecordNotFound` → 404。

お題側も見るのは、`Post#discard` が挑戦にカスケードしないため（`has_many :attempts, dependent: :restrict_with_exception` で、discard のコールバックは無い）。挑戦だけを見ると `kept` かつ `published` のままで、読み取り API からは辿れない（`AttemptsController#show` が別途 `Post.kept` を引いて 404 になる）のに、いいねだけ書き込めてしまう。その票は post スコープを持たない `Attempt.likes_count_sql` に効くため、削除済みのお題の挑戦がベスト再現（6-1）と全体ランキング（6-2）で順位を持つ。`POST /api/posts/:post_id/attempts` が `Post.kept.find` で挑戦の作成を塞いでいるのとも揃う。

403 ではなく 404 にして存在ごと隠すのは、`AttemptsController#visible_attempt` と同じ理由（他人の下書きの存在を漏らさない）。スコープに条件を畳み込むのも `owned_attempt` が `current_user.attempts.kept.find` でやっているのと同じ発想で、チェックの書き忘れが構造的に起こらないようにするため。

### セルフいいねは禁止（422 `cannot_like_own_attempt`）

いいねは「再現度」への投票で、ベスト再現（6-1）と全体ランキング（6-2）の順位を直接決める。自分で自分に投票できると同着が自票で覆る。

判定はバックに置く（CLAUDE.md「ルールの判定はバック、見せ方はフロント」）。フロントはどちらにせよ自分のカードでボタンを隠すので、422 は直叩きへの保険として働く。

### 冪等にする

`POST` を「いいねレコードを新規作成せよ」ではなく「**この挑戦を、自分がいいねしている状態にせよ**」という命令として解釈する。すでにその状態なら DB は変わらないが、エラーではなく 200 で現在の attempt を返す。`DELETE` も同様に「いいねしていない状態にせよ」。

厳密にエラー（422 `already_liked` / 404）にする案は採らない。ボタン連打・通信リトライ・別タブとの状態ズレのたびにエラーが返り、フロントに「このエラーコードだけは握りつぶす」分岐と辞書エントリが必要になる。

issue の完了条件「二重いいねが防止される」は、`likes` に2行できないことで満たす。これは複合ユニークインデックスが保証しており、冪等かどうかとは独立している。

自分の挑戦への `DELETE` は 422 にせず 200 を返す。セルフいいねできない以上「いいねしていない状態」で確定しており、冪等な DELETE の定義どおり現状を返せばよい。ここだけ 422 にすると POST と DELETE で非対称になる。

### 並行リクエストは rescue して成功扱い

`find_or_create_by!` の SELECT と INSERT の間に別リクエストが割り込むと例外になる。rescue して 200 にする（最終状態は要求どおり「いいね済み」なので成功）。rescue しないと同時クリックで 500 になる。

**捕まえる例外は2つ。** `Like` には DB の複合ユニークインデックスと、`validates :user_id, uniqueness: { scope: :attempt_id }` のアプリ側バリデーションの両方がある。どちらが先に当たるかは競合相手の状態で変わる。

- 競合相手の INSERT が**コミット済み** → `create!` のバリデーションが検知 → `ActiveRecord::RecordInvalid`
- 競合相手の INSERT が**まだ進行中** → バリデーションは通過し、DB 制約が検知 → `ActiveRecord::RecordNotUnique`

`RecordNotUnique` だけを rescue すると前者で 500 になるので、両方を rescue する。

ただし `RecordInvalid` はまとめて握り潰さず、**重複（`errors.of_kind?(:user_id, :taken)`）のときだけ**成功に読み替える。将来 `Like` にバリデーションが増えたとき、弾かれたいいねが 200 と `liked: false` で返り、エラーコードも出ないままフロントが失敗に気づけなくなるため。

### いいね解除は物理削除（CLAUDE.md の例外）

CLAUDE.md の必守ルールは「論理削除は必ず `discard` を使う。物理削除しない」だが、`likes` はこれに従わない。理由は3つ。

1. **複合ユニークインデックスと両立しない。** 解除で行を残すと、同じユーザーが同じ挑戦にいいねし直せなくなる（制約違反になる）。トグルとして成立しない。部分インデックス（`WHERE discarded_at IS NULL`）で回避する手はあるが、複雑さに見合わない。
2. **`likes` に `discarded_at` カラムが無い。** マイルストーン1のスキーマ設計時点で物理削除前提。`Attempt` と `User` の `has_many :likes, dependent: :destroy` も同じ前提で書かれている。
3. **ルールの趣旨が当てはまらない。** CLAUDE.md が物理削除を禁じる理由は「他テーブルからの参照が壊れるため」。`likes` を参照しているテーブルは無く、いいね解除は「取り消し」であって記録を残す意味もない。

`Favorite`（5-2）も同じ構造なので同じ扱いになる。CLAUDE.md 側に但し書きを追記する。

### 誰がいいねしたかは公開しない・通知もしない

外に出るのは `likes_count`（合計数）と `liked`（リクエストした本人の状態）だけ。いいねしたユーザーの一覧を返すエンドポイントは作らず、通知も行わない。

1. 誰が押したか見えないほうが、忖度なく再現度で判断できる（6-1 / 6-2 の質に直結する）。
2. 押した相手に名前が出ると分かると、公開UGC ではいいねを押しにくくなる。
3. 通知は配信手段・既読管理・パフォーマンスの設計が要る独立した機能で、docs にも存在しない。

将来この判断を覆せる。物理削除で消えるのは「解除されたいいね」だけで、生きているいいねの `user_id` と `created_at` は残るため、後から一覧も通知も組み立てられる。本リリースの検討項目として `docs/issues_backlog.md` に 5-5 を追記する。

### `liked` フィールドを 5-1 に含める

現在の `AttemptSerializer` は `likes_count` しか返さないため、ハートを塗りつぶすか白抜きにするかをフロントが決められない。お題詳細（7-3）と比較ビュー（7-4）はどちらも依存に 5-1 を持ち、この情報を必要とする。

ここで足しておけば、いいね機能がバック側で完結し、フロントの issue で Rails を触らずに済む。

## 実装の構え

### ルーティング

```ruby
resources :attempts, only: %i[show update destroy] do
  post :generate, on: :member
  resource :like, only: %i[create destroy]   # /api/attempts/:attempt_id/like
end
```

ネストした単数リソースにすると、`docs/screen_and_api_design.md` に書かれたパスとそのまま一致する。5-2 のお気に入り（`resource :favorite` を posts にネスト）も同じ形で書けるので対称になる。

`AttemptsController` に `like` / `unlike` を足す案は採らない。すでに6アクション＋private 8メソッドあるコントローラがさらに太り、「挑戦の管理」と「いいね」で責務が混ざる。

`Likes::Toggle` のようなサービスオブジェクトも挟まない。ロジックが「所有者チェック1つ ＋ `find_or_create_by!` / `find_by&.destroy`」しかなく、間接参照が増えるだけ。`Attempts::Generation` が PORO なのは回数制限・キルスイッチ・状態遷移を持つからで、ここは当てはまらない。

### `Api::LikesController`（新規）

`before_action :authenticate_user!`。private に対象を絞る `likeable_attempt`（`Attempt.kept.published.find(params[:attempt_id])`）を持つ。

- `create` … 所有者なら 422。そうでなければ `current_user.likes.find_or_create_by!(attempt:)`。`ActiveRecord::RecordInvalid` と `ActiveRecord::RecordNotUnique` を rescue して成功扱い。最後に `attempt_json` を返す。
- `destroy` … `current_user.likes.find_by(attempt:)&.destroy`。無ければ何もしない。`attempt_json` を返す。

### `AttemptRendering`（新規 concern）

`attempt_json` は現在 `AttemptsController` の private メソッドだが、`LikesController` も同じ「`with_likes_count` で取り直してシリアライズ」を必要とする。`app/controllers/concerns/attempt_rendering.rb` に切り出して両者で共有する。

```ruby
module AttemptRendering
  extend ActiveSupport::Concern

  private

  # AttemptSerializer は with_likes_count が SELECT 句で付ける別名属性に依存している。
  # 更新直後・いいね増減後のレコードには乗っていないので、そのスコープ経由で取り直す。
  def attempt_json(attempt)
    fresh = Attempt.includes(:user).with_likes_count.find(attempt.id)
    AttemptSerializer.call(fresh, liked: liked_attempt_ids([ fresh.id ]).include?(fresh.id))
  end

  def liked_attempt_ids(ids) = Like.liked_attempt_ids(current_user, ids)
end
```

`app/controllers/concerns/` は既に存在するディレクトリなので、autoload の取りこぼし（新規ディレクトリ作成時に restart が要る問題）は起きない。

### `Like.liked_attempt_ids`

```ruby
# 表示する挑戦のうち、そのユーザーがいいね済みのものを id の Set で返す。
# 一覧で 1 件ずつ exists? を呼ぶと N+1 になるので、id 集合に対して 1 クエリで引く。
# 未ログイン（user が nil）は常に空集合＝すべて false。
def self.liked_attempt_ids(user, attempt_ids)
  return Set.new if user.nil? || attempt_ids.empty?

  where(user: user, attempt_id: attempt_ids).pluck(:attempt_id).to_set
end
```

追加クエリはリクエストあたり1本だけ。

`PostsController#show` と `AttemptsController#show` は認証不要だが、devise-jwt の warden は `current_user` を呼んだ時点で遅延認証するため、トークンがあれば正しく判定され、無ければ `nil` → 全件 `false` になる（`AttemptsController#visible_attempt` が既に `current_user&.id` で同じことをしている）。

### `AttemptSerializer`

```ruby
def self.call(attempt, liked:)
```

`liked:` にデフォルト値を置かない。既存の `attempt_json` のコメント「0 を直接埋めないのは、シリアライザの前提を1か所でも崩すと後で気づけなくなるため」と同じ方針で、必須にしておけば呼び出し漏れが `ArgumentError` として即座に出る。黙って `false` が入り「いいねしたのにハートが白いまま」になる事故を防げる。

作成・更新・生成の応答では相手が自分の挑戦なので `liked` は必ず `false` になるが、そこに `false` を直書きしない（セルフいいね禁止という別ルールへの暗黙の依存を作らないため）。常に計算する。

### `PostsController#show`

```ruby
attempts = Attempt.listing_for(post).page(page_param)
liked_ids = liked_attempt_ids(attempts.map(&:id))

attempts: attempts.map { |a| AttemptSerializer.call(a, liked: liked_ids.include?(a.id)) }
```

## テスト

### 新規：`spec/requests/api/likes_spec.rb`

`POST`

- 公開済みの他人の挑戦 → 200、`likes_count` +1、`liked: true`、`Like` が1件できる
- 続けてもう一度 POST → 200、`likes_count` は変わらず、`Like` は1件のまま（冪等）
- 自分の挑戦 → 422 `cannot_like_own_attempt`、`Like` は作られない
- `draft` / `generating` / `failed` の挑戦 → 404
- 削除済み（`discarded`）の挑戦 → 404
- 存在しない ID → 404
- 未認証 → 401
- `find_or_create_by!` が `RecordNotUnique` を投げるようスタブ → 200
- `find_or_create_by!` が `RecordInvalid` を投げるようスタブ → 200

最後の2本だけモックを使う。実際の競合は request spec で再現できないが、rescue 節が両方の例外に効いていることは担保したい。

`DELETE`

- いいね済み → 200、`likes_count` −1、`liked: false`、`Like` が消える
- いいねしていない → 200、`likes_count` 変わらず（冪等）
- 他人のいいねは消えない（2人がいいね済みの状態で自分だけ解除 → `likes_count` は 1）
- 未公開・削除済み・存在しない ID → 404
- 未認証 → 401

### 追記：`spec/models/like_spec.rb`

`Like.liked_attempt_ids` … いいね済みの id だけを返す／`user` が `nil` なら空集合／`attempt_ids` が空なら空集合

### 更新：既存 request spec

- `posts_spec.rb` … 挑戦一覧の各要素に `liked` が入る。自分がいいねした1件だけ `true`
- `attempts_spec.rb` … `show` / `create` / `update` / `generate` の応答に `liked` が入る。未認証の `show` では `false`

## 変更するファイル

| ファイル | 内容 |
|---|---|
| `backend/config/routes.rb` | `resource :like, only: %i[create destroy]` を attempts にネスト |
| `backend/app/controllers/api/likes_controller.rb` | 新規。create / destroy |
| `backend/app/controllers/concerns/attempt_rendering.rb` | 新規。`attempt_json` を切り出して共有 |
| `backend/app/controllers/api/attempts_controller.rb` | concern を include、private の `attempt_json` を削除、`show` の呼び出しを更新 |
| `backend/app/controllers/api/posts_controller.rb` | `show` の挑戦一覧に `liked` を通す |
| `backend/app/models/like.rb` | `self.liked_attempt_ids` を追加 |
| `backend/app/serializers/attempt_serializer.rb` | `liked:` を必須キーワードで受け取り、`liked` を出力に追加 |
| `docs/issues_backlog.md` | 5-1 を完了に、5-5（いいねの可視化と通知）を追記 |
| `docs/screen_and_api_design.md` | いいね API の応答仕様（200 / 422 / 404、冪等）を追記 |
| `CLAUDE.md` | 論理削除の項に、トグル用中間テーブルは物理削除という但し書き |
| `backend/spec/requests/api/likes_spec.rb` | 新規 |
| `backend/spec/models/like_spec.rb` | `liked_attempt_ids` を追記 |
| `backend/spec/requests/api/posts_spec.rb` | `liked` の期待値を追記 |
| `backend/spec/requests/api/attempts_spec.rb` | `liked` の期待値を追記 |

## 完了条件

- いいねのオン／オフができ、二重いいねが `likes` に2行を作らない
- 同じリクエストを繰り返してもエラーにならず、状態が変わらない
- 未公開・削除済み・他人の下書きの挑戦にはいいねできず、存在も漏れない
- 自分の挑戦にはいいねできない
- お題詳細・挑戦詳細の応答に `liked` が入り、フロントがボタンの状態を描ける
- `bundle exec rubocop` と `bundle exec rspec` が green

## この issue で作らないもの

- **いいね順の並び替え**（`GET /api/posts/:id?sort=likes`）… 6-1
- **全体ランキング**（`GET /api/rankings`）… 6-2
- **お気に入り**（`POST/DELETE /api/posts/:id/favorite`）… 5-2
- **フロントのいいねボタン**… 7-3 / 7-4
- **いいねしたユーザー一覧・通知**… 5-5（本リリースで検討）
