# issue 4-4 削除済みのお題にぶら下がる挑戦への操作を塞ぐ 設計

- 対象 issue：`docs/issues_backlog.md` 4-4（GitHub #85）
- 依存：4-2（挑戦の作成と生成起動）
- 作成日：2026-08-25
- 前提：`docs/superpowers/specs/2026-08-09-issue-5-1-like-api-design.md`（同じ穴を `LikesController` で塞いだ回。同じ形を使う）
- 前提：`docs/superpowers/specs/2026-08-23-issue-6-3-mypage-api-design.md`（マイページが削除済みお題の下の挑戦を出す判断。この issue の案A が前提になっている）

## この issue で直すもの

`Post#discard` は挑戦にカスケードしない（`has_many :attempts, dependent: :restrict_with_exception` で discard のコールバックは無い）。お題を論理削除しても、その下の挑戦は `attempts.discarded_at` が nil のまま残る。挑戦だけを見て絞っている経路では、**読み取り API から辿れないのに書き込みだけ通る**。

`Api::AttemptsController` の `owned_attempt`（`current_user.attempts.kept.find(params[:id])`）はお題の状態を見ていない。これを使う `PATCH` / `POST :generate` / `DELETE` の3つが穴になっている。

同じ穴は 5-1 のレビューで `LikesController` に見つかり、`joins(:post).merge(Post.kept)` で塞いだ（PR #82）。今回はその形を `AttemptsController` にも当てる。

マイグレーションもモデルの追加も無い。変更するのはコントローラ1ファイルと、その request spec だけ。

### 塞げている経路（比較用・変更しない）

| 経路 | 塞いでいるもの |
|---|---|
| `POST /api/posts/:post_id/attempts` | `Post.kept.find` → 404 |
| `GET /api/attempts/:id` | `Post.kept.includes(:user).with_counts.find(attempt.post_id)` → 404 |
| `POST/DELETE /api/attempts/:id/like` | `Attempt.kept.published.joins(:post).merge(Post.kept)` → 404（5-1） |
| お題一覧・詳細の挑戦一覧 | `Post.kept` 起点なので出ない |

### いちばん困るのは `generate`

削除済みのお題の下書きから画像生成ジョブを積める。

- 生成枠は **enqueue 時に消費し、削除しても戻らない**（CLAUDE.md のドメイン規則）。ユーザーは1日の枠を、比較相手のいない結果のために失う
- 実費もかかる（gpt-image-2 low で1枚あたり約 $0.011）
- 生成が成功しても `GET /api/attempts/:id` が 404 になるため、比較ビューは本人でも開けない

被害額はコストガードの4層（アプリ 50枚/日 → Spend alert → Hard limit → 前払いクレジット）で頭打ちになるので 🔵 に置かれているが、失われる枠は個人のもので、ガードでは戻らない。

## 決めたこと

### `DELETE` は塞がない（案A）

`PATCH` と `POST :generate` だけ塞ぎ、`DELETE /api/attempts/:id` はお題が削除済みでも通す。

理由は、**この判断が既に 6-3 の実装に織り込まれているため**。`Attempt.listing_for_user`（`app/models/attempt.rb`）はマイページの一覧でお題を `kept` で絞っておらず、コメントに「ここで隠すと片付ける手段（`DELETE /api/attempts/:id`）に画面から辿り着けなくなる（4-4 案A の前提）」と明記してある。`PostSummarySerializer` も、削除済みお題のカードに `discarded: true` を返して**「残る操作は `DELETE` だけ」**という前提でタイトルと画像を伏せている。3つとも塞ぐ案Bを採ると、この2つを巻き戻すことになる。

考え方としても 5-1 と揃う。いいねの `DELETE` を 422 にせず現状を返したのと同じで、**取り消し・片付けの方向は塞がない**。

### `GenerateImageJob` は変更しない（競合を許容する）

`GenerateImageJob#perform` は `Attempt.kept.generating.find_by(id:)` で取り直しており、ここもお題を見ていない。コントローラだけ塞ぐと「enqueue 後・実行前にお題が削除された」場合に生成が走る。この競合は**許容する**。

窓の大きさと被害：

- 窓は enqueue からワーカーが拾うまで。Solid Queue の `polling_interval` は 1 秒（`config/queue.yml`）なので通常 1〜2 秒。他の生成が詰まっていれば延びる（生成1本は最大 150 秒）
- 窓に入る条件は「ユーザーが生成を押した直後に、お題の作者がそのお題を削除する」
- 通り抜けた場合の損失は **$0.011 と生成枠1つ**。生成された挑戦は `published` になるが、`GET /api/attempts/:id` もお題詳細も `Post.kept` 起点なので他人からは見えず、ベスト再現（6-1）と全体ランキング（6-2）の集計も post 起点なので**順位は汚れない**

塞がなかった理由：

- ジョブ側で止めた挑戦を `generating` のまま返すと、フロントが延々ポーリングする（`GenerateImageJob` のコメントが「この設計で最も避けたい状態」と書いている状態）。避けるには `Attempt::FAILURE_REASONS` に新しい失敗コードを足して `failed` に落とす必要がある
- ところが 4-5 が未対応で、**`failed` はどの一覧 API にも出ない**。つまり「枠を失ったうえに、失った理由も画面から見えない `failed`」を1種類増やすことになる。数秒の窓で $0.011 を止める対価としては見合わない

この競合が通り抜けても、本人の手元には残るものがある。マイページの「自分の挑戦」タブ（`GET /api/me/attempts` → `Attempt.listing_for_user`）はお題を `kept` で絞らないので、生成された再現画像はカードとして本人だけが見られる（お題サマリ側は `PostSummarySerializer` が `title` と `image_public_id` を伏せるため、比較相手の元画像は出ない）。カードに残る `DELETE` で本人が片付けられる。案A が守っているのはこの導線である。

### 404 で返す（403 と分けない）

削除済みお題の下の挑戦への `PATCH` / `generate` は 404。既存の `owned_attempt` が他人の挑戦・存在しない ID・削除済みの挑戦をすべて `RecordNotFound` → 404 にしているのと揃える。403 と分けると「認証すれば触れる何かがある」ことを漏らす（`visible_attempt` と同じ方針）。

`generate` については 422 の `attempt_not_draft` などと違い、**訂正できる操作ではない**（お題が消えている）ので、業務エラーコードを足す必要も無い。

## 実装の構え

### `Api::AttemptsController`（`app/controllers/api/attempts_controller.rb`）

private の取得口を用途で2本に分ける。

```ruby
# PATCH / generate 用。お題が生きていることまで見る。
#
# お題側も見るのは Post#discard が挑戦にカスケードしないため。挑戦だけを見ると
# kept のままなので、読み取り API からは辿れない（お題が 404 になる）のに
# 書き込みだけ通る。とくに generate は、比較相手のいない結果のために
# 1 日の生成枠と実費を失わせる（枠は enqueue 時に消費し、戻らない）。
def editable_attempt
  current_user.attempts.kept.joins(:post).merge(Post.kept).find(params[:id])
end

# DELETE 用。お題の状態は見ない。お題が消えたあとに自分の挑戦を片付ける手段を
# 残すため（4-4 案A）。マイページが削除済みお題の下の挑戦を出しているのは
# この導線が生きている前提（Attempt.listing_for_user 参照）。
def owned_attempt
  current_user.attempts.kept.find(params[:id])
end
```

- `update` と `generate` … `owned_attempt` → `editable_attempt` に差し替える
- `destroy` … `owned_attempt` のまま

`joins(:post).merge(Post.kept)` は `LikesController#likeable_attempt` と同じ形。`Attempt.kept` が付ける `attempts.discarded_at IS NULL` と `Post.kept` が付ける `posts.discarded_at IS NULL` はテーブル修飾が異なるので、`merge` で潰し合わず両方残る。

`owned_attempt` のコメントは、いま「所有チェックの書き忘れが起こりようがない」ことを説明している。2本に分かれると**片方だけお題を見ている**ことが読み手の疑問になるので、両方にその理由を書く。

### 変更しないもの

- `GenerateImageJob` … 上記のとおり競合を許容する
- `Attempts::Generation` … 生成可否の判定は `draft?` と回数だけを見る。お題の生死はコントローラの取得口で決まり、ここに来る時点で通過済み
- `Attempt.listing_for_user` / `PostSummarySerializer` … 案A の前提そのものなので触らない
- `create` / `show` … 既に塞がっている

## テスト

`spec/requests/api/attempts_spec.rb` に3件足す。model spec と job spec は変更が無いので触らない。

### `PATCH /api/attempts/:id`

```ruby
it "お題が削除されていたら 404" do
  post_record.discard!

  patch "/api/attempts/#{attempt.id}",
    params: { attempt: { description: "after" } },
    headers: auth_headers(token), as: :json

  expect(response).to have_http_status(:not_found)
  expect(attempt.reload.description).to eq("before")
end
```

### `POST /api/attempts/:id/generate`

この issue の本体。404 だけでなく、**枠も実費も消費しない**ことまで見る（完了条件がそう書かれている）。

```ruby
it "お題が削除されていたら 404。ジョブも積まれず、生成枠も消費しない" do
  post_record.discard!

  expect {
    post "/api/attempts/#{attempt.id}/generate", headers: auth_headers(token), as: :json
  }.not_to have_enqueued_job(GenerateImageJob)

  expect(response).to have_http_status(:not_found)
  expect(attempt.reload).to be_draft
  expect(attempt.generated_at).to be_nil
end
```

### `DELETE /api/attempts/:id`

案A の前提を壊さないための回帰テスト。**塞がないことを検査する**ので、後から「一貫性のため3つとも塞ぐ」と直されたときにここが落ちる。

```ruby
it "お題が削除されていても片付けられる（4-4 案A）" do
  attempt = create(:attempt, :published, user: user, post: post_record)
  post_record.discard!

  delete "/api/attempts/#{attempt.id}", headers: auth_headers(token)

  expect(response).to have_http_status(:no_content)
  expect(attempt.reload).to be_discarded
end
```

### ミューテーションで検査する

3件を書いたあと、`joins(:post).merge(Post.kept)` を一時的に外して **`PATCH` と `generate` の2件が赤くなること**を確認する。`DELETE` の1件は逆向き（変更を入れても緑のまま、案Bに倒すと赤くなる）なので、`destroy` を `editable_attempt` に差し替えて赤くなることを確認する。

6-1 のとき「green なのに何も守っていない」テストが4件出ているので、この確認は省略しない。

### 影響を受ける既存 spec

無い見込み。既存の `PATCH` / `generate` / `DELETE` のテストはすべて `kept` なお題（`post_record` またはファクトリ既定）の下で挑戦を作っている。実行して確かめる。

## 変更するファイル

| ファイル | 変更 |
|---|---|
| `backend/app/controllers/api/attempts_controller.rb` | `editable_attempt` を追加、`update` / `generate` を差し替え |
| `backend/spec/requests/api/attempts_spec.rb` | request spec 3件を追加 |
| `docs/issues_backlog.md` | 4-4 のタスクを消化し、決めたこと（案A・ジョブは許容）を追記 |

## 完了条件

- 削除済みのお題にぶら下がる挑戦から画像生成を起動できない。生成枠も実費も消費しない
- 同じ挑戦への `PATCH` も 404 になる
- 同じ挑戦への `DELETE` は通り、本人が片付けられる
- `bundle exec rubocop` と `bundle exec rspec` が緑

## この issue で作らないもの

- **`GenerateImageJob` の `Post.kept` チェック** … 上記のとおり許容する。判断ごと「決めたこと」に残したので、後から必要になれば 4-5（`failed` を画面に出す）と一緒に扱う
- **`failed` を画面から見つける導線** … 4-5 の範囲。この issue は書き込みを塞ぐだけで、読み取り側は触らない
- **お題削除時に挑戦をカスケードする** … `dependent: :restrict_with_exception` と、削除済みお題の下の挑戦を本人に見せる 6-3 の判断を巻き戻すことになる。この issue の範囲外
