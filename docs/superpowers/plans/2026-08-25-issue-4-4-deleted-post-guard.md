# issue 4-4 削除済みお題にぶら下がる挑戦への操作を塞ぐ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 削除済みのお題にぶら下がる自分の挑戦に対して、`PATCH` と `POST :generate` を 404 で塞ぎ、`DELETE` は通したままにする。

**Architecture:** `Api::AttemptsController` の private な取得口を 2 本に分ける。`editable_attempt`（`joins(:post).merge(Post.kept)` でお題の生死まで見る）を `update` と `generate` が使い、既存の `owned_attempt`（お題を見ない）は `destroy` だけが使う。モデル・マイグレーション・ジョブの変更は無い。

**Tech Stack:** Ruby on Rails 8（API モード）／ RSpec（request spec）／ discard ／ FactoryBot ／ shoulda-matchers ／ rubocop-rails-omakase

**Spec:** `docs/superpowers/specs/2026-08-25-issue-4-4-deleted-post-guard-design.md`

## Global Constraints

- **ブランチ**：`feat/issue-4-4-deleted-post-guard`（main から切る。設計書のコミット `800a333` が既に載っている）。main へ直接コミットしない。
- **文字列はダブルクォート**。spec ファイルも含めプロジェクト全体で統一（rubocop-rails-omakase）。
- **コマンドは必ず Docker 経由**で実行する。`docker compose exec backend ...`。ホストで `bundle` を直接叩かない。
- **FactoryBot は `create` で呼ぶ**（`FactoryBot.create` と書かない。設定済み）。
- **論理削除は `discard`**。spec でも `post_record.discard!` を使い、`destroy` しない。
- **エラーは文言ではなくコード**を返す（i18n はフロント）。この issue は 404 だけなので新しいエラーコードは足さない。
- **`GenerateImageJob` を変更しない**。「enqueue 後・実行前にお題が削除された」競合は設計上の判断として許容している（設計書「決めたこと」参照）。
- **`Attempt.listing_for_user` と `PostSummarySerializer` を変更しない**。案A の前提そのもの。
- コミット前に `bundle exec rubocop` と `bundle exec rspec` を通す。

---

## File Structure

| ファイル | 役割 | この計画での扱い |
|---|---|---|
| `backend/app/controllers/api/attempts_controller.rb` | 挑戦の HTTP 入出力。取得口（`owned_attempt` / `visible_attempt`）の責務もここ | **修正**（Task 1）。`editable_attempt` を追加し、`update` / `generate` を差し替え |
| `backend/spec/requests/api/attempts_spec.rb` | 挑戦 API の入出力を縛る request spec | **修正**（Task 1・Task 2）。3 件追加 |
| `docs/issues_backlog.md` | issue 一覧と決定の記録 | **修正**（Task 3）。4-4 のタスク消化と決定事項 |
| `backend/app/jobs/generate_image_job.rb` | 生成ジョブ | **触らない**（Global Constraints 参照） |
| `backend/app/models/attempt.rb` | 挑戦のスコープ | **触らない** |

責務の分割はコントローラ内の private メソッド 2 本で完結する。ファイルは増えない。

---

## Task 1: `PATCH` と `generate` をお題の生死で塞ぐ

**Files:**
- Modify: `backend/app/controllers/api/attempts_controller.rb:21-38`（`update` と `generate` の本体）、`:57-63`（private の取得口）
- Test: `backend/spec/requests/api/attempts_spec.rb`（`PATCH` の describe は 116 行目、`generate` の describe は 180 行目から）

**Interfaces:**
- Consumes: `Post.kept`（discard 由来のスコープ。`posts.discarded_at IS NULL`）、`Attempt#post`（`belongs_to :post`）、`current_user.attempts`（`User has_many :attempts`）
- Produces: `Api::AttemptsController#editable_attempt` → `Attempt`。お題が `kept` な自分の未削除の挑戦を返し、見つからなければ `ActiveRecord::RecordNotFound` を投げる（`ApplicationController` が 404 に変換する）。Task 2 がこのメソッドをミューテーションに使う。

- [ ] **Step 1: 失敗するテストを 2 件書く**

`spec/requests/api/attempts_spec.rb` の `describe "PATCH /api/attempts/:id"` の中、既存の `it "削除済みは 404"`（139 行目）の直後に足す。

```ruby
    # Post#discard は挑戦にカスケードしないので、挑戦だけを見ると kept のまま残る。
    # 読み取り API から辿れない（お題が 404）のに書き込みだけ通る状態を塞ぐ。
    it "お題が削除されていたら 404" do
      post_record.discard!

      patch "/api/attempts/#{attempt.id}",
        params: { attempt: { description: "after" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
      expect(attempt.reload.description).to eq("before")
    end
```

次に `describe "POST /api/attempts/:id/generate"` の中、既存の `it "他人の挑戦は 404"`（193 行目）の直後に足す。

```ruby
    # この issue の本体。生成枠は enqueue 時に消費して削除しても戻らないので、
    # 404 を返すだけでなく「ジョブが積まれない・枠が減らない」ところまで縛る。
    # 通してしまうと、ユーザーは 1 日の枠と実費を、比較相手のいない結果のために失う。
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

どちらの describe も、トップレベルの `let(:post_record) { create(:post) }`（6 行目）と、その describe 内の `let(:attempt)` が `post: post_record` で挑戦を作っていることに依存している。`let` を足す必要は無い。

- [ ] **Step 2: 実行して落ちることを確かめる**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/attempts_spec.rb -e "お題が削除されていたら"
```

期待：2 examples, 2 failures。どちらも 404 を期待して 200 / 202 が返る。`generate` のほうは `expected GenerateImageJob not to have been enqueued` でも落ちる。

- [ ] **Step 3: `editable_attempt` を足して `update` / `generate` を差し替える**

`app/controllers/api/attempts_controller.rb`。`update`（22 行目）と `generate`（32 行目）の `owned_attempt` を `editable_attempt` にする。

```ruby
    def update
      attempt = editable_attempt
      return render_error("attempt_not_draft") unless attempt.draft?
```

```ruby
    def generate
      attempt = editable_attempt
      result = Attempts::Generation.call(attempt)
```

`destroy`（53 行目）は `owned_attempt` のまま変えない。

private の取得口を、既存の `owned_attempt` のコメントごと次の形に置き換える（57〜63 行目）。片方だけお題を見ている理由が、両方に書いていないと読み手に伝わらない。

```ruby
    # PATCH / generate 用。自分の未削除の挑戦のうち、お題も生きているものだけを掴む。
    #
    # current_user.attempts に限定することで、所有チェックの書き忘れが起こりようがない。
    # 他人の挑戦・存在しない ID・削除済みは、すべて RecordNotFound → 404 になる。
    #
    # お題側も見るのは Post#discard が挑戦にカスケードしないため（likeable_attempt と
    # 同じ形・同じ理由）。挑戦だけを見ると kept のままなので、読み取り API からは
    # 辿れない（お題が 404 になる）のに書き込みだけ通る。とくに generate は、
    # 比較相手のいない結果のために 1 日の生成枠と実費を失わせる
    # （枠は enqueue 時に消費し、削除しても戻らない）。
    def editable_attempt
      current_user.attempts.kept.joins(:post).merge(Post.kept).find(params[:id])
    end

    # DELETE 用。お題の状態は見ない。お題が消えたあとに自分の挑戦を片付ける手段を
    # 残すため（4-4 案A）。マイページが削除済みお題の下の挑戦を出しているのは、
    # この導線が生きている前提である（Attempt.listing_for_user 参照）。
    def owned_attempt
      current_user.attempts.kept.find(params[:id])
    end
```

`Attempt.kept` の `attempts.discarded_at IS NULL` と `Post.kept` の `posts.discarded_at IS NULL` はテーブル修飾が異なるため、`merge` で潰し合わず両方残る（`LikesController#likeable_attempt` で実績のある形）。

- [ ] **Step 4: 実行して通ることを確かめる**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/attempts_spec.rb
```

期待：全 example が PASS。新規 2 件を含め failures 0。既存の `PATCH` / `generate` のテストはすべて `kept` なお題の下で挑戦を作っているので、影響を受けない見込み。落ちたものがあれば、その describe の `let` がどのお題を使っているかを確認する。

- [ ] **Step 5: ミューテーションで、テストが実際に穴を捕まえていることを確かめる**

`editable_attempt` から `.joins(:post).merge(Post.kept)` を一時的に外す。

```ruby
    def editable_attempt
      current_user.attempts.kept.find(params[:id])
    end
```

```bash
docker compose exec backend bundle exec rspec spec/requests/api/attempts_spec.rb -e "お題が削除されていたら"
```

期待：**2 examples, 2 failures**。ここが緑のままなら、テストが穴を見ていない（6-1 で「green なのに何も守っていない」テストが 4 件出た前例がある）。確認したら Step 3 の形に戻し、もう一度 Step 4 のコマンドで全体が緑に戻ることを確かめる。

- [ ] **Step 6: rubocop を通してコミット**

```bash
docker compose exec backend bundle exec rubocop
```

期待：offenses なし。

```bash
git add backend/app/controllers/api/attempts_controller.rb backend/spec/requests/api/attempts_spec.rb
git commit -F - <<'EOF'
fix: 削除済みお題にぶら下がる挑戦の更新と生成を塞ぐ

Post#discard は挑戦にカスケードしないため、AttemptsController の
owned_attempt はお題の状態を見ていなかった。読み取り API からは辿れない
（お題が 404 になる）のに、PATCH と generate だけ通る状態だった。

とくに generate が困る。生成枠は enqueue 時に消費して削除しても戻らないので、
ユーザーは 1 日の枠と実費（gpt-image-2 low で約 $0.011）を、比較相手のいない
結果のために失う。生成が成功しても比較ビューは本人でも 404 になる。

取得口を editable_attempt（お題の生死まで見る）と owned_attempt（見ない）に
分け、PATCH と generate だけ前者に差し替える。joins(:post).merge(Post.kept)
の形は 5-1 が LikesController で使ったものと同じ。

joins を外すミューテーションで、追加した 2 件が RED になることを実測済み。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MxYbGREG8LMA7piQGgoZvn
EOF
```

---

## Task 2: `DELETE` が塞がっていないことを回帰テストで固定する

案A（「お題が消えたあとも自分の挑戦を片付けられる」）は 6-3 の `Attempt.listing_for_user` と `PostSummarySerializer` が前提にしている。Task 1 で似た形のガードを入れた直後なので、後から「一貫性のため 3 つとも塞ぐ」と直されやすい。**塞がないことを検査するテスト**を置いて、そのときに落ちるようにする。

このタスクは実装の変更を伴わない。Task 1 の実装に対して最初から緑になる。

**Files:**
- Test: `backend/spec/requests/api/attempts_spec.rb`（`DELETE` の describe は 381 行目から）

**Interfaces:**
- Consumes: Task 1 が残した `Api::AttemptsController#owned_attempt`（`destroy` が使い続けているもの）と `#editable_attempt`（Step 3 のミューテーションで使う）
- Produces: 無し（テストのみ）

- [ ] **Step 1: テストを書く**

`describe "DELETE /api/attempts/:id"` の中、既存の `it "生成中でも削除できる"`（401 行目）の直後に足す。

```ruby
    # 4-4 案A。PATCH と generate はお題の生死を見るが、DELETE だけは見ない。
    # 塞ぐと、マイページに出ている削除済みお題の下の挑戦を片付ける手段が無くなる
    # （Attempt.listing_for_user と PostSummarySerializer がこの導線を前提にしている）。
    # 「塞がっていないこと」を縛るテストなので、3 つとも塞ぐ案に倒したときにここが落ちる。
    it "お題が削除されていても片付けられる（4-4 案A）" do
      attempt = create(:attempt, :published, user: user, post: post_record)
      post_record.discard!

      delete "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(response).to have_http_status(:no_content)
      expect(attempt.reload).to be_discarded
    end
```

この describe の既存テストは `let` ではなく example の中で `create(:attempt, ...)` している（`post_record` を明示していないものが多い）ので、ここでも同じ形にし、`post: post_record` を明示する。

- [ ] **Step 2: 実行して通ることを確かめる**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/attempts_spec.rb -e "お題が削除されていても片付けられる"
```

期待：1 example, 0 failures。Task 1 で `destroy` を変えていないので最初から緑。

- [ ] **Step 3: 逆向きのミューテーションで、テストが効いていることを確かめる**

このテストは「変更が入っていないこと」を見るので、Task 1 と違って**案B に倒すと落ちる**。`app/controllers/api/attempts_controller.rb` の `destroy` を一時的に `editable_attempt` に差し替える。

```ruby
    def destroy
      editable_attempt.discard!
      head :no_content
    end
```

```bash
docker compose exec backend bundle exec rspec spec/requests/api/attempts_spec.rb -e "お題が削除されていても片付けられる"
```

期待：**1 example, 1 failure**（204 を期待して 404）。確認したら `owned_attempt` に戻す。

- [ ] **Step 4: 全体を回してコミット**

```bash
docker compose exec backend bundle exec rspec && docker compose exec backend bundle exec rubocop
```

期待：rspec が failures 0、rubocop が offenses なし。

```bash
git add backend/spec/requests/api/attempts_spec.rb
git commit -F - <<'EOF'
test: 削除済みお題の下でも DELETE が通ることを固定する

4-4 案A は「お題が消えたあとも自分の挑戦を片付けられる」ことを守る判断で、
6-3 の Attempt.listing_for_user（お題を kept で絞らない）と
PostSummarySerializer（削除済みお題のカードに discarded を返す）が
この導線を前提にしている。

直前のコミットで PATCH と generate に似た形のガードを入れたため、後から
「一貫性のため 3 つとも塞ぐ」と直されやすい。塞がっていないことを検査する
テストを置き、そのときに落ちるようにする。

destroy を editable_attempt に差し替えるミューテーションで RED を実測済み。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MxYbGREG8LMA7piQGgoZvn
EOF
```

---

## Task 3: backlog に決定事項を反映する

**Files:**
- Modify: `docs/issues_backlog.md`（4-4 の節。282 行目付近から）

**Interfaces:**
- Consumes: Task 1・Task 2 の成果
- Produces: 無し（ドキュメントのみ）

- [ ] **Step 1: 4-4 の節を書き換える**

見出しの絵文字を 🔵 から 🟢 に変える。

```
### 🟢 4-4. 削除済みのお題にぶら下がる挑戦への操作を塞ぐ
```

「先に決めること」の節（決定前の問いの形になっている）を、決めた内容に置き換える。

```markdown
- **決めたこと**：
  1. **`DELETE` は塞がない（案A）**。`PATCH` と `generate` だけお題の生死を見る。
     6-3 の `Attempt.listing_for_user`（お題を `kept` で絞らない）と
     `PostSummarySerializer`（削除済みお題に `discarded` を返す）が既にこの前提で
     書かれており、案B に倒すと両方を巻き戻すことになる。いいねの `DELETE` を
     422 にしなかったのと同じく、**取り消し・片付けの方向は塞がない**。
  2. **`GenerateImageJob` は変更しない**。「enqueue 後・実行前にお題が削除された」
     競合は許容する。窓は Solid Queue の `polling_interval`（1秒）ぶんで通常 1〜2 秒、
     通り抜けても損失は約 $0.011 と生成枠 1 つ。生成物は `Post.kept` 起点の経路から
     見えず、ベスト再現・ランキングの集計も post 起点なので**順位は汚れない**。
     塞ぐには `Attempt::FAILURE_REASONS` に新コードを足して `failed` に落とす必要が
     あるが（黙って return すると `generating` のまま残りフロントが延々ポーリングする）、
     **4-5 が未対応で `failed` はどの一覧にも出ない**ため、「枠を失った理由が画面から
     見えない failed」を 1 種類増やすことになる。数秒の窓で $0.011 を止める対価としては
     見合わない。必要になれば 4-5 と一緒に扱う。
```

タスクのチェックを埋める。3 つ目のジョブの項目は、やらないと決めた形にする。

```markdown
- タスク：
  - [x] `owned_attempt` を `editable_attempt`（`joins(:post).merge(Post.kept)`）と
        `owned_attempt`（お題を見ない）に分け、`PATCH` / `generate` を前者に差し替え
  - [x] `DELETE` 用に、お題の状態を見ないスコープを別に用意する（＝既存の `owned_attempt`）
  - [x] `GenerateImageJob` は変更しない（決めたこと 2 のとおり競合を許容する）
  - [x] request spec（`PATCH` 404 ／ `generate` 404 かつジョブ非 enqueue かつ枠不変 ／ `DELETE` 204）
- 完了条件：削除済みのお題にぶら下がる挑戦から画像生成を起動できない。生成枠も実費も消費しない。
  → **2026-08-25 に達成。issue 4-4 完了。**
```

- [ ] **Step 2: 7-6 の申し送りを確認する**

`docs/issues_backlog.md` の 7-6（マイページ、496〜500 行目付近）に「**4-4 を先に済ませること**」という依存の注記がある。4-4 が完了したので、その注記が**そのまま残っていてよいか**を読んで判断する。依存の記録としては正しいので、原則は残す。「4-4 より先にこのタブの『生成する』ボタンを出すと…」という未来形の警告文だけ、完了済みであることが分かる形に整える。

- [ ] **Step 3: コミット**

```bash
git add docs/issues_backlog.md
git commit -F - <<'EOF'
docs: issue 4-4 の決定事項と完了を backlog に反映する

決めたことは 2 つ。DELETE は塞がない（案A。6-3 がこの前提で書かれている）。
GenerateImageJob は変更せず、enqueue 後・実行前にお題が削除された競合は
許容する（窓は 1〜2 秒、損失は約 $0.011 と枠 1 つ、順位は汚れない。塞ぐと
4-5 が未対応のまま「理由が画面から見えない failed」を 1 種類増やすことになる）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MxYbGREG8LMA7piQGgoZvn
EOF
```

---

## Task 4: ローカルで実際に叩いて確かめ、レビューを通してから PR を出す

RSpec が緑でも、`app/` にディレクトリを足していない今回のような変更でも、実 HTTP で一度は通しておく（開発の進め方 ①）。

**Files:**
- 変更なし（確認とレビューのみ）

**Interfaces:**
- Consumes: Task 1〜3 の 3 コミット
- Produces: GitHub PR（`Closes #85` を含む）

- [ ] **Step 1: 開発環境を起動する**

```bash
docker compose up -d
docker compose exec backend bin/rails db:migrate
```

期待：マイグレーションは無いので「Migrating」の出力が出ない。

- [ ] **Step 2: rails console で確認用のデータを作る**

```bash
docker compose exec backend bin/rails console
```

```ruby
user = User.first || User.create!(name: "guard", email: "guard@example.com", password: "password123")
post_record = Post.create!(user: user, title: "4-4 確認用", image_public_id: "kotoe/sample_post")
attempt = Attempt.create!(user: user, post: post_record, description: "確認用の描写")
post_record.discard!
puts [ attempt.id, attempt.status, attempt.generated_at.inspect ].inspect
```

出力された `attempt.id` を控える。トークンは既存の `POST /api/auth/sign_in` で取る（`docs/superpowers/specs/2026-07-19-issue-2-1-auth-design.md` 参照）。

- [ ] **Step 3: 3 つのエンドポイントを実際に叩く**

```bash
# PATCH → 404
curl -i -X PATCH http://localhost:3000/api/attempts/<ID> \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"attempt":{"description":"after"}}'

# generate → 404
curl -i -X POST http://localhost:3000/api/attempts/<ID>/generate \
  -H "Authorization: Bearer <TOKEN>"

# DELETE → 204
curl -i -X DELETE http://localhost:3000/api/attempts/<ID> \
  -H "Authorization: Bearer <TOKEN>"
```

期待：上 2 つが `HTTP/1.1 404 Not Found`、最後が `HTTP/1.1 204 No Content`。`generate` のあと `Attempt.find(<ID>).generated_at` が `nil` のままであること（枠を消費していない）を console で確認する。

- [ ] **Step 4: 独立レビューを通す**

```
/code-review
```

自己レビューでは自分の前提を疑えない（過去に自己レビュー 1 件に対し独立レビューが 9 件出た）。指摘が出たら `superpowers:receiving-code-review` に従って一つずつ検証してから直す。無条件に受け入れない。

- [ ] **Step 5: push して PR を出す**

```bash
git push -u origin feat/issue-4-4-deleted-post-guard
```

push は本番に影響しない（Render は main 追跡・PR プレビュー無効）。

```bash
gh pr create --title "fix: 削除済みお題にぶら下がる挑戦への操作を塞ぐ（issue 4-4）" --body-file - <<'EOF'
Closes #85

## 何を直すか

`Post#discard` は挑戦にカスケードしないため、お題を論理削除しても挑戦は
`attempts.discarded_at` が nil のまま残る。`Api::AttemptsController#owned_attempt`
はお題の状態を見ていなかったので、**読み取り API からは辿れないのに `PATCH` と
`generate` だけ通る**状態だった（同じ穴は 5-1 のレビューで `LikesController` に
見つかり PR #82 で塞いでいる）。

いちばん困るのは `generate`。生成枠は enqueue 時に消費して削除しても戻らないので、
ユーザーは 1 日の枠と実費（gpt-image-2 low で約 $0.011）を、比較相手のいない結果の
ために失う。生成が成功しても比較ビューは本人でも 404 になる。

## どう直したか

取得口を用途で 2 本に分けた。

- `editable_attempt` … `current_user.attempts.kept.joins(:post).merge(Post.kept)`。
  `PATCH` と `POST :generate` が使う
- `owned_attempt` … 従来どおりお題を見ない。`DELETE` だけが使う

## 決めたこと

**`DELETE` は塞がない（案A）。** 6-3 の `Attempt.listing_for_user`（お題を `kept` で
絞らない）と `PostSummarySerializer`（削除済みお題に `discarded` を返す）が
「お題が消えたあとも `DELETE` で片付けられる」ことを前提に書かれている。3 つとも塞ぐと
両方を巻き戻すことになる。この前提を守る回帰テストも足した。

**`GenerateImageJob` は変更しない。** 「enqueue 後・実行前にお題が削除された」競合は
許容する。窓は Solid Queue の `polling_interval`（1 秒）ぶんで通常 1〜2 秒、通り抜けても
損失は約 $0.011 と枠 1 つで、生成物は `Post.kept` 起点の経路から見えず順位も汚れない。
塞ぐには `FAILURE_REASONS` に新コードを足して `failed` に落とす必要があるが、4-5 が
未対応で `failed` はどの一覧にも出ないため、「枠を失った理由が画面から見えない failed」を
1 種類増やすことになる。見合わないと判断した。

## テスト

request spec を 3 件追加。

- `PATCH` … 削除済みお題の下書きは 404、`description` も変わらない
- `generate` … 404 に加えて **ジョブが積まれず `generated_at` も nil のまま**（枠を消費しない）
- `DELETE` … 削除済みお題の下でも 204。案A の前提を壊さないための回帰テスト

3 件とも**ミューテーションで RED を実測済み**。前 2 件は `joins(:post).merge(Post.kept)` を
外して、最後の 1 件は `destroy` を `editable_attempt` に差し替えて落ちることを確認した。

ローカルで実 HTTP でも 404 / 404 / 204 を確認済み。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

PR 本文の末尾は `Generated with Claude Code` の 1 行まで。**セッションリンクを載せない**（public リポジトリ）。

- [ ] **Step 6: CI が緑になることを確かめる**

```bash
gh pr checks --watch
```

rubocop / rspec / brakeman / bundler-audit。bundler-audit が脆弱性 DB の更新で落ちた場合は、この PR に混ぜず `fix/<gem>-<version>` の単独 PR を先に出す（CLAUDE.md「依存の脆弱性への対応」）。

---

## 完了条件

- 削除済みのお題にぶら下がる挑戦から画像生成を起動できない。生成枠も実費も消費しない
- 同じ挑戦への `PATCH` も 404 になる
- 同じ挑戦への `DELETE` は通り、本人が片付けられる
- `docker compose exec backend bundle exec rubocop` と `... bundle exec rspec` が緑
- 3 件の新規テストがミューテーションで RED になることを実測している
- CI が緑で、PR に `Closes #85` がある
