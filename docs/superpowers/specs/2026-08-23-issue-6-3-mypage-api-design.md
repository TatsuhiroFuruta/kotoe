# issue 6-3 マイページ API 設計

- 対象 issue：`docs/issues_backlog.md` 6-3（GitHub #21）
- 依存：4-2（描写の保存・生成）、5-2（お気に入り API）
- 作成日：2026-08-23
- 前提：
  - `docs/superpowers/specs/2026-07-29-issue-3-2-post-crud-design.md`（`PostSerializer` と一覧の形）
  - `docs/superpowers/specs/2026-08-15-issue-5-2-favorite-api-design.md`（お気に入りの一覧はマイページが持つ、と委譲している）
  - `docs/superpowers/specs/2026-08-19-issue-6-1-best-attempts-design.md`（`AttemptSerializer` と「id 集合ベースの `liked`」）

## この issue で作るもの

マイページ `/mypage`（7-6）が必要とするデータを返す API。新規エンドポイント4本と、既存 `GET /api/me` の拡張1つ。

| パス | 中身 | 並び |
|---|---|---|
| `GET /api/me/posts` | 自分の `kept` なお題 | 新着順 |
| `GET /api/me/attempts` | 自分の `kept` かつ `published` な挑戦 | 新着順 |
| `GET /api/me/drafts` | 自分の `kept` かつ `draft` な挑戦 | 新着順 |
| `GET /api/me/favorites` | お気に入りしたお題（`Post.kept` のみ） | お気に入りした新しい順 |
| `GET /api/me`（拡張） | 既存の `id` / `name` / `email` ＋ `stats` | — |

すべて要ログイン。1ページ12件（既存の kaminari 設定）で、`meta` は既存の `PaginationSerializer` の形。

マイグレーションは無い。`Post` / `Attempt` / `Favorite` / `Like` と、`with_counts`・`with_likes_count`・`favorited_post_ids`・`liked_attempt_ids` は 5-2 までに揃っている。

## なぜ統計（`stats`）をこの issue に入れるのか

`docs/design_briefs.md` の 7（マイページ）は、上部のプロフィールヘッダーに**投稿したお題数／挑戦数／獲得いいね合計**を出すと定めている。7-6（マイページ画面）の依存は 7-1 と 6-3 だけなので、ここで作らないと 7-6 に供給源が無い。

4本の一覧 API からは導けない。投稿数と挑戦数は `meta.total_count` で足りるが、**獲得いいね合計は導けない**。一覧が返すのは1ページ12件ぶんの `likes_count` だけで、13件目以降のいいねが落ちるため。

置き場所は `GET /api/me`。プロフィールヘッダーは「自分が誰か」と「自分の数字」を同時に描くので、1リクエストで揃うのが素直。独立した `GET /api/me/stats` は往復が1つ増えるだけで、得るものが無い。

### `stats` の定義は各タブの `total_count` に一致させる

```json
"stats": { "posts_count": 3, "attempts_count": 12, "likes_received_count": 45 }
```

| キー | 定義 | 一致する数 |
|---|---|---|
| `posts_count` | 自分の `kept` なお題 | `GET /api/me/posts` の `meta.total_count` |
| `attempts_count` | 自分の `kept` かつ `published` な挑戦 | `GET /api/me/attempts` の `meta.total_count` |
| `likes_received_count` | 上の挑戦が集めたいいねの総数 | （対応する一覧は無い） |

ヘッダーの数字とタブの中身がズレないことを、定義のレベルで保証する。下書き数はヘッダーに出さない（ブリーフが挙げているのは3つ）ので、必要なら `GET /api/me/drafts` の `meta.total_count` を使う。

`likes_received_count` は**お題の削除状態を見ない**。お題が削除されても、その挑戦が得た票は本人の実績として消えない。加えて `me/attempts` の母集合（後述のとおりお題の状態を見ない）と揃うため、「一覧に出ている挑戦のいいねを足すと合計になる」という関係が保たれる。

## 決めたこと

### 削除済みのお題にぶら下がる挑戦・下書きも `me/attempts` / `me/drafts` に出す

`Post#discard` は挑戦にカスケードしない（`has_many :attempts, dependent: :restrict_with_exception`）。お題を論理削除しても、その下の挑戦は `attempts.discarded_at` が nil のまま残る。

4-4 の推奨案（案A）は「`PATCH` と `generate` は塞ぐが `DELETE` は許可する。お題が消えたあとに自分の下書きを片付ける手段を残せる」。ここで `Post.kept` で絞ると、**その前提が成立しなくなる**（画面に出ないものは片付けようがない）。だから絞らない。

代わりに、挑戦に添えるお題の表現へ `discarded` を持たせ、フロントが「このお題は削除されました」と描き分けられるようにする。カードから飛べる先（`GET /api/attempts/:id`）は 404 になるので、リンクを殺すかどうかもフロントが決められる。

### ただし削除済みのお題は、タイトルと画像を伏せる

`post` サマリは、`discarded` が `true` のとき `title` と `image_public_id` を `null` にする（`id` と `discarded` だけを返す）。

`discard` はモデレーションの取り下げ手段でもある（通報 → ソフトデリート）。伏せないと、取り下げたお題の `image_public_id` を、そのお題に挑戦した全員のマイページから配り続けることになる。Cloudinary の URL は `public_id` から誰でも組み立てられるため、これは画像を配り続けるのと同じ。**この issue より前は、削除済みのお題の情報を返す経路がひとつも無かった**（すべて `Post.kept` 起点で、`GET /api/attempts/:id` もお題が削除済みなら応答ごと 404 になる）ので、ここで初めて開く穴になる。

伏せても失うものが無い。削除済みのお題のカードに残る操作は `DELETE /api/attempts/:id` だけで、それに要るのは挑戦の `id` と「削除済みである」ことだけ。どの下書きかは自分が書いた `description` で見分けられる。

型は `{ id: number, title: string | null, image_public_id: string | null, discarded: boolean }` になる。

**判定は `discarded?` だけを見る。「誰が消したか」では分けない。** つまり自分が投稿して自分で消したお題への自分の挑戦でも、タイトルと画像は伏せられる。分けようとすると、シリアライザに `current_user` を渡して所有者を比べる必要が生まれ、「削除済みのお題の中身は返さない」という一文の規則が「場合による」に変わる。取り下げの目的（もう配らない）は投稿者本人の画面でも同じなので、単純なほうを採る。

**7-6 への申し送り**：この結果、削除済みのお題のカードは「タイトルも画像も無く、自分が書いた `description` だけがある」状態になる。空カードのデザインはこのケース（自分で消した場合を含む）を想定しておくこと。

### `me/favorites` だけは `Post.kept` で絞る

こちらは issue の制約文どおり。5-2 が削除済みお題への `DELETE /api/posts/:id/favorite` を 404 にしているのは、「その行はどの画面にも出てこないので片付ける導線に意味がない」という前提に立っているため。絞らないと、解除ボタンが必ず 404 を返す行が画面に出る。しかもお題は discard なので `has_many :favorites, dependent: :destroy` が発火せず、その行はユーザーが二度と消せない。

**挑戦と扱いが逆になるのは、片付ける手段が残っているかどうかが逆だから。** 挑戦は `DELETE /api/attempts/:id` が生きているので出す価値がある。お気に入りは解除の口が塞がっているので出す価値が無い。

### `me/favorites` の並びは「お気に入りした順」

`favorites.created_at DESC`（同着は `favorites.id DESC` でタイブレーク。ページ間の重複・抜けを防ぐ既存の作法）。

お題の新着順にすると、古いお題を今お気に入りしてもリストの奥に埋もれ、「押したのに見つからない」になる。ブックマークは「さっきストックしたものが上」が自然で、ボタンを押した直後に先頭へ現れる。

### `me/favorites` の `favorited` は判定クエリを引かずに `true` を入れる

この一覧に載っている時点で、その行の存在自体がお気に入り済みの証拠。`Favorite.favorited_post_ids` を引いても必ず全件 `true` が返るので、1クエリぶん無駄になる。

`PostSerializer` の `favorited:` はキーワード必須のままにする（省略時 `false` の既定値を置かない、という 5-2 の判断は変えない）。

### `me/attempts` の `liked` は、他の一覧と同じく `Like.liked_attempt_ids` で引く

自分の挑戦にはいいねできない（5-1 が `422 cannot_like_own_attempt` で塞いでいる）ので、`liked` は事実上いつも `false` になる。それでも `false` を直接埋めない。

`favorited: true` が「その行がそこに在ることの言い換え」なのに対し、`liked: false` は**別の issue（5-1）のルールに寄りかかった推論**で、そのルールが変われば黙って嘘になる（5-5 でいいねの可視化を検討する予定がある）。節約できるのは1クエリで、`(user_id, attempt_id)` の複合ユニークインデックスが効く軽いクエリ。引き合わない。

### 挑戦アイテムに添えるお題は最小サマリにする

```json
"post": { "id": 3, "title": "夕暮れの商店街", "image_public_id": "kotoe/posts/xxx", "discarded": false }
```

ブリーフの下書きタブは「お題サムネイル＋描写文＋『生成する』『編集』『削除』ボタン」で、カードに要るのはサムネイル・タイトル・リンク先だけ。そのお題の挑戦数・いいね合計・自分がお気に入りしているかは使わない。

既存の `PostSerializer` を流用しない理由は2つ。

1. `attempts_count` / `likes_count` は `Post.with_counts` が SELECT 句で付ける別名属性なので、`includes(:post)` の preload には乗らない。取り直すクエリと `favorited` の判定クエリで**2本増える**
2. `PostSerializer` は `discarded` を持たない。持たせると公開 API（お題一覧・詳細）の形にまで波及する。削除済みのお題は公開 API には出てこないので、そこでは常に `false` の意味の無いキーになる

新設するのは `PostSummarySerializer` 1つ。`AttemptSerializer` は変更しない（`post` キーは呼び出し側で `merge` する）。

### `me/drafts` の応答キーも `attempts`

下書きは「`status` が `draft` の Attempt」であって別のリソースではない。要素の形も `me/attempts` と完全に同じなので、キーを変えるとフロントで型とレンダラを二重に持つことになる。URL だけを分ける（`me/drafts`）。

### 並びは `created_at`。`updated_at` は使わない

下書きは編集されるので「最近いじった順」も考えられるが、`recent`（`created_at DESC, id DESC`）で揃える。`updated_at` は本人の編集以外（将来の一括更新など）でも動き、リストの順序が理由なく変わる。既存の一覧すべてが `recent` なので、揃えておくほうが説明が要らない。

### コントローラは `Api::MeController` 1本

4アクションとも「認証済みユーザーの、自分のリソースの一覧」で、認証・ページング・`meta` の組み立てが共通。`Api::Me::PostsController` のような名前空間に8行のコントローラを4つ置くと、共通部分を載せる基底クラスがもう1つ要る。

`app/controllers/api/me/` という**新ディレクトリを作らずに済む**副次的な利点もある（新ディレクトリは開発コンテナの restart が要る）。

タブが増えて `MeController` が 150 行を超えるようなら、そのとき名前空間に割る。

## エンドポイント仕様

### `GET /api/me`（拡張）

```json
{
  "id": 1,
  "name": "テスト太郎",
  "email": "me@example.com",
  "stats": { "posts_count": 3, "attempts_count": 12, "likes_received_count": 45 }
}
```

`stats` が増えるのは**この経路だけ**。`POST /api/auth/sign_up` と `POST /api/auth/sign_in` も `UserSerializer.private_profile` を使っているが、そちらは変えない。サインイン直後に集計3本を走らせる理由が無く、新規登録では必ず全部 0 になる。

### `GET /api/me/posts`

```json
{
  "posts": [ { "...": "PostSerializer と同形（favorited を含む）" } ],
  "meta": { "current_page": 1, "total_pages": 1, "total_count": 3 }
}
```

自分の `kept` なお題のみ。`favorited` は本人基準（自分のお題も 5-2 でお気に入りできる）。

### `GET /api/me/attempts` ／ `GET /api/me/drafts`

```json
{
  "attempts": [
    {
      "id": 7, "description": "...", "generated_image_public_id": "...", "status": "draft",
      "failure_reason": null, "similarity_score": null,
      "user": { "id": 1, "name": "テスト太郎" },
      "likes_count": 0, "liked": false, "created_at": "2026-08-23T00:00:00Z",
      "post": { "id": 3, "title": "夕暮れの商店街", "image_public_id": "kotoe/posts/xxx", "discarded": false }
    }
  ],
  "meta": { "current_page": 1, "total_pages": 1, "total_count": 1 }
}
```

`me/attempts` は `status: published`、`me/drafts` は `status: draft` に絞る。`generating` と `failed` はどちらにも出ない（後述）。お題の削除状態では絞らない。

### `GET /api/me/favorites`

```json
{
  "posts": [ { "...": "PostSerializer と同形。favorited は常に true" } ],
  "meta": { "current_page": 1, "total_pages": 1, "total_count": 2 }
}
```

### 共通

- 未認証は `401 { "error": "unauthorized" }`（既存の devise の failure app）
- `page` は既存の `PostsController` と同じ丸め込み（数値以外・0以下は1ページ目、上限 100 万）
- 空でもエラーにしない。空配列と `total_count: 0` を返す

## 実装の構え

### `app/controllers/concerns/paginating.rb`（新規）

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
  def page_param
    params[:page].to_s.to_i.clamp(1, MAX_PAGE)
  end
end
```

`PostsController` から `MAX_PAGE` と `page_param` を移す。定数はインクルード先の祖先から解決されるので、`PostsController` 内の `MAX_PAGE` 参照はそのまま通る。

### `AttemptRendering`（`attempt_list_json` を引き上げ）

6-1 が `PostsController#attempt_list_json` に「6-2 が同じ『id 集合ベースの `liked`』を必要とするので、3つ目の呼び出し元が来たら `AttemptRendering` に引き上げる」と書き残している。`me/attempts` と `me/drafts` が2つ目・3つ目なので、ここで引き上げる。

```ruby
# 一覧に並べる挑戦 1 件。いいね済みかは、あらかじめ 1 クエリで引いた id の集合から判定する。
# 単体用の liked? は 1 件ずつ DB を引くので、一覧では使えない。
def attempt_list_json(attempt, liked_ids)
  AttemptSerializer.call(attempt, liked: liked_ids.include?(attempt.id))
end
```

`PostsController` は `AttemptRendering` を include するようになる（`liked?` も入るが、一覧で使ってはいけないことは concern 側のコメントが明示している）。

### `PostSummarySerializer`（新規）

```ruby
# 挑戦アイテムに添える「どのお題への挑戦か」の最小表現。マイページの
# 「自分の挑戦」「下書き」カードが使う（サムネイル・タイトル・リンク先）。
#
# PostSerializer と違い、集計（attempts_count / likes_count）も favorited も持たない。
# カードが使わないうえ、preload した Post には with_counts の別名属性が乗っていないため。
#
# discarded を持つのはここだけ。マイページは削除済みのお題にぶら下がる自分の挑戦も
# 出すので（4-4 案A：片付ける手段を残す）、フロントが描き分けるのに要る。
#
# その削除済みのお題では、タイトルと画像を伏せて id と discarded だけにする
# （上の「ただし削除済みのお題は、タイトルと画像を伏せる」節が根拠）。
class PostSummarySerializer
  def self.call(post)
    discarded = post.discarded?

    {
      id: post.id,
      title: discarded ? nil : post.title,
      image_public_id: discarded ? nil : post.image_public_id,
      discarded: discarded
    }
  end
end
```

### `UserSerializer`（`private_profile_with_stats` を追加）

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

### `User`（統計の3メソッド）

```ruby
# マイページのプロフィールヘッダーに出す統計。集計条件は他の一覧と揃える
# （削除済みは数えない・挑戦は公開済みのみ）。
def kept_posts_count = posts.kept.count

def published_attempts_count = attempts.kept.published.count

# 自分の挑戦が集めたいいねの総数。お題の削除状態は見ない（得た票は消えないし、
# me/attempts の母集合と揃える）。集計条件は Attempt のスコープから組み立てる。
def likes_received_count
  Like.joins(:attempt).merge(Attempt.kept.published).where(attempts: { user_id: id }).count
end
```

### `Post`（`for_listing` の切り出しと `favorited_by`）

```ruby
# 一覧で返すお題の読み込み方。listing とマイページの各一覧が共有する。
scope :for_listing, -> { kept.includes(:user).with_counts }

# マイページのお気に入り一覧。並びは「お気に入りした順」なので favorites 側の時刻で並べる
# （お題の新着順にすると、古いお題を今お気に入りしても奥に埋もれる）。
# kept で絞るのは 5-2 が削除済みお題の解除を 404 にしているため（設計書参照）。
scope :favorited_by, ->(user) {
  for_listing.joins(:favorites).where(favorites: { user_id: user.id })
             .order(Favorite.arel_table[:created_at].desc, Favorite.arel_table[:id].desc)
}
```

`listing` は `search_by_title(q).for_listing` に書き換える（発行される SQL は変わらない）。

`joins` を足しても `total_count` は壊れない。`favorites` には `(user_id, post_id)` の複合ユニークインデックスがあり、1つのお題が2行に増えることがないため `distinct` は要らない。

### `Attempt`（`listing_for_user`）

```ruby
# マイページの「自分の挑戦」「下書き」の組み立て口。listing_for（お題詳細）と対になる。
#
# お題は kept で絞らない。Post#discard は挑戦にカスケードしないので、削除済みお題の
# 下に自分の挑戦が残る。ここで隠すと片付ける手段（DELETE /api/attempts/:id）に
# 辿り着けなくなる（4-4 案A の前提）。削除済みかどうかは PostSummarySerializer が返す。
def self.listing_for_user(user, status:)
  kept.where(user: user, status: status).includes(:user, :post).with_likes_count.recent
end
```

`includes(:user)` は `AttemptSerializer` が投稿者を出すため。常に本人なので preload は1クエリで済む。

### `Api::MeController`

```ruby
module Api
  # ログイン中のユーザー自身のデータ。マイページ（7-6）の4タブとヘッダーを賄う。
  class MeController < ApplicationController
    include AttemptRendering
    include Paginating

    before_action :authenticate_user!

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

    def attempts = render_attempts(Attempt.listing_for_user(current_user, status: :published))

    # 下書きも Attempt なので応答キーは attempts のまま。URL だけを分ける。
    def drafts = render_attempts(Attempt.listing_for_user(current_user, status: :draft))

    def favorites
      posts = Post.favorited_by(current_user).page(page_param)

      render json: {
        # この一覧に載っている時点でお気に入り済み。判定クエリは引かない。
        posts: posts.map { |post| PostSerializer.call(post, favorited: true) },
        meta: PaginationSerializer.call(posts)
      }
    end

    private

    def render_attempts(relation)
      attempts = relation.page(page_param)
      liked_ids = Like.liked_attempt_ids(current_user, attempts.map(&:id))

      render json: {
        attempts: attempts.map { |attempt| my_attempt_json(attempt, liked_ids) },
        meta: PaginationSerializer.call(attempts)
      }
    end

    # マイページの挑戦カードは「どのお題への挑戦か」が要る。AttemptSerializer は変えず、
    # 呼び出し側で最小サマリを足す（お題詳細の挑戦一覧は post が自明なので付けない）。
    def my_attempt_json(attempt, liked_ids)
      attempt_list_json(attempt, liked_ids).merge(post: PostSummarySerializer.call(attempt.post))
    end
  end
end
```

### `config/routes.rb`

```ruby
get "me"           => "me#show"
get "me/posts"     => "me#posts"
get "me/attempts"  => "me#attempts"
get "me/drafts"    => "me#drafts"
get "me/favorites" => "me#favorites"
```

## クエリ本数（件数に比例しない）

見積もり（上限）と、実装後に測った実数は次のとおり。実数のほうが少ないのは 2 つの理由による。**1 ページに収まる結果では kaminari が `total_count` を COUNT を発行せずに導出する**（ロード済みかつ最終ページが端数なら件数から計算できる）。また **`me/posts` は `current_user.posts` 起点なので `users` の preload 自体がスキップされる**（関連元のレコードが既に手元にあるため）。どちらも「1ページに収まるあいだは」の話で、上限は表のとおり。

| エンドポイント | 内訳（上限） | 上限 | 実測（認証2本を除く） |
|---|---|---|---|
| `me/posts` | 一覧＋集計サブクエリ／総件数／`users` preload／お気に入り判定 | 4 | 2 |
| `me/attempts` ／ `me/drafts` | 一覧＋`likes_count`／総件数／`users` preload／`posts` preload／いいね判定 | 5 | 4 |
| `me/favorites` | 一覧＋集計サブクエリ（`favorites` と JOIN）／総件数／`users` preload | 3 | 2 |
| `me` | 統計3本（認証のためのユーザー取得は devise の分） | 3 | 3 |

いずれも一覧の件数に比例しない。既存の N+1 検査（`count_select_queries` で件数を変えて2回測り、同じであることを見る）を4本すべてに付ける。

`me/attempts` の `includes(:user)` は、`Attempt` 起点のリレーションなので `me/posts` のようにはスキップされず、常に本人1件のための `SELECT users.*` が1本走る。`current_user.attempts` 起点に寄せれば消せるが、`listing_for(post)`（お題詳細）との対称性が崩れるので、1本を払って揃えるほうを選ぶ。

`me/posts` と `me/favorites` の集計は `Post.with_counts` の相関サブクエリ（お題1件につき COUNT が2回）で、6-1 の設計書が指摘した「本数と仕事量は別」の話がここにも当たる。ただし対象は1ページ12件に限られ、`popular` のようにソートのために全行を評価する形にはならない（並びは `posts.created_at` か `favorites.created_at` で、どちらもテーブルの実カラム）。

## テスト

### 追記：`spec/models/user_spec.rb`

- `#kept_posts_count` … 削除済みのお題を数えない／他人のお題を数えない
- `#published_attempts_count` … 下書き・生成中・失敗・削除済みを数えない／他人の挑戦を数えない
- `#likes_received_count` … 自分の公開済み挑戦へのいいねを数える／下書き・削除済み挑戦へのいいねは数えない／他人の挑戦へのいいねは数えない／**削除済みのお題にぶら下がる挑戦のいいねは数える**（定義の固定）

### 追記：`spec/models/post_spec.rb`（`.favorited_by` を新設）

- お気に入りした新しい順に返る（**作成順は期待する順序の逆にする**。作成順と一致させると、並び替えを消しても green のままで何も守らない）
- 他人がお気に入りしたお題を含めない／自分がお気に入りしていないお題を含めない
- 削除済みのお題を含めない
- `attempts_count` / `likes_count` が乗っている（`for_listing` 経由であることの固定）

### 追記：`spec/models/attempt_spec.rb`（`.listing_for_user` を新設）

- `status: :published` は公開済みだけ、`status: :draft` は下書きだけを返す（生成中・失敗はどちらにも出ない）
- 他人の挑戦・削除済みの挑戦を含めない
- **削除済みのお題にぶら下がる自分の挑戦は含める**（この issue の決定の固定）
- 新着順に返る（作成順は期待の逆）

### 追記：`spec/requests/api/me_spec.rb`

- 応答に `stats` が入り、3つの数が正しい（既存の `eq` で全体比較しているテストの期待値を更新する）
- 新規ユーザーは3つとも 0
- `POST /api/auth/sign_in` の応答には `stats` が**入らない**（拡張範囲を `/api/me` に閉じたことの固定）

### 新規：`spec/requests/api/me/posts_spec.rb` ／ `attempts_spec.rb` ／ `drafts_spec.rb` ／ `favorites_spec.rb`

4本に共通で置くもの。

- 未認証は 401
- 自分のものだけが返る（他人のものが混ざらない）
- 並び順（作成順は期待の逆）
- 13件でページングが効く（`meta` の3つの値と、2ページ目の件数）
- 空なら空配列と `total_count: 0`
- N+1 検査（1件と3件でクエリ本数が同じ）

タブ固有のもの。

- `me/posts` … 削除済みの自分のお題を含めない／`favorited` が本人基準で埋まる
- `me/attempts` … 下書き・生成中・失敗を含めない／削除済みお題ぶら下がりを**含む**／`post` サマリの4キーが正しく、削除済みお題では `discarded: true`
- `me/drafts` … 公開済みを含めない／応答キーが `attempts`
- `me/favorites` … 削除済みのお題を**含めない**／`favorited` が `true`／お気に入りを解除すると消える

### 影響を受ける既存 spec

- `spec/requests/api/me_spec.rb` の1本目（応答全体を `eq` で比較しているので `stats` の追加で落ちる。更新する）
- `spec/requests/api/posts_spec.rb` … `page_param` の移動と `attempt_list_json` の引き上げは挙動を変えないので、そのまま通るはず（通らなければリファクタが等価でないということなので、実装側を直す）

## 変更するファイル

| ファイル | 内容 |
|---|---|
| `backend/config/routes.rb` | `me/posts` / `me/attempts` / `me/drafts` / `me/favorites` の4本 |
| `backend/app/controllers/api/me_controller.rb` | 4アクション追加、`show` を `private_profile_with_stats` に |
| `backend/app/controllers/concerns/paginating.rb` | 新規（`MAX_PAGE` / `page_param`） |
| `backend/app/controllers/concerns/attempt_rendering.rb` | `attempt_list_json` を引き上げ |
| `backend/app/controllers/api/posts_controller.rb` | `Paginating` / `AttemptRendering` を include し、移した2つを削除 |
| `backend/app/serializers/post_summary_serializer.rb` | 新規 |
| `backend/app/serializers/user_serializer.rb` | `private_profile_with_stats` |
| `backend/app/models/user.rb` | 統計3メソッド |
| `backend/app/models/post.rb` | `for_listing` の切り出し、`favorited_by` |
| `backend/app/models/attempt.rb` | `listing_for_user` |
| `backend/spec/models/{user,post,attempt}_spec.rb` | 上記の model spec |
| `backend/spec/requests/api/me_spec.rb` | `stats` |
| `backend/spec/requests/api/me/{posts,attempts,drafts,favorites}_spec.rb` | 新規4本 |
| `docs/issues_backlog.md` | 6-3 に決定事項（削除済みお題の扱い・`stats`・並び）を追記 |
| `docs/screen_and_api_design.md` | 4本の応答の形と `GET /api/me` の `stats` を明記 |

マイグレーション無し。`app/` 配下に新ディレクトリを作らない（`concerns/` と `serializers/` は既存）ので、開発コンテナの restart も不要。

## 完了条件

- マイページ4タブぶんのデータが取得できる（4本とも認証必須・ページング付き・空状態あり）
- `GET /api/me` が `stats` を返し、`posts_count` / `attempts_count` が対応するタブの `meta.total_count` と一致する
- `me/favorites` に削除済みのお題が出ない
- `me/attempts` / `me/drafts` に削除済みのお題にぶら下がる自分の挑戦が出て、`post.discarded` が `true` になる
- 件数を増やしてもクエリ本数が変わらない（4本すべてに N+1 検査）
- `bundle exec rubocop` と `bundle exec rspec` が green

## この issue で作らないもの

- **マイページの画面**（`/mypage`）… 7-6
- **削除済みお題にぶら下がる挑戦への操作（`PATCH` / `generate`）の封じ込め**… 4-4。ここでは**一覧に出すだけ**で、操作の可否には触らない
- **全体ランキング**（`GET /api/rankings`）… 6-2
- **一覧の検索・並び替えパラメータ**（`?q=` / `?sort=`）… マイページのタブに絞り込み UI は無い。必要になってから足す
- **通報履歴のタブ**… 5-3 の範囲。ブリーフの4タブに含まれない
- **`generating` / `failed` な挑戦のタブ**… ブリーフの4タブに含まれない。生成中の挑戦は、生成を起動した画面が手元に持っている `id` をポーリングして追う（7-3）

  **ただしこの issue のあと、`generating` と `failed` はどの一覧にも出ない状態になる**（お題詳細は `kept.published`、`me/attempts` は `published`、`me/drafts` は `draft`）。生成を起動したタブを閉じてから失敗すると、その挑戦の `id` を知る手段が無くなり、本人が消すこともできない（`failed` は `Attempts::Generation` が `draft?` を要求するので再生成もできない）。**6-3 の scope 外だが、放置すると 4-4 案A の「片付ける手段を残す」と矛盾する**ので、別 issue として積んだ（`docs/issues_backlog.md` の **4-5**）。
