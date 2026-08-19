# issue 6-1 お題ごとのベスト再現 設計

- 対象 issue：`docs/issues_backlog.md` 6-1（GitHub #19）
- 依存：5-1（いいね API）
- 作成日：2026-08-19
- 前提：`docs/superpowers/specs/2026-07-29-issue-3-2-post-crud-design.md`（`GET /api/posts/:id` の原型。`sort=likes` をこの issue に委譲している）

## この issue で作るもの

お題詳細 `GET /api/posts/:id` に「ベスト再現」を足す。具体的には2つ。

1. **`best_attempts`** … そのお題の挑戦のうち、いいねの多い上位3件。`sort` にも `page` にも影響されず常に同じ内容を返す
2. **`attempts` の並び替え** … `?sort=likes` でいいねの多い順、それ以外（既定）は新着順

モデル層の追加は無い。`likes` テーブル・`Like` モデル・`Attempt.with_likes_count`（いいね数を SELECT 句の相関サブクエリで持つスコープ）は 5-1 までに揃っている。マイグレーションも無い。

## なぜ `best_attempts` を独立したフィールドにするのか

issue 6-1 のタスク文は「`GET /api/posts/:id?sort=likes` で挑戦を再現度（いいね）順に返す（上位3件を強調表示できるように）」で、並び替えしか要求していない。それでも独立フィールドを足すのは、**画面が2つのセクションを同時に出すから**。

`docs/design_briefs.md` の 3（お題詳細）は、1枚の画面に次の2つを並べると定めている。

- **「このお題のベスト再現」** … いいね上位3件を表彰台風に強調（1位を中央に大きく）
- **「みんなの挑戦」** … 挑戦カードのグリッド。「再現度順／新着順」で並び替え可能、ページング付き

表彰台の3件は、下の一覧が新着順に切り替わっても、2ページ目に進んでも、常に「いいね上位3件」でなければならない。つまり**一覧のソート結果の先頭3件ではなく、独立したデータ**である。

### 却下した案

**案B：`sort=likes` だけ作り、表彰台はフロントが一覧の先頭3件を流用する**

一覧が「いいね順」かつ「1ページ目」のときしか流用が成立しない。新着順に切り替えた瞬間、2ページ目に進んだ瞬間に、表彰台用の2本目のリクエストが要る。フロントに「今のソートが likes かつ page が 1 なら先頭3件を流用、そうでなければ再取得」という分岐が生まれる。API がこの構造をそのまま返せば、その分岐は存在しない。

**案C：`best_attempts` を `page=1` のときだけ返す**

節約できるのは 2 ページ目以降のクエリ2本と JSON 3件分だけで、1ページ12件なので**挑戦が13件を超えたお題でしか発生しない**。代償のほうが大きい。

- レスポンスの型が `best_attempts?: Attempt[]` になり、参照のたびに存在チェックが要る（`any` を避けて型を付ける方針と噛み合わない）
- フロントが「`best_attempts` は前の値を保持し、`attempts` と `meta` だけ差し替える」というマージロジックを持つ必要がある。案A なら返ってきたレスポンスで state を丸ごと差し替えるだけで正しい
- 将来 Server Component でレンダリングする場合、`page=2` のレンダリング時に表彰台のデータが手元に無く、そもそも描画できない

## エンドポイント仕様

### `GET /api/posts/:id`（変更）

認証不要（ログインしていれば `favorited` / `liked` が本人基準で埋まる。既存の挙動）。

| パラメータ | 値 | 既定 |
|---|---|---|
| `sort` | `likes`（いいねの多い順）／それ以外は新着順 | 新着順 |
| `page` | 1ページ12件（`attempts` のみに効く） | 1 |

応答：

```json
{
  "post": { "...": "既存のまま" },
  "best_attempts": [ "いいね上位3件。sort / page によらず常に同じ" ],
  "attempts": [ "sort と page に従う。1ページ12件" ],
  "meta": { "current_page": 1, "total_pages": 1, "total_count": 1 }
}
```

`best_attempts` の各要素は `attempts` と同じ `AttemptSerializer` の形（`liked` を含む）。`meta` は今までどおり `attempts` のページングだけを指す。**`best_attempts` にページングは無い**。

削除済み・存在しない ID が 404 になる挙動は変わらない。

## 決めたこと

### 表彰台の3件は「みんなの挑戦」一覧にも重複して出す

一覧から除外しない。1位の挑戦は表彰台にも一覧にも現れる。

除外すると kaminari と噛み合わない。`total_count` と OFFSET から3件を差し引く必要が出て、12件固定のはずのページに9件しか出ない、ページ境界で重複や抜けが出る、という形で壊れる。さらに一覧が新着順のときは3件が一覧のどこに現れるかが変わるため、除外の実装が `sort` ごとに別物になる。

表彰台は「同じ挑戦を別の切り口で見せるセクション」と割り切る。デザインブリーフも表彰台を「強調表示」と書いており、一覧からの移動ではない。

### いいねが0件でも `best_attempts` は上位3件を返す

誰もいいねしていないお題では、`best_attempts` は実質「新着3件」になる（`likes_count DESC` の同着を `created_at DESC` でタイブレークするため）。それでも API 側では絞らない。

「全員0いいねなら表彰台を出さない」という判断は見せ方の問題で、フロントの責務（CLAUDE.md「ルールの判定はバック、見せ方はフロント」）。`likes_count` がレスポンスに入っているので、フロントは `best_attempts.every(a => a.likes_count === 0)` で判定できる。API が空配列を返してしまうと、フロントは「まだ誰も挑戦していない」と「挑戦はあるがいいねが0」を区別できなくなる。

### 公開クエリの値は `sort=likes`（お題一覧の `popular` と揃えない）

`docs/screen_and_api_design.md` が、お題一覧を `?sort=new|popular`、お題詳細の挑戦一覧を `?sort=likes` と別々に定義している。不揃いだが、既に公開仕様として書かれているのでそちらに合わせる。

内部のスコープ名は `Attempt.popular` にして `Post.popular` と対称にする。「公開クエリの値」と「スコープ名」は別物なので、`listing_for` の中で1回だけ翻訳する。

未知の値（`sort=nonsense`）は新着順にフォールバックする。`Post.listing` と同じ扱いで、エラーにしない。

### ベスト再現の定義を `Attempt.best_for` 1か所に閉じる

`best_for` は `listing_for(post, sort: "likes").limit(3)` として実装する。「ベスト再現＝いいね順の先頭3件」以上の意味を持たせない。

こうすると、`best_attempts` と `attempts?sort=likes` の並び順が定義上ずれない。将来「上位3件」を5件にする、あるいは「いいね1件以上」に絞る、といった変更が来たときの変更点も1か所で済む。

件数は `Attempt::BEST_LIMIT = 3` の定数にする。デザインブリーフの「表彰台」は3枠が前提なので、フロントも同じ数を持つが、それは表示の都合（1位を中央に大きく）であって API の制約ではない。

### 増えるクエリは2本。ページングとは無関係に固定

`Attempt.listing_for(post).limit(3)` は実測で SQL 2本を発行する。

1. `SELECT attempts.*, (SELECT COUNT(*) FROM likes ...) AS likes_count FROM attempts WHERE ... LIMIT 3`
2. `SELECT users.* FROM users WHERE id IN (...)` … `includes(:user)` の preload

`includes` を `eager_load`（LEFT JOIN で1本にまとめる）に変える最適化はしない。3行のための1本を削るために `listing_for` の読み込み戦略を分岐させると、一覧側と挙動が揃わなくなる。

**いいね済み判定のクエリは増やさない。** `Like.liked_attempt_ids` は id の集合に対して1クエリで引く設計なので、表彰台と一覧の id を束ねて1回だけ呼ぶ。

```ruby
liked_ids = Like.liked_attempt_ids(current_user, attempts.map(&:id) | best_attempts.map(&:id))
```

結果として `show` のクエリ**本数**は「お題1本 ＋ 一覧2本 ＋ 総件数カウント1本 ＋ 表彰台2本 ＋ いいね判定1本 ＋ お気に入り判定1本」の8本で、**挑戦の件数に比例しない**。PR #87 で入れた N+1 検査がこれを守る。

**ただし本数と仕事量は別**で、N+1 検査は本数しか数えない。`EXPLAIN` で確認すると、`recent`（既定）では `likes_count` の相関サブクエリが `Limit` の**上**で評価され、返す12行ぶんしか COUNT が走らない。対して `popular` は `Sort` の**下**で評価されるため、**そのお題の公開済み挑戦すべて**に対して COUNT が走る。`best_for` は `sort` の指定によらず毎リクエスト呼ばれるので、お題詳細の DB 仕事量は「12回の COUNT」から「O(そのお題の挑戦数) 回の COUNT」に変わる。

`index_likes_on_attempt_id` があるので当面は問題にならないが、**ここが劣化しても N+1 検査は赤くならない**。6-2（全体ランキング）でカウンタキャッシュ列を判断するときの材料にすること。

### 集計ソート用のインデックスは足さない

`likes_count` は SELECT 句の相関サブクエリの別名で、Postgres は「そのお題の挑戦を全行取り出す → 行ごとにサブクエリで COUNT → 別名でソート」という順に評価する。**この形にインデックスは効かない**（ソート対象がテーブルの列ではないため）。

それでも今回は足さない。対象は常に単一のお題にぶら下がる挑戦で、母数が「1つのお題への挑戦数」に限られる。お題一覧（3-4）のようにテーブル全体を舐める話ではない。

効かせるならカウンタキャッシュ列（`attempts.likes_count`）が必要だが、`Like` は解除時に物理削除するので counter cache 自体は正しく動くものの、**そのとき初めて「いいね数を持つ列」が二重管理になる**（現在は `Post.with_counts` / `Attempt.with_likes_count` の相関サブクエリが唯一の正）。全体ランキング（6-2、テーブル全体をいいね順に舐める）で本当に必要になったときに、一括で判断する。この issue では相関サブクエリのままにする。

## 実装の構え

### `Attempt`（`app/models/attempt.rb`）

```ruby
# 表彰台（ベスト再現）の枠数。デザイン上の「1位を中央に大きく」は3枠が前提。
BEST_LIMIT = 3

# likes_count は with_likes_count が SELECT 句で付ける別名。単体では使えないので
# 必ず listing_for / best_for 経由で呼ぶこと（Post.popular と同じ理由・同じ形）。
scope :popular, -> { order(Arel.sql("likes_count DESC")).order(created_at: :desc, id: :desc) }

# お題詳細に出す挑戦の組み立て口。他人の下書きを見せないのがここの要点。
#
# 公開クエリの値は "likes"（お題一覧の "popular" と不揃いだが
# docs/screen_and_api_design.md がそう定義している）。翻訳はここ1か所で行う。
def self.listing_for(post, sort: nil)
  relation = kept.published.where(post: post).includes(:user).with_likes_count

  sort == "likes" ? relation.popular : relation.recent
end

# ベスト再現＝いいね順の先頭 BEST_LIMIT 件。定義をここ1か所に閉じることで、
# attempts?sort=likes の並びと best_attempts の並びが定義上ずれない。
def self.best_for(post) = listing_for(post, sort: "likes").limit(BEST_LIMIT)
```

`listing_for` は既存メソッドにキーワード引数を足す形になる。既定値 `nil` を置くので、既存の呼び出し（`PostsController#show` のみ）と model spec はそのまま通る。

### `Api::PostsController#show`

```ruby
def show
  post = Post.kept.includes(:user).with_counts.find(params[:id])
  attempts = Attempt.listing_for(post, sort: params[:sort]).page(page_param)
  best_attempts = Attempt.best_for(post)
  # 表彰台と一覧は同じ挑戦を含みうる。いいね済み判定は id を束ねて 1 クエリのまま引く
  # （1 件ずつ引くと N+1 になる）。未ログインなら空集合が返り、すべて false になる。
  liked_ids = Like.liked_attempt_ids(current_user, attempts.map(&:id) | best_attempts.map(&:id))

  render json: {
    post: PostSerializer.call(post, favorited: favorited?(post)),
    # 表彰台は sort / page によらず常にいいね上位。一覧とは別セクションなので
    # 重複して現れる（除外すると kaminari の件数計算が壊れる。設計書参照）。
    best_attempts: best_attempts.map { |a| AttemptSerializer.call(a, liked: liked_ids.include?(a.id)) },
    attempts: attempts.map { |a| AttemptSerializer.call(a, liked: liked_ids.include?(a.id)) },
    meta: PaginationSerializer.call(attempts)
  }
end
```

`AttemptSerializer` は変更しない。表彰台と一覧で同じ形を返す。

シリアライズの繰り返しが2箇所に増えるので、`liked_ids` を閉じ込めたローカルの lambda に切り出すかは実装時に判断する（現状の2行なら直書きで足りる見込み）。

### 変更しないもの

- `AttemptSerializer` … 順位（`rank`）フィールドは足さない。表彰台の並び順は配列の順序そのもので、1位・2位・3位はフロントが index から決められる
- `AttemptsController#show`（比較ビュー） … 挑戦1件とお題を返すだけで、挑戦一覧を含まない
- `Post` モデル、`PostSerializer`、ルーティング、DB

## テスト

### 追記：`spec/models/attempt_spec.rb`（`.listing_for` の describe に追記＋`.best_for` を新設）

`.listing_for`

- `sort: "likes"` でいいねの多い順に並ぶ
- `sort: "likes"` の同着は新着順、`created_at` も同着なら id の降順（ページ間の重複・抜け防止の固定）
- 未知の `sort` は新着順にフォールバックする（いいねの多い古い挑戦が先頭に来ないこと）

`.best_for`

- いいね上位3件を返す（4件以上あっても3件で頭打ち）
- 挑戦が3件未満ならその件数だけ返す／0件なら空
- 下書き・削除済み・他のお題の挑戦を含めない（`listing_for` 経由であることの固定）

### 追記：`spec/requests/api/posts_spec.rb`（`GET /api/posts/:id`）

- `sort=likes` で `attempts` がいいねの多い順になる
- 未知の `sort` は新着順にフォールバックする
- `best_attempts` がいいね上位3件を、`sort` の指定によらず同じ順で返す
- `best_attempts` が `page=2` でも同じ内容で入る（案C を採らなかったことの固定）
- `best_attempts` の要素が `attempts` と同じ形（`liked` を含む）で、ログイン時に `liked` が正しく埋まる
- `best_attempts` は下書き・削除済みを含まない
- 挑戦が0件なら `best_attempts` は空配列
- **既存の N+1 検査が引き続き green**（挑戦を1件→3件に増やしてもクエリ数が変わらない）

`sort=likes` で13件以上を作ってページングと併用するケースは足さない。ページングの検査は既存の「1ページ12件」で済んでおり、`sort` はページングの実装に触らない。

### 影響を受ける既存 spec

`spec/models/attempt_spec.rb` の `.listing_for`（既存5本）と `spec/requests/api/posts_spec.rb` の `GET /api/posts/:id`（既存10本）。`listing_for` のキーワード引数には既定値を置くので、どちらも変更なしで通るはず。既存の期待値に `best_attempts` を書き足す必要があるのは、レスポンス全体を `eq` で比較しているテストだけ（現状は `attempts.first` を `eq` で比較しており、トップレベルは `eq` していないので該当なしの見込み）。

## 変更するファイル

| ファイル | 内容 |
|---|---|
| `backend/app/models/attempt.rb` | `BEST_LIMIT` / `popular` スコープ / `listing_for(post, sort:)` / `best_for(post)` |
| `backend/app/controllers/api/posts_controller.rb` | `show` に `best_attempts` と `sort` を通す |
| `backend/spec/models/attempt_spec.rb` | `.listing_for` の sort と `.best_for` を追記 |
| `backend/spec/requests/api/posts_spec.rb` | `sort=likes` と `best_attempts` を追記 |
| `docs/issues_backlog.md` | 6-1 のタスクを完了に。`best_attempts` を足したこと、3-2 からの委譲が解けたことを追記 |
| `docs/screen_and_api_design.md` | `GET /api/posts/:id` の行に `best_attempts` と `sort=likes` を明記 |

マイグレーション無し。新規ファイル無し（`app/` に新ディレクトリを作らないので restart も不要）。

## 完了条件

- `GET /api/posts/:id?sort=likes` で挑戦がいいねの多い順に返る。未知の `sort` は新着順に落ちる
- `best_attempts` がいいね上位3件を返し、`sort` と `page` を変えても内容が変わらない
- `best_attempts` に下書き・削除済み・他のお題の挑戦が混ざらない
- 挑戦の件数が増えてもクエリ数が増えない（既存の N+1 検査が green）
- `bundle exec rubocop` と `bundle exec rspec` が green

## この issue で作らないもの

- **全体ランキング**（`GET /api/rankings`）… 6-2
- **カウンタキャッシュ列 `attempts.likes_count`** … 必要になるとしたら 6-2。ここでは相関サブクエリのまま
- **順位フィールド（`rank`）** … 配列の順序で表現できる
- **表彰台の UI（1位を中央に大きく）** … 7-3
- **類似度スコアによる並び替え** … 8-4（`similarity_score` の実値化とセット）
