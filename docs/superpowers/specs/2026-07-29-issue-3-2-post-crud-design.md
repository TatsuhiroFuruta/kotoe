# issue 3-2 設計：Post CRUD API

- Issue: `docs/issues_backlog.md` の 3-2
- Branch: `feature/issue-3-2`
- 前提: 3-1（Cloudinary 基盤）まで完了。backbone は `… → 8-2a → 3-1 → 3-2 → 4-1 → …`

## 目的

お題（Post）の投稿・一覧・検索・詳細・論理削除を API として通す。`Images::Validation` と
`Images::Uploader`（3-1 で作成）の最初の利用者になる。

## 方針の確定事項（ユーザー合意済み）

1. **スコープはバックエンドのみ**。
   - 詳細の `?sort=likes`（ベスト再現）は **6-1 に委譲**する。6-1 は 5-1（いいね API）に依存しており、
     3-2 の時点ではいいねを作る手段が無い。ここで実装すると 6-1 が「確認だけ」の空 issue になる。
     3-2 の詳細は挑戦を新着順固定で返し、`sort` を足すだけで 6-1 が済む形にしておく。
   - フロントの `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` と URL 組み立てヘルパは **7-3 / 7-5 に委譲**する。
     3-1 の設計ドキュメントでは 3-2 で入れる想定だったが、3-2 完了時点でも画像を表示する画面は
     まだ無く、消費者のいないコードが残るだけになる。3-1 で見送ったのと同じ理由がそのまま当てはまる。
2. **kaminari と ransack を導入する**。ただし**公開 API のクエリは `?q=&sort=&page=` の平らな形**に固定し、
   ransack の生パラメータ（`q[title_cont]`）は外に出さない。
   - 理由: `docs/screen_and_api_design.md` のルート表が `/posts?q=&page=` と定めており、URL の形は
     どちらにせよ平らになる。生パラメータを通すと API の URL に ActiveRecord の述語が露出し、
     `ransackable_attributes` の許可リストだけが唯一の防御線になる。
   - ransack の実質的な担当は title の部分一致のみ。「人気順」はいいね合計という集計値による並び替えで、
     ransack のソートパラメータでは表現できないため独自スコープになる。それでも導入するのは、
     投稿者名検索などを足すときに API 契約を変えずに済ませるため。
3. **一覧は集計値（`attempts_count` / `likes_count`）を返し、`sort=new|popular` に対応する**。
   - 理由: `docs/design_briefs.md` のお題カードが「元画像・タイトル・投稿者・挑戦数・いいね合計」で、
     `/posts` 画面には「新着順／人気順」トグルがある。3-2 はバックログ上で唯一の「お題一覧 API」issue で、
     並び替えを使う 7-3 の背後に別のバックエンド issue が無い。ここで入れないと 7-3 の途中で
     バックエンドに戻ることになり、「バックエンド先行 → フロントが消費する」という背骨の順序が崩れる。
4. **シリアライザは自前の PORO**（`app/serializers/`）。gem は入れない。
   - 理由: Kotoe のネストは「お題 → 投稿者」「詳細 → 挑戦 → 挑戦者」の 2 段までで、alba の
     最大の強み（深いネストの宣言的記述）が効かない。一方で一覧の主役である集計値の受け渡しは、
     PORO ならただのメソッド引数で済む。alba は `params[...]` 経由の暗黙的な参照になり、
     渡し忘れが実行時まで表面化しない。
   - jbuilder は API モードの本プロジェクトにビュー層を戻すことになるため不採用。
   - 後から alba へ乗り換えることは可能（シリアライザはコントローラの内側に隠れており、
     返す JSON が同じなら外から区別できない）。先に自前で始め、表現の種類が増えて手狭になってから
     移すほうが、入れて剥がすより手間が少ない。

## 既存コードの調査結果（設計の根拠）

- `db/schema.rb` に `posts` / `attempts` / `likes` は 1-1 で作成済み。**マイグレーションは不要**。
- `posts` には `attempts_count` のような counter cache カラムが**無い**。追加もしない（後述）。
- `ApplicationController#user_json` に「本格的なシリアライザ整備は issue 3-2」というコメントがあり、
  この issue がその引き取り先。現在の利用者は `Api::MeController` と auth の 2 コントローラ。
- `Images::Validation` は `error_code` を 1 つ持つ値オブジェクトを返す
  （`image_missing` / `image_too_large` / `image_type_not_allowed`）。
- `Images::Uploader` は失敗を `UploadError` に一本化済み。3-1 の設計時点で
  「3-2 のコントローラは 502 + `image_upload_failed` に変換する」と決めてある。
- `spec/support/cloudinary.rb` が全 spec で Cloudinary をスタブ済み。request spec は追加設定なしで乗れる。
- `Api::Auth::RegistrationsController` がバリデーションエラーの形（`{ errors: { field: [code] } }`）の前例。
- `Api::Auth::FailureApp` がリクエスト単位の失敗の形（`{ error: "code" }`）の前例。401 はここが返す。
- `config/routes.rb` の `namespace :api` に追加するだけでよい。

## API 契約

すべて `/api` 配下、JSON。1 ページ 12 件（`per` はクライアントから指定させない）。

### `GET /api/posts` — 一覧・検索（認証不要）

| パラメータ | 既定 | 内容 |
|---|---|---|
| `q` | なし | タイトルの部分一致（大文字小文字を区別しない） |
| `sort` | `new` | `new`＝新着順／`popular`＝いいね合計の降順 |
| `page` | `1` | ページ番号 |

```json
{
  "posts": [
    {
      "id": 12,
      "title": "夕暮れの交差点",
      "image_public_id": "kotoe/production/posts/xu3k9a",
      "user": { "id": 3, "name": "tatsu" },
      "attempts_count": 5,
      "likes_count": 12,
      "created_at": "2026-07-29T10:00:00Z"
    }
  ],
  "meta": { "current_page": 1, "total_pages": 4, "total_count": 41 }
}
```

- 論理削除済みのお題は返さない（`Post.kept`）。
- `attempts_count` / `likes_count` は **kept かつ published の挑戦のみ**を対象に数える。
  下書き・削除済みの挑戦、およびそれらに付いたいいねは含めない。
- `sort` に未知の値が来たら 400 にせず `new` にフォールバックする。並び替えはトグル UI の都合であり、
  エラー処理をフロントに強いる価値がない。

### `POST /api/posts` — 投稿（認証必須）

`multipart/form-data` で `post[title]` と `post[image]`。

処理順：

1. `Images::Validation` で画像を判定
2. `Post.new(title:)` の `valid?` でタイトルを判定
3. 1 と 2 のエラーを**まとめて**返す（あれば 422 で終了。Cloudinary へは上げない）
4. 両方通ったら `Images::Uploader` → `public_id` を保存 → 201

先にアップロードしてからタイトル未入力に気づく無駄な往復と、参照されないゴミ画像の発生を避ける。

| 状況 | ステータス | ボディ |
|---|---|---|
| 成功 | 201 | `{ "post": { …一覧と同じ形。counts は 0… } }` |
| 検証エラー | 422 | `{ "errors": { "title": ["blank"], "image": ["image_too_large"] } }` |
| Cloudinary 失敗 | 502 | `{ "error": "image_upload_failed" }` |
| 未認証 | 401 | `{ "error": "unauthorized" }`（既存の FailureApp） |

- エラーの形は `RegistrationsController` に合わせ、**フィールド名 → コード配列**。
- 画像のコードは `Images::Validation` が返す値をそのまま使う。`image.image_too_large` と
  接頭辞が重複するが、PORO の定数と JSON の値が一致していたほうが追いやすい。
- `user_id` は params から受け取らず `current_user` から入れる。他人名義の投稿を構造的に不可能にする。

### `GET /api/posts/:id` — 詳細（認証不要）

`page` パラメータは**挑戦一覧のページ**に効く。

```json
{
  "post": { "…": "一覧と同じ形" },
  "attempts": [
    {
      "id": 90,
      "description": "夕日に染まる横断歩道を、傘を差した人が渡っている",
      "generated_image_public_id": "kotoe/production/generated/p2m4x",
      "status": "published",
      "similarity_score": null,
      "user": { "id": 7, "name": "hana" },
      "likes_count": 3,
      "created_at": "2026-07-29T11:00:00Z"
    }
  ],
  "meta": { "current_page": 1, "total_pages": 1, "total_count": 1 }
}
```

- 挑戦は **kept かつ published のみ**、新着順固定。他人の下書きは見せない。
- `?sort=likes` は 6-1 で追加する。
- 論理削除済みのお題は 404。

### `DELETE /api/posts/:id` — 論理削除（認証必須）

- 成功：204 No Content（ボディ無し）
- 他人の投稿／存在しない／既に削除済み：すべて **404** `{ "error": "not_found" }`

403 と 404 を分けない理由：実装が `current_user.posts.kept.find(params[:id])` の一行で済み、
所有チェックの書き忘れが起こりようがない。お題自体は一覧・詳細で公開されているため、
404 に寄せても隠せる情報が増えるわけではなく、単純さを取る。

`discard` するだけで、紐づく挑戦・お気に入りには触れない（CLAUDE.md：物理削除しない）。

### 共通

`ActiveRecord::RecordNotFound` を `ApplicationController` で捕まえ、404 + `{ "error": "not_found" }`
を返すハンドラを追加する。現在は API モードなのに HTML のエラーページ経路に落ちるため、JSON に揃える。

## 集計をどう解くか（設計の中心）

`attempts_count` / `likes_count` に **counter cache カラムは追加しない**。counter cache は
`discard`（`discarded_at` を立てるだけの UPDATE）を検知できず、削除済みの挑戦を数え続けてしまう。

代わりに **SELECT 句の相関サブクエリ**で取る。

```ruby
class Post < ApplicationRecord
  scope :with_counts, -> {
    select("posts.*",
           "(#{attempts_count_sql}) AS attempts_count",
           "(#{likes_count_sql}) AS likes_count")
  }

  # 条件（kept / published）は Attempt 側のスコープから組み立てる。
  # 生の WHERE を手書きしないので、published の定義が変わっても 1 か所で追随する。
  def self.attempts_count_sql
    Attempt.kept.published.where("attempts.post_id = posts.id").select("COUNT(*)").to_sql
  end

  def self.likes_count_sql
    Like.joins(:attempt).merge(Attempt.kept.published)
        .where("attempts.post_id = posts.id").select("COUNT(*)").to_sql
  end
end
```

この形を選ぶ理由：

- **1 クエリで完結する。** 別途カウント用のクエリを投げてシリアライザに Hash を注入する必要がない。
  結果として `post.attempts_count` がただの属性として読め、シリアライザが素朴なままでいられる
  （PORO を選んだ利点がそのまま出る）。
- **`GROUP BY` を使わない。** JOIN + GROUP BY で挑戦数といいね数を同時に数えると直積で件数が壊れ、
  さらに kaminari の総件数カウントが `GROUP BY` と噛み合わなくなる。サブクエリなら両方回避できる。
- **人気順の並びが同じ材料で書ける。** Postgres は SELECT の別名で `ORDER BY` できる。

一覧の組み立てはクラスメソッド 1 本に集約する。

```ruby
def self.listing(q: nil, sort: nil)
  relation = kept.includes(:user).with_counts.search_by_title(q)
  sort == "popular" ? relation.popular : relation.recent
end
```

コントローラは `Post.listing(q:, sort:).page(params[:page])` と書くだけになり、絞り込みの正しさ
（削除済みを出さない・下書きを数えない）は model spec で守れる。

ransack はここに入る。許可属性は **title だけ**に絞る。

```ruby
scope :search_by_title, ->(q) { q.blank? ? all : ransack(title_cont: q).result }

def self.ransackable_attributes(_auth_object = nil) = %w[title]
def self.ransackable_associations(_auth_object = nil) = []
```

挑戦側のいいね数も同じ形（`Attempt.with_likes_count`）で取る。

並び順は必ずタイブレークまで決める。`recent` は `created_at` 降順・`id` 降順、`popular` は
`likes_count` 降順・`created_at` 降順・`id` 降順。同着で順序が不定になると、ページ間で同じレコードが
重複したり抜けたりするうえ、spec も不安定になる。

## シリアライザ

`app/serializers/` に置く（Rails が自動で autoload するため設定不要）。

| クラス | 役割 |
|---|---|
| `UserSerializer` | `public_profile`（id, name）／ `private_profile`（id, name, email） |
| `PostSerializer` | お題 1 件。`with_counts` が付けた別名属性を読む |
| `AttemptSerializer` | 挑戦 1 件 |
| `PaginationSerializer` | `meta`（current_page / total_pages / total_count） |

- 「どの属性を出すか」はシリアライザに集約し、コントローラは「どの表現を使うか」だけを選ぶ。
  投稿者情報は一覧・詳細・挑戦一覧の 3 か所に出るため、書き写しによる表現の食い違い
  （うっかり email を含める等）を構造的に防ぐ。
- `as_json` / `attributes` でモデル全体を流し込むことはしない。属性は 1 つずつ明示する。
- 日時は `iso8601` の文字列で返す（UTC）。整形の責務をシリアライザに閉じ込め、
  コントローラごとに形式がぶれないようにする。
- `ApplicationController#user_json` は廃止し、`UserSerializer.private_profile` に寄せる
  （`Api::MeController` / `RegistrationsController` / `SessionsController` を更新）。
- シリアライザ単体の spec は切らず、request spec の「返るキー集合」検証で担保する
  （CLAUDE.md の spec 配置規約に `spec/serializers` が無いため）。

`POST /api/posts` の応答は `Post.with_counts.find(post.id)` で取り直してから渡す。新規レコードには
集計の別名属性が乗っておらず、そのまま渡すと `ActiveModel::MissingAttributeError` になる。
シリアライザ側で `fetch(..., 0)` の既定値を持たせる案は、`with_counts` を付け忘れた一覧が
黙って 0 を返す事故を招くため採らない。まれな経路で 1 クエリ足して表現の一貫性を買う。

## 成果物

| ファイル | 種別 | 内容 |
|---|---|---|
| `backend/Gemfile` | 更新 | `kaminari` / `ransack` |
| `backend/config/initializers/kaminari_config.rb` | 新規 | `default_per_page = 12`、`max_per_page = 12` |
| `backend/app/models/post.rb` | 更新 | `listing` / `with_counts` / `search_by_title` / `recent` / `popular` / ransack 許可属性 |
| `backend/app/models/attempt.rb` | 更新 | `with_likes_count` / `recent` |
| `backend/app/serializers/user_serializer.rb` | 新規 | `public_profile` / `private_profile` |
| `backend/app/serializers/post_serializer.rb` | 新規 | お題 1 件の表現 |
| `backend/app/serializers/attempt_serializer.rb` | 新規 | 挑戦 1 件の表現 |
| `backend/app/serializers/pagination_serializer.rb` | 新規 | `meta` |
| `backend/app/controllers/api/posts_controller.rb` | 新規 | index / create / show / destroy |
| `backend/app/controllers/application_controller.rb` | 更新 | `user_json` 廃止、`RecordNotFound` → 404 JSON |
| `backend/app/controllers/api/me_controller.rb` | 更新 | `UserSerializer` へ差し替え |
| `backend/app/controllers/api/auth/registrations_controller.rb` | 更新 | 同上 |
| `backend/app/controllers/api/auth/sessions_controller.rb` | 更新 | 同上 |
| `backend/config/routes.rb` | 更新 | `resources :posts, only: %i[index create show destroy]` |
| `backend/spec/models/post_spec.rb` | 更新 | listing / 集計 / 検索 / 並び |
| `backend/spec/models/attempt_spec.rb` | 更新 | `with_likes_count` |
| `backend/spec/requests/api/posts_spec.rb` | 新規 | 4 エンドポイント |
| `backend/spec/factories/attempts.rb` | 更新 | `published` / `draft` の trait |
| `docs/issues_backlog.md` | 更新 | 3-2 の完了チェック |

**3-2 に含めないもの**：マイグレーション（スキーマは 1-1 で完成済み）、フロントエンドの変更、
詳細の `sort=likes`（6-1）、本番デプロイ。

## spec で守ること

**model spec（`spec/models/post_spec.rb` / `attempt_spec.rb`）**

- `listing` が削除済みのお題を返さない
- `attempts_count` が draft と discard 済みの挑戦を数えない
- `likes_count` が「削除済み挑戦へのいいね」を数えない
- `search_by_title` が部分一致・大文字小文字非依存で当たる／`q` が空なら全件返す
- `popular` がいいね合計の降順、同数なら新着順
- `Attempt.with_likes_count` が正しい件数を返す

**request spec（`spec/requests/api/posts_spec.rb`）**

- 一覧：ページング境界（13 件目が 2 ページ目）、`meta` の値、未知の `sort` が新着順にフォールバック
- 一覧：**クエリ数がお題の件数に比例しない**（1 件のときと 3 件のときで同数）。N+1 を構造的に防ぐ
- 投稿：成功 201 ／ タイトル空と画像過大を**同時に**返す 422 ／ Cloudinary 失敗の 502 ／
  未認証 401 ／ `user_id` を送っても投稿者は `current_user` になる
- 詳細：他人の下書きが出ない、削除済み挑戦が出ない、削除済みお題は 404
- 削除：204 と `discarded_at` の付与／他人の投稿は 404／紐づく挑戦は消えずに残る
- **キー集合の固定**：`user` が `contain_exactly("id", "name")`（email を漏らさない）、
  `post` のキー一式。`include` ではなく過不足なしで検証し、将来カラムを足したときに spec が赤くなるようにする

## 実装時に確認が要る 2 点

1. **kaminari の総件数と custom select の相性。** `with_counts` が SELECT 句を足しているため、
   kaminari が `COUNT(...)` を組み立てる際に別名を巻き込む可能性がある。`total_count` が正しい値を
   返すことをページング境界の request spec で検証し、崩れる場合は `except(:select)` した関係から数える。
2. **brakeman の SQL インジェクション警告。** `select` に文字列補間を使うため警告が出る可能性がある。
   補間しているのは ActiveRecord が組み立てた SQL のみでユーザー入力は通っていない
   （検索は ransack がプレースホルダ化する）。出た場合は根拠を添えて `config/brakeman.ignore` に登録する。

## 動作確認とデプロイ

CLAUDE.md の段階①に当たる。

1. `docker compose up` でローカル起動
2. ブラウザ／curl で 4 エンドポイントを叩く（投稿は実際に Cloudinary の
   `kotoe/development/posts/` へ上がることを確認）
3. `docker compose exec backend bundle exec rspec` と `bundle exec rubocop` を green にする

**本番デプロイは行わない。** 3-2 には本番固有の統合が無く（Cloudinary の本番疎通は 3-1 で確認済み）、
本番反映はマイルストーンの区切りで行う方針のため。

## 次の issue への引き継ぎ

- **4-2**：`POST /api/posts/:post_id/attempts` を追加する。`Attempt.with_likes_count` と
  `AttemptSerializer` はここで作るものをそのまま使える。
- **6-1**：詳細に `?sort=likes` を足す。`Attempt` に `popular` スコープを 1 つ追加し、
  コントローラで分岐するだけで済む形にしてある。
- **7-3 / 7-5**：フロントの `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` と URL 組み立てヘルパをここで入れる。
  純粋なユーティリティ関数なので Vitest を後付けする候補（CLAUDE.md のテスト方針）。
