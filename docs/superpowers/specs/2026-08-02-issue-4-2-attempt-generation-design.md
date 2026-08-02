# issue 4-2 設計：描写の保存・生成（画像生成はダミー）

- Issue: `docs/issues_backlog.md` の 4-2
- Branch: `feature/issue-4-2`
- 前提: 3-2（Post CRUD）・4-1（Solid Queue）まで完了。背骨は `… → 3-2 → 4-1 → 4-2 →（4-3）→ 5-1 → …`

## 目的

「保存」「画像を生成」の2ボタンと、`draft → generating → published` の状態遷移・即公開・生成回数制限を、
画像生成をダミーにしたまま先に通す。4-3 で差し替わるのは**画像の出どころだけ**という形にする。

## スコープ

**含む**

- `POST /api/posts/:post_id/attempts`（下書き作成）
- `PATCH /api/attempts/:id`（下書き更新）
- `POST /api/attempts/:id/generate`（生成ジョブ起動）
- `GET /api/attempts/:id`（ポーリング／比較ビュー）
- `DELETE /api/attempts/:id`（論理削除）
- `GenerateImageJob`（固定のダミー画像を Cloudinary へ）
- 1日あたりの生成回数上限（`Attempts::Generation`）
- マイグレーション1本（`attempts.generated_at`）
- RSpec（model / lib / job / request）
- `docs/screen_and_api_design.md` の API 一覧の更新
- 4-1 から委譲された本番確認2件（ワーカー稼働確認・メモリ実測）

**含まない**

- 本物の画像生成API（4-3）
- サービス全体の生成キルスイッチ（4-3 の「コスト観点の最小ガード」に含める。4-2 の生成はダミーで実費が 0 のため、
  実費が発生する回に置くのが自然）
- いいね（5-1）、`similarity_score` の算出（拡張）
- フロントの画面（マイルストーン7）

## 方針の確定事項（ユーザー合意済み）

1. **1日の生成回数上限は 3 回/ユーザー**（既定値）。環境変数 `KOTOE_DAILY_GENERATION_LIMIT` で上書きできる。
   - 判断材料（gpt-image-1 / 1024×1024・実ユーザー5人・2026-08-02 時点の単価）:
     low $0.011・medium $0.042・high $0.167 / 枚。上限3回なら low で約 $5/月、medium で約 $19/月。
   - 品質とモデルの選定は 4-3。ここで決めたのは制限ロジックの既定値のみ。
   - 補足: `gpt-image-1` は 2026-10-23 に廃止予定で、4-3 の対象は GPT Image 1.5 / 2 になる。単価は変わりうる。
2. **failed は終端状態**。再試行は新しい下書きを作る（同じ attempt を再生成しない）。
   - 理由: 「1 attempt = 最大 1 回の生成」が保たれるため、消費の記録が `attempts.generated_at` の
     1カラムで正確に数えられる。同じ attempt を再生成できる形にすると `generated_at` が上書きされて
     消費が消えるため、専用テーブル（`generations`）が必要になる。
   - 画面上は「同じ文章のままボタンを押し直す」だけに見える（失敗を検知する時点でユーザーは描写を書いた
     画面におり、描写文はフォームのローカル状態に残っている）。フロントは裏で
     「新しい下書きを作る → 生成する」の2本を叩く。
   - 代償: 失敗後にページを再読み込みした場合の復帰は、フロントが `GET /api/attempts/:id` で
     描写文を埋め直す必要がある（マイルストーン7）。
3. **ダミー画像はリポジトリにコミットした PNG を毎回アップロードする**。
   - `public_id` は Cloudinary の自動採番なので、attempt ごとに別の値になる（4-3 で本物の画像に
     変わったときと同じ形）。
   - 理由: Cloudinary の失敗 → `UploadError` → `failed` 遷移という本番と同じ経路を 4-2 の段階で通せる。
     4-3 の差分が「画像の出どころ」だけになる。
   - コストは 3回/日 × 30日 × 約30KB ≒ 2.7MB/月で、Cloudinary 無料枠（25 credits ≒ 25GB 相当）に対して無視できる。
4. **`description` の最大は 1,000 文字**。
   - バックログには無いが、`description` はそのまま画像生成APIのプロンプトになるため、無制限にすると
     コストとエラーの両方に効く。
   - 判断材料: 丁寧な描写は実測で 300〜500 文字、書き込むタイプでも 800 文字前後。API 側の上限
     （gpt-image-1 は 32,000 文字）は制約にならない。テキスト入力は $5/1M トークン・日本語 1文字 ≒ 0.7〜1
     トークンなので、1,000 文字で約 $0.004 ＝ low 品質の画像代 $0.011 に対して +36%。
     2,000 文字なら +64%、4,000 文字では画像本体より高くなる。
   - カラム型は `text` のまま。制限はモデルのバリデーションだけで持つ（3-3 のタイトル長と同じ考え方）。
   - 後から緩めるのは安全（既存データが違反にならない）。きつくするほうが危険。
5. **同じお題への複数回の挑戦を許可する**。コストの守り手は回数制限であって重複禁止ではない。
6. **自分のお題への挑戦を許可する**。Kotoe は順位を競うラダーではなく、自分で動作を確かめられるほうが実用的。

## 既存コードの調査結果（設計の根拠）

- `attempts` テーブルは 1-1 で作成済み（`description` / `status` / `generated_image_public_id` /
  `similarity_score` / `discarded_at`）。**不足しているのは消費の記録だけ**。
- `Attempt` モデルに `status` の enum（draft / generating / published / failed）、`discard`、
  `with_likes_count`、`listing_for` は実装済み。`description` は presence のみでバリデーションが弱い。
- `Images::Uploader` は `kind: :generated` のフォルダ（`kotoe/<env>/generated`）を**既に持っている**。
  クラスのコメントに「issue 4-2 のジョブはリトライに乗せる」と、この issue の想定が書いてある。
- `Images::Uploader` は `folder` だけを渡しており、`public_id` は Cloudinary の自動採番。
- `config.time_zone = "Asia/Tokyo"` が設定済みで、コメントに「生成回数の1日の上限の日付境界も
  これに従って JST の 0 時になる」と明記されている。
- `config.autoload_lib(ignore: %w[assets tasks])` があるため、`lib/assets/` は Zeitwerk の対象外。
  バイナリの置き場として使える。
- `spec/jobs/solid_queue_spec.rb` に、`around` フックで ActiveJob のアダプタを `:solid_queue` に
  差し替える前例がある（test アダプタでは見られない性質を検証するため）。
- `spec/support/cloudinary.rb` が全 spec で Cloudinary をスタブ済み。
- エラーの形の前例: フィールド単位は `{ errors: { field: [code] } }`（`Api::Auth::RegistrationsController`）、
  リクエスト単位は `{ error: "code" }`（`Api::Auth::FailureApp`）。文言は返さない（i18n はフロント）。
- 所有チェックの形の前例: `current_user.posts.kept.find`（`Api::PostsController#destroy`）。
  他人・削除済み・存在しない ID がすべて `RecordNotFound` → 404 になる。

## データモデルの変更

```ruby
add_column :attempts, :generated_at, :datetime
add_index  :attempts, [:user_id, :generated_at]
```

`generated_at` は「この attempt が生成枠を1つ消費した時刻」。generate の瞬間に一度だけ入り、以後変わらない。
discard しても消さないので、**削除しても回数は戻らない**という規則がデータの形で満たされる。

**`created_at` や `status` では数えられない。** 昨日 draft を作って今日 generate すると `created_at` は
昨日のままなので、前日に下書きを溜めておけば上限をすり抜けられる。

インデックスは回数の判定クエリ（`user_id` ＋ `generated_at` の範囲）に合わせる。既存の
`index_attempts_on_user_id` は先頭列が重なるが、削除しない。マイページの「自分の挑戦一覧」（6-3）が
`user_id` 単独で引くうえ、行数がこの規模では差が出ないため。

## 状態遷移

```
draft ──generate──> generating ──成功──> published（終端・即公開）
                               └─失敗──> failed（終端）
```

- `generate` を受け付けるのは **draft のみ**。それ以外は 422 `attempt_not_draft`。
- `PATCH`（下書き更新）も **draft のみ**。生成後に描写文だけ書き換えられると、公開されている画像と
  説明が食い違うため。
- `published` / `failed` は終端。再試行は新しい下書きを作る（方針2）。
- 生成が成功したら**即公開**。結果を見てから公開を選ぶ導線は作らない（CLAUDE.md のドメイン規則）。

## API 契約

### `POST /api/posts/:post_id/attempts` — 下書き作成（要認証）

リクエスト:

```json
{ "attempt": { "description": "夕暮れの交差点。信号は赤で…" } }
```

応答 **201**:

```json
{ "attempt": { "id": 1, "description": "…", "generated_image_public_id": null,
               "status": "draft", "similarity_score": null,
               "user": { … }, "likes_count": 0, "created_at": "2026-08-02T12:00:00Z" } }
```

- 削除済み・存在しないお題 → **404** `{ "error": "not_found" }`（`Post.kept.find`）
- 空 / 1,000 文字超 → **422** `{ "errors": { "description": ["blank"] } }` / `["too_long"]`
- 未認証 → **401**（`FailureApp`）

`params[:attempt]` はクライアントが型を決められるため、スカラーや配列を送られても `dig` で
`TypeError` にせず通常の 422 として扱う（`Api::PostsController#post_attributes` と同じ形）。

### `PATCH /api/attempts/:id` — 下書き更新（要認証）

応答 **200** `{ "attempt": {...} }`

- 他人の挑戦・削除済み・存在しない ID → すべて **404**（`current_user.attempts.kept.find`）
- draft でない → **422** `{ "error": "attempt_not_draft" }`
- 受け取るのは `description` だけ

### `POST /api/attempts/:id/generate` — 生成起動（要認証）

応答 **202 Accepted** `{ "attempt": { …, "status": "generating" } }`

- 他人・削除済み・存在しない ID → **404**
- draft でない → **422** `{ "error": "attempt_not_draft" }`
- 上限到達 → **422**

```json
{ "error": "generation_limit_reached", "limit": 3, "resets_at": "2026-08-02T15:00:00Z" }
```

「1日」は **JST の暦日**（`config.time_zone = "Asia/Tokyo"`）。0 時にリセットされ、`resets_at` はその時刻。
API が返す時刻は他のフィールド（`created_at`）と同じく **UTC の ISO8601 に揃える**ので、JST 翌日 0 時は
`…T15:00:00Z` になる。判定の基準が JST であることと、線の上での表現を UTC に統一することは両立する。
文言ではなくコードと補助情報を返し、「あと◯時間で回復します」の表示はフロントが組み立てる。

### `GET /api/attempts/:id` — ポーリング／比較ビュー（認証不要）

応答 **200**:

```json
{ "attempt": { … }, "post": { … } }
```

- `published` は誰でも見られる（未認証でも可）
- `draft` / `generating` / `failed` は**本人のみ**。他人からも未認証からも **404**
  （403 にせず存在ごと隠す。未認証は 401 ではなく 404 にする。`published` が認証不要である以上、
  401 を返すと「認証すれば見える何かがある」という情報が漏れるため）
- 削除済み（`discarded_at` あり）は**本人を含め誰からも 404**

`post` も一緒に返す。比較ビュー `/attempts/[id]` が「元画像 vs 再現画像」を並べるため、元画像がこの1本で
揃う必要がある。ポーリング中は `post` が毎回不要に見えるが、用途ごとに応答の形を2種類に分けるより単純で、
この規模では往復が減るぶん有利。

### `DELETE /api/attempts/:id` — 論理削除（要認証）

応答 **204**。`discard!` のみで `generated_at` は消さない（**回数は戻らない**）。
`generating` の最中でも削除できる（ジョブ側が削除済みを検知して何もしない）。

### 応答の組み立て

`AttemptSerializer` / `PostSerializer` をそのまま使う。ただし両者は `with_likes_count` / `with_counts` が
SELECT 句で付ける別名属性に依存しているため、**返す直前にそのスコープ経由で取り直す**
（`Api::PostsController#create` と同じ手）。新規 attempt の `likes_count` は必ず 0 だが、0 を直接埋めずに
取り直すのは、シリアライザの前提を1か所でも崩すと後で気づけなくなるため。

### ルーティング

```ruby
resources :posts, only: %i[index create show destroy] do
  resources :attempts, only: %i[create]
end
resources :attempts, only: %i[show update destroy] do
  post :generate, on: :member
end
```

## 生成の起動：`Attempts::Generation`（PORO）

`lib/attempts/generation.rb`。`Images::Validation` と同じく `error_code` を持つ値オブジェクトを返し
（nil なら成功）、コントローラは判定を持たず HTTP に翻訳するだけにする。

```ruby
Result = Data.define(:error_code, :limit) do
  def ok? = error_code.nil?
end
```

`limit` は `generation_limit_reached` のときだけ入り、コントローラが 422 の本文に載せる
（`resets_at` は時刻の計算なのでコントローラ側で組み立てる）。

```ruby
# draft の判定は DB を書かないのでロックの外で済ませる
return Result.new(error_code: "attempt_not_draft", limit: nil) unless attempt.draft?

attempt.user.with_lock do          # users 行の SELECT ... FOR UPDATE
  if used_today >= daily_limit
    Result.new(error_code: "generation_limit_reached", limit: daily_limit)
  else
    attempt.update!(status: :generating, generated_at: Time.current)
    GenerateImageJob.perform_later(attempt.id)
    Result.new(error_code: nil, limit: nil)
  end
end
```

`with_lock` はブロックの戻り値をそのまま返すので、`break` や `return` でトランザクションを抜けずに済む
（Rails 7 以降、トランザクションブロックからの `return` / `break` はロールバックではなくコミットになる。
その挙動に依存しない書き方にしておく）。

意図は3つ。

1. **`with_lock` が張るトランザクションの中に「上限チェック → status 更新 → enqueue」が全部入る。**
   4-1 の設計が定めた「更新と enqueue を同じトランザクションで囲む」形
   （`docs/superpowers/specs/2026-07-31-issue-4-1-solid-queue-design.md` の「トランザクションの一体性」）が
   ここで満たされる。`ActiveJob::Base.enqueue_after_transaction_commit` は **`false` のまま変えない**。
   ジョブテーブルがアプリと同じ DB にあるため、ロールバックすれば `solid_queue_jobs` の行も一緒に消え、
   孤児ジョブが出ない。
2. **ユーザー行のロックで同時リクエストを直列化する。** これが無いと、連打や2タブからの同時 generate で
   上限チェックを2つとも通過し、枠を超えて課金が発生する（4-3 以降は実費）。ロックの範囲は1ユーザーの行
   だけなので、他のユーザーは待たない。
3. **数えるのは `user.attempts.where(generated_at: Time.zone.now.all_day).count`。**
   discard は default_scope を張らないため `user.attempts` には削除済みも含まれる。**それが狙いどおり**で、
   「削除しても回数は戻さない」がクエリの形そのもので満たされる。

上限値は `KOTOE_DAILY_GENERATION_LIMIT`（既定 3）。ENV はクラス本体ではなくメソッド内で読み、
テストから差し替えられるようにする。

## `GenerateImageJob`

```ruby
def perform(attempt_id)
  attempt = Attempt.kept.generating.find_by(id: attempt_id)
  return if attempt.nil?     # 削除済み / 二重実行 / すでに終端 → 何もしない

  public_id = Images::Uploader.call(dummy_image, kind: :generated)
  attempt.update!(generated_image_public_id: public_id, status: :published)
end
```

- **冪等性は入口の1行で担保する。** `generating` の attempt しか掴まないので、生成中に削除された場合も、
  ジョブが二重に走った場合も、黙って何もせず終わる。
- **失敗の扱いを2段に分ける。**
  - `Images::Uploader::UploadError`（Cloudinary の一時障害）→ `retry_on ... attempts: 3`。
    使い切ったらブロックで `failed` にする。Cloudinary の障害はコードのバグではないので、
    ジョブ自体は失敗扱いにしない。
  - それ以外の例外（コードのバグ）→ `rescue_from(StandardError)` で `failed` にしてから**再送出**する。
    ユーザーは失敗を見られ、開発者は `solid_queue_failed_executions` にエラーが残る。これが無いと
    attempt が永久に `generating` のまま残り、フロントが延々ポーリングする。
  - この2つは**宣言順が意味を持つ**。`rescue_from(StandardError)` を先、`retry_on(UploadError)` を後に書く
    （ActiveJob はハンドラを後勝ちで探すため、逆にすると UploadError も StandardError 側に吸われる）。
    壊れても静かなので job spec で順序ごと固定する。
- ダミー画像は `lib/assets/dummy_generated.png`（1024×1024 のプレースホルダ）を毎回 `Images::Uploader` に
  渡す。`similarity_score` は 4-3 以降なので `nil` のまま。

## テスト

| 置き場所 | 主に守るもの |
|---|---|
| `spec/models/attempt_spec.rb` | `description` の presence / 1,000 文字上限 |
| `spec/lib/attempts/generation_spec.rb` | 上限内で enqueue される／上限到達で `generation_limit_reached`／draft 以外は `attempt_not_draft`／JST の日付境界（前日 23:59 と当日 0:00）／削除済みの生成も数に入る／更新が失敗したときジョブ行も残らない |
| `spec/jobs/generate_image_job_spec.rb` | 成功 → published／UploadError を使い切って failed／想定外の例外は failed かつ再送出／削除済み・generating でない場合は何もしない |
| `spec/requests/api/attempts_spec.rb` | 5本の入出力、401 / 404 / 422、`generating` 中の削除、他人の下書きが 404 になること |

ロールバックの検証だけは ActiveJob の test アダプタでは書けない（enqueue が配列に積まれるだけで DB の
トランザクションと連動しないため）。`spec/jobs/solid_queue_spec.rb` と同じ `around` フックで
`:solid_queue` アダプタに差し替え、savepoint のロールバックで `SolidQueue::Job` が増えないことを見る。

E2E（Playwright）はマイルストーン 8-1 の担当で、この issue では書かない。
フロント単体テストは CLAUDE.md のテスト戦略どおり MVP では導入しない。

## 本番確認（4-1 からの委譲ぶん）

マージ後、本番URLに対して手で行う。

1. `generate` を叩き、`GET /api/attempts/:id` が `generating` → `published` に変わることを確認
   （ワーカーが本番で生きている証拠）
2. Render の Environment に `SOLID_QUEUE_IN_PUMA` が実在することを目視。未設定でもデプロイは成功し、
   ジョブが無言で溜まるだけになるため
3. Render のメトリクスでメモリ実測。512MB に Puma＋supervisor＋dispatcher＋worker が収まるか。
   収まらなければ有料ワーカーへの切り出しを検討する（`docs/README.md` の無料枠の節のとおり、
   $7 のワーカーは連鎖が切れて実質 $26/月になる）
4. 確認に使ったスモークデータの後始末（8-2a から持ち越しているぶんも含めて）

結果は `docs/README.md` の無料枠の節に追記する。

## ドキュメントの更新

- `docs/screen_and_api_design.md`：挑戦の API 一覧に、確定した応答の形とエラーコード
  （`attempt_not_draft` / `generation_limit_reached`）を反映する
- `docs/issues_backlog.md`：4-2 のチェックボックスを埋める
- `docs/README.md`：本番確認の実測値（メモリ）を無料枠の節に追記する
