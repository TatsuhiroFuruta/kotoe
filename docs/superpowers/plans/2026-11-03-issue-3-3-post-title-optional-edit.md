# お題タイトルの任意化・文字数上限・編集 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** お題のタイトルを任意（空は NULL、画面では「無題」）にし、30 字の上限を付け、投稿者がマイページから自分のお題のタイトルを変更・消去できるようにする。

**Architecture:** ルールはバックエンドの `Post` に置く（`normalizes` で空を NULL に、`length` で上限）。`PATCH /api/posts/:id` は `current_user.posts.kept.find` で対象を絞り、`title` だけを受け取る。フロントは `PostSummary.title` を `string | null` にして、表示を `PostTitleText` 部品と `lib/posts/post-title.ts` に集める。`title === null` を削除済みの合図として読む箇所は `discarded` に置き換える。編集ダイアログは、7-6b の `ConfirmDialog` から `<dialog>` の開閉処理を `ModalDialog` に切り出して共用する。

**Tech Stack:** Rails 8.1（API）／ RSpec ／ Next.js 16.2.10（App Router）／ React 19 ／ TypeScript ／ TailwindCSS 4 ／ Vitest ／ Docker Compose。**新しい依存は追加しない。**

**Spec:** `docs/superpowers/specs/2026-11-03-issue-3-3-post-title-optional-edit-design.md`

**Issue:** GitHub #62（`docs/issues_backlog.md` 3-3）。**PR 本文は `Closes #62`**。#62 のタイトル「お題タイトルの文字数上限と編集」は任意化を含まないので、PR 作成時に本文へ範囲の拡大（設計書 決定 1）を書く

**Branch:** `feat/post-title-optional-edit`（作成済み。設計書のコミット `be958e8` が載っている）

## Global Constraints

全タスクの要件に暗黙に含まれる。

- **依存を追加しない。** `Gemfile` / `package.json` は変更しない。
- 上限は **30**。バックエンド `Post::MAX_TITLE_LENGTH = 30`、フロント `TITLE_MAX_LENGTH = 30`（`lib/posts/post-messages.ts`）。両方のコメントに互いの名前を書く。
- エラーコードは Rails 既定の **`too_long`**。文言はフロントだけが持つ。
- 無題は必ず **NULL**（空文字を保存しない）。
- 表示の文言：無題の見出し **「無題」**（`text-ink-muted`）、無題の画像の alt / aria-label **「お題の画像」**、マイページ **「お題：無題」**。
- `frontend/src/app/globals.css` を変更しない。色は既存トークン、ボタンは `buttonClasses()`。
- `dangerouslySetInnerHTML` を使わない。タイトルは `{value}` のまま置く。ブラウザの `alert` / `confirm` を使わない。
- `useSearchParams()` を使わない。`useEffect` の本体で同期的に `setState` しない。
- rubocop：文字列はダブルクォート。TS：`any` を使わない。コメントは日本語で「なぜ」を書く。確かめていない「壊れたときの見え方」を書かない。
- テストの置き場所：`backend/spec/...`、`frontend/test/`（`src/` を写す）。コンポーネントのテストは書かない。
- `git checkout` を使わない。ブランチを切り替えない。env ファイルの中身を表示しない。
- コミットの末尾は `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` で止める（`Claude-Session:` 行を書かない）。
- コンテナ内で `next build` を実行しない。

**いつもの検査（バックエンド）**

```bash
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec rubocop
```

**いつもの検査（フロント）**

```bash
docker compose exec frontend npm test
docker compose exec frontend npm run lint
docker compose exec frontend npx tsc --noEmit
```

期待：すべて PASS／違反 0。

## Review Focus

どの単体テストも直接は叩かないが、使う人が最初に踏みそうな入力・条件。

1. **無題のお題への挑戦・下書きが、マイページで「お題は削除されました」と出る。** `title === null` の読み替え漏れ。→ Task 3 の `rg` による洗い出しと手動確認 3
2. **全角スペースだけのタイトル。** 空として NULL になるべきで、`"　"` が保存されて見出しが空白になってはいけない。→ Task 1 のモデル spec
3. **編集ダイアログで保存を連打する／送信中に Esc。** PATCH が 2 回飛ばず、送信中は閉じないこと。→ Task 5 の手動確認 4
4. **`ConfirmDialog` の切り出しで 7-6b の削除ダイアログが壊れる**（Esc 2 回で開かなくなる不具合の対処を落とす）。→ Task 5 の手動確認 6
5. **31 字の投稿で画像が Cloudinary に上がってから 422 になる。** `collect_errors` がアップロード前に `too_long` を拾うこと。→ Task 1 の request spec（`Images::Uploader` が呼ばれない）

---

## ファイル構成

| ファイル | 役割 | タスク |
|---|---|---|
| `backend/db/migrate/<ts>_change_posts_title_null.rb` | `posts.title` を NULL 可に | 1 |
| `backend/app/models/post.rb` | `normalizes`・上限・`presence` 削除 | 1 |
| `backend/spec/models/post_spec.rb` | 上の振る舞い | 1 |
| `backend/spec/requests/api/posts_spec.rb` | POST の期待値更新、PATCH の spec | 1, 2 |
| `backend/config/routes.rb` | `update` を足す | 2 |
| `backend/app/controllers/api/posts_controller.rb` | `update` | 2 |
| `backend/spec/requests/api/me/attempts_spec.rb` | 無題のお題は `title: nil`・`discarded: false` | 2 |
| `docs/screen_and_api_design.md` | PATCH・`?q=` の注記 | 2 |
| `frontend/src/types/api.ts` | `PostSummary.title: string \| null`、`AttemptPostSummary` のコメント | 3 |
| `frontend/src/lib/posts/post-title.ts`（新規） | 「無題」と alt の文言・関数 | 3 |
| `frontend/src/components/posts/post-title-text.tsx`（新規） | 見出しの中身（無題なら灰色） | 3 |
| 表示箇所 7 ファイル（下記 Task 3） | 置き換え | 3 |
| `frontend/src/lib/attempts/attempt-card-label.ts` | `discarded` で判定 | 3 |
| `frontend/src/lib/posts/post-messages.ts` | `TITLE_MAX_LENGTH`・`too_long`・編集の文言と失敗の振り分け | 4, 5 |
| `frontend/src/components/posts/post-form.tsx` | 任意化・カウンタ | 4 |
| `frontend/src/components/ui/modal-dialog.tsx`（新規） | `<dialog>` の開閉の共通部品 | 5 |
| `frontend/src/components/ui/confirm-dialog.tsx` | `ModalDialog` を使う形に | 5 |
| `frontend/src/components/mypage/edit-post-title-button.tsx`（新規） | ボタン＋編集ダイアログ＋PATCH | 5 |
| `frontend/src/components/mypage/mypage-list.tsx` | 投稿タブにボタンの行 | 5 |
| `docs/issues_backlog.md` | 3-3 更新・背骨・3-5 追加 | 6 |

---

### Task 1: タイトルを任意にし、30 字の上限を付ける（モデル）

**Files:**
- Create: `backend/db/migrate/<timestamp>_change_posts_title_null.rb`
- Modify: `backend/app/models/post.rb:8`、`backend/db/schema.rb`（マイグレーションで自動更新）
- Test: `backend/spec/models/post_spec.rb`、`backend/spec/requests/api/posts_spec.rb`（POST の節）

**Interfaces:**
- Produces: `Post::MAX_TITLE_LENGTH = 30`。`Post#title` は `String`（1〜30 字、空白だけでない）か `nil`。検証エラーは `errors.details[:title]` に `{ error: :too_long, count: 30 }`

- [ ] **Step 1: モデル spec を書き換える**

`validate_presence_of(:title)` の行（`post_spec.rb:12`）を消し、次を足す。

```ruby
it { is_expected.to validate_length_of(:title).is_at_most(Post::MAX_TITLE_LENGTH) }

describe "title の正規化" do
  it "nil のまま保存できる" do
    expect(create(:post, title: nil).reload.title).to be_nil
  end

  it "空文字は nil にそろう" do
    expect(create(:post, title: "").reload.title).to be_nil
  end

  it "空白だけ（全角スペースを含む）は nil にそろう" do
    expect(create(:post, title: " 　\n").reload.title).to be_nil
  end

  it "前後の空白は削らない" do
    expect(create(:post, title: " 夕暮れ ").reload.title).to eq(" 夕暮れ ")
  end

  it "30 字は通り、31 字は too_long" do
    expect(build(:post, title: "あ" * 30)).to be_valid
    post = build(:post, title: "あ" * 31)
    expect(post).not_to be_valid
    expect(post.errors.details[:title]).to include(a_hash_including(error: :too_long))
  end
end

describe ".search_by_title（無題）" do
  it "q を指定すると無題のお題はかからず、q が空なら出る" do
    untitled = create(:post, title: nil)
    expect(Post.search_by_title("お題")).not_to include(untitled)
    expect(Post.search_by_title("")).to include(untitled)
  end
end
```

- [ ] **Step 2: request spec（POST）の期待値を直し、足す**

既存の `"title" => [ "blank" ]` を期待している例（`posts_spec.rb:231-269` 付近の 3 か所）は、タイトルが空でもエラーにならなくなるので、`title` を期待から外す（画像のエラーだけを期待する）。足す例：

- `"タイトル無しで投稿すると 201 で title は null"`：`params: { post: { image: image } }` → 201、`response.parsed_body["post"]["title"]` が `nil`、`Post.last.title` が `nil`
- `"空文字のタイトルでも 201 で title は null"`
- `"31 字のタイトルは 422 too_long で、画像はアップロードしない"`：`expect(Images::Uploader).not_to receive(:call)` を置き、`errors` が `{ "title" => [ "too_long" ] }`、`Post.count` が変わらない
- `"30 字のタイトルは 201"`

- [ ] **Step 3: 失敗を確認**

Run: `docker compose exec backend bundle exec rspec spec/models/post_spec.rb spec/requests/api/posts_spec.rb`
Expected: 上で足した例が FAIL（`NotNullViolation` / `presence` のエラー / `MAX_TITLE_LENGTH` 未定義）

- [ ] **Step 4: マイグレーションを作って当てる**

`change_column_null :posts, :title, true`。コメントに「`down`（NOT NULL に戻す）は NULL の行があると失敗する。戻すときは先に埋めること」を書く。

```bash
docker compose exec backend bin/rails g migration ChangePostsTitleNull
docker compose exec backend bin/rails db:migrate
docker compose exec -e RAILS_ENV=test backend bin/rails db:prepare
```

Expected: `db/schema.rb` の `t.string "title", null: false` が `t.string "title"` になる

- [ ] **Step 5: `post.rb` を変える**

`validates :title, presence: true` を次に置き換える。`normalizes` はブロックで `title.presence`（Rails の `blank?` は `[[:space:]]` を空白とみなすので全角スペースも空になる。strip はしない＝設計書 決定 1）。

```ruby
MAX_TITLE_LENGTH = 30 # frontend の TITLE_MAX_LENGTH（lib/posts/post-messages.ts）と揃える

normalizes :title, with: ->(title) { title.presence }
validates :title, length: { maximum: MAX_TITLE_LENGTH }, allow_nil: true
```

コメントに「30 字はタイトルを『名前』にとどめるための値（設計書 決定 2）。DB の型は変えない」を書く。

- [ ] **Step 6: 通るのを確認** — Step 3 のコマンドで PASS、そのあと「いつもの検査（バックエンド）」

- [ ] **Step 7: コミット**

```bash
git add backend/db/migrate backend/db/schema.rb backend/app/models/post.rb backend/spec/models/post_spec.rb backend/spec/requests/api/posts_spec.rb
git commit -m "feat: お題のタイトルを任意にし、30 字の上限を付ける"
```

---

### Task 2: `PATCH /api/posts/:id`

**Files:**
- Modify: `backend/config/routes.rb:25`、`backend/app/controllers/api/posts_controller.rb`
- Modify: `docs/screen_and_api_design.md:57-60`
- Test: `backend/spec/requests/api/posts_spec.rb`（新しい `RSpec.describe "PATCH /api/posts/:id"` を `DELETE` の節の前に）、`backend/spec/requests/api/me/attempts_spec.rb`

**Interfaces:**
- Consumes: Task 1 の `Post` の検証
- Produces: `PATCH /api/posts/:id`、本文 `{ "post": { "title": string | null } }`。200 `{ "post": PostSerializer }`／422 `{ "errors": { "title": ["too_long"] } }`／404 `{ "error": "not_found" }`／400（`post` か `title` キーが無い、`post` がハッシュでない）／401

- [ ] **Step 1: request spec を書く**

`let(:user)`・`let(:token)` は `DELETE` の節と同じ形。`as: :json` で送る。例：

- `"自分のお題のタイトルを変える"`：200、`parsed_body["post"]` が `PostSerializer` と同じキー（`id title image_public_id user attempts_count likes_count favorited created_at`）、`title` が新しい値、DB も新しい値
- `"空文字を送ると無題（null）になる"`、`"null を送ると無題になる"`
- `"31 字は 422 too_long で、値は変わらない"`
- `"30 字は 200"`
- `"image を送っても image_public_id は変わらない"`：`params: { post: { title: "新", image_public_id: "evil", image: "x" } }` → 200、`image_public_id` は元のまま
- `"既存の挑戦は件数も内容も変わらない"`：公開済みの挑戦を 1 件付け、PATCH の前後で `post_record.attempts.count` と `attempt.reload.description` が同じ、応答の `attempts_count` が 1
- `"他人のお題は 404 で、値は変わらない"`、`"削除済みのお題は 404"`、`"存在しない ID は 404"`
- `"未認証は 401"`
- `"post に title キーが無いと 400 で、値は変わらない"`：`params: { post: { foo: "x" } }`
- `"post が無いと 400"`、`"post が文字列だと 400"`：`params: { post: "x" }`（`as: :json`）
- 400 の本文が JSON であること（`response.media_type` が `application/json`）

`me/attempts_spec.rb` に：`"無題のお題への挑戦は title が null で discarded は false"`。

- [ ] **Step 2: 失敗を確認**

Run: `docker compose exec backend bundle exec rspec spec/requests/api/posts_spec.rb spec/requests/api/me/attempts_spec.rb`
Expected: PATCH の例が FAIL（ルーティングエラー）。`me/attempts` の例は Task 1 の後なので PASS してよい（振る舞いの固定のための例）

- [ ] **Step 3: ルートと `update` を足す**

- `routes.rb`：`only: %i[index create show update destroy]`
- `before_action :authenticate_user!, only: %i[create update destroy]`
- `def update`：`post = current_user.posts.kept.find(params[:id])` → `post.update(title: title_param)` → 成功なら `render json: { post: post_json(post) }`、失敗なら `render_validation_errors(post)`
- private `title_param`：`post_attributes`（既存）が `{}` を返す、または `title` キーが無いときは `raise ActionController::ParameterMissing, :title`。キーを見るのは `post_attributes.key?(:title)`（`nil` の値は「無題にする」なので通す）。`params.require` は `nil` / 空文字を missing と扱うため使わない（コメントで理由を書く）
- `ParameterMissing` の既定の応答が JSON でなければ、`ApplicationController` に `rescue_from ActionController::ParameterMissing` を足して `{ error: "parameter_missing" }`・400 を返す（Step 1 の `media_type` の例で判定する）

- [ ] **Step 4: 通るのを確認** — Step 2 のコマンドで PASS、そのあと「いつもの検査（バックエンド）」

- [ ] **Step 5: 実物で 1 回叩く**

```bash
docker compose exec backend bin/rails routes -g "posts#update"
```

Expected: `PATCH /api/posts/:id(.:format) api/posts#update`

- [ ] **Step 6: API 一覧を更新する**

`docs/screen_and_api_design.md` に `| PATCH | /api/posts/:id | 自分のお題のタイトルを変更（title のみ。空・null で無題。30 字まで） | マイページ |` を `DELETE` の行の前に。`GET /api/posts` の行の `?q=` に「無題のお題はかからない」を添える。

- [ ] **Step 7: コミット**

```bash
git add backend/config/routes.rb backend/app/controllers backend/spec/requests docs/screen_and_api_design.md
git commit -m "feat: PATCH /api/posts/:id で自分のお題のタイトルを変更できるようにする"
```

---

### Task 3: フロントで無題を「無題」と表示し、削除済みの判定を `discarded` に寄せる

**Files:**
- Create: `frontend/src/lib/posts/post-title.ts`、`frontend/src/components/posts/post-title-text.tsx`
- Modify: `frontend/src/types/api.ts:52,114`、`frontend/src/lib/attempts/attempt-card-label.ts:47-57`
- Modify（表示箇所）：`components/posts/post-card.tsx:30,35,45`、`components/posts/post-hero.tsx:34,39,47`、`components/attempts/attempt-detail.tsx:107`、`components/attempts/attempt-comparison.tsx:25`、`components/mypage/my-attempt-card.tsx:55`、`components/mypage/draft-card.tsx:32,39,47`
- Test: `frontend/test/lib/posts/post-title.test.ts`（新規）、`frontend/test/lib/attempts/attempt-card-label.test.ts`

**Interfaces:**
- Produces（`lib/posts/post-title.ts`）：
  - `export const UNTITLED_LABEL = "無題";`
  - `export function postTitleText(title: string | null): string` — `title ?? UNTITLED_LABEL`
  - `export function postImageAlt(title: string | null): string` — `title ?? "お題の画像"`
- Produces（`components/posts/post-title-text.tsx`）：`export function PostTitleText({ title }: { title: string | null })` — `title` があればそのまま、`null` なら `<span className="text-ink-muted">無題</span>`。見出しの要素（`h1` / `h2`）は呼び出し側が持つ
- Produces：`myAttemptCardLabel` の引数の `post` が `Pick<MyAttempt["post"], "title" | "discarded">` になる

- [ ] **Step 1: テストを書く**

`post-title.test.ts`：`postTitleText(null)` が `"無題"`、`postTitleText("夕暮れ")` が `"夕暮れ"`、`postImageAlt(null)` が `"お題の画像"`、`postImageAlt("夕暮れ")` が `"夕暮れ"`。

`attempt-card-label.test.ts` の `myAttemptCardLabel` に 3 例：
- 通常：`{ title: "夕暮れ", discarded: false }` → `"…、お題：夕暮れ、いいね 3"`
- 無題：`{ title: null, discarded: false }` → `"…、お題：無題、いいね 3"`
- 削除済み：`{ title: null, discarded: true }` → お題の部分が無い `"…、いいね 3"`

- [ ] **Step 2: 失敗を確認**

Run: `docker compose exec frontend npx vitest run test/lib/posts/post-title.test.ts test/lib/attempts/attempt-card-label.test.ts`
Expected: FAIL（モジュールが無い／無題の例が「お題：」を含まない）

- [ ] **Step 3: 型と関数を実装する**

- `types/api.ts:52`：`title: string | null;`（コメント「無題なら null（3-3）」）。`:114` のコメントを設計書 決定 5 の文に
- `post-title.ts`・`PostTitleText` を作る
- `myAttemptCardLabel`：`discarded` ならお題を省き、そうでなければ ``お題：${postTitleText(attempt.post.title)}``

- [ ] **Step 4: 表示箇所を置き換える**

- 見出し（`post-card` の `h2`、`post-hero` の `h1`、`attempt-detail` の `h1`）：中身を `<PostTitleText title={post.title} />`
- alt / aria-label（`post-card`・`post-hero`・`attempt-comparison`）：`postImageAlt(post.title)`
- `my-attempt-card.tsx:55`・`draft-card.tsx:47`：`お題：<PostTitleText title={post.title} />`（`discarded` の分岐はそのまま）
- `draft-card.tsx:32,39`：`post.title ?? "お題の画像"` を `postImageAlt(post.title)` に（削除済みの分岐はそのまま）
- 置き換え漏れの確認：

```bash
rg -n "title !== null|title === null|title \?\?|\.title\b" frontend/src
```

Expected：残る `post.title` は `PostTitleText` / `postTitleText` / `postImageAlt` への受け渡しと `post-form.tsx`（フォームの state）だけ。`title === null` / `!== null` を削除済みの判定に使う箇所が 0

- [ ] **Step 5: 通るのを確認** — Step 2 のコマンドで PASS、「いつもの検査（フロント）」（tsc が型の変更で表示箇所の漏れを拾う）

- [ ] **Step 6: 手動確認**

1. Rails コンソールで 1 件を無題にする：`docker compose exec backend bin/rails runner 'Post.kept.first.update!(title: nil)'`
2. `/posts`：そのカードの見出しが灰色の「無題」、高さが他と揃う。`/posts/<id>`：見出しが「無題」
3. マイページの「自分の挑戦」「下書き」で、そのお題への挑戦が「お題：無題」と出て、**「お題は削除されました」と出ない**
4. 挑戦詳細（`/attempts/<id>`）の見出しが「無題」、比較の画像の alt が「お題の画像」（DevTools で確認）

- [ ] **Step 7: コミット**

```bash
git add frontend/src frontend/test
git commit -m "feat: 無題のお題を「無題」と表示し、削除済みの判定を discarded に寄せる"
```

---

### Task 4: 投稿フォームのタイトルを任意にし、上限を出す

**Files:**
- Modify: `frontend/src/lib/posts/post-messages.ts`、`frontend/src/components/posts/post-form.tsx:120-140,237-250`
- Test: `frontend/test/lib/posts/post-messages.test.ts`

**Interfaces:**
- Produces（`post-messages.ts`）：`export const TITLE_MAX_LENGTH = 30;`（コメント「backend の Post::MAX_TITLE_LENGTH と揃える」）、`TITLE_MESSAGES.too_long = "タイトルは30文字以内にしてください"`

- [ ] **Step 1: テストを書く**

- `titleErrorMessage("too_long")` が `"タイトルは30文字以内にしてください"`
- `toPostFormErrors`（422 `{ errors: { title: ["too_long"] } }`）の `title` が同じ文言で、`form` が `null`

- [ ] **Step 2: 失敗を確認**

Run: `docker compose exec frontend npx vitest run test/lib/posts/post-messages.test.ts`
Expected: FAIL（フォールバックの「このタイトルは使えません」が返る）

- [ ] **Step 3: 実装する**

- `post-messages.ts`：上の定数と辞書。`isBlankTitle` は投稿フォームから使われなくなる。ほかに使い道が無ければ消す（テストも）
- `post-form.tsx`：
  - `handleSubmit` から `blankTitle` の判定とフォーカス要求を外す（画像の未選択だけを弾く）
  - ラベルを `"タイトル（任意）"`
  - 入力欄の下にカウンタ `{title.length} / {TITLE_MAX_LENGTH}`。超えたら `text-danger`、それ以外は `text-ink-muted`、`tabular-nums`。`aria-live` にしない。コメントは `attempt-composer.tsx:497-501` と同じ理由（判定はサーバー、`text.length` は多めにずれる側）。`maxLength` は付けない
  - カウンタを `TextField` の外に置くか、`TextField` に `hint` 的な口を足すかは、`components/ui/text-field.tsx` を読んで既存の形に合わせる。足す場合も入力欄との `aria-describedby` は付ける
  - 送信は今どおり `post[title]` を付ける（空文字でもサーバーが NULL にする）

- [ ] **Step 4: 通るのを確認** — Step 2 のコマンドで PASS、「いつもの検査（フロント）」

- [ ] **Step 5: 手動確認**

1. タイトル無しで投稿 → お題詳細に移り、見出しが「無題」
2. 全角スペースだけで投稿 → 同じく「無題」
3. 31 字を入力 → カウンタが赤、投稿すると欄の下に「タイトルは30文字以内にしてください」、選んだ画像は残っている
4. 30 字ちょうど → 投稿できる

- [ ] **Step 6: コミット**

```bash
git add frontend/src frontend/test
git commit -m "feat: 投稿フォームのタイトルを任意にし、30 字のカウンタを出す"
```

---

### Task 5: マイページからタイトルを編集する

**Files:**
- Create: `frontend/src/components/ui/modal-dialog.tsx`、`frontend/src/components/mypage/edit-post-title-button.tsx`
- Modify: `frontend/src/components/ui/confirm-dialog.tsx`、`frontend/src/components/mypage/mypage-list.tsx:110-160`、`frontend/src/lib/posts/post-messages.ts`
- Test: `frontend/test/lib/posts/post-messages.test.ts`

**Interfaces:**
- Consumes: Task 2 の PATCH、Task 4 の `TITLE_MAX_LENGTH` / `titleErrorMessage`
- Produces（`post-messages.ts`）：
  - `export const POST_TITLE_UPDATED_MESSAGE = "タイトルを変更しました";`
  - `export const POST_GONE_MESSAGE = "このお題は削除されています";`
  - `export const TITLE_EDIT_HINT = "空欄にすると「無題」になります";`
  - `export type TitleEditFailure = { kind: "field"; message: string } | { kind: "gone" } | { kind: "session_expired" } | { kind: "form"; message: string };`
  - `export function toTitleEditFailure(error: unknown): TitleEditFailure` — 422 で `errors.title` があれば `field`（`titleErrorMessage`）、404 は `gone`、401 は `session_expired`、それ以外（タイムアウト・通信断・5xx・欄の無い 422）は `form`（`toRequestErrorMessage(error)`。欄の無い 422 は `UNKNOWN_FIELD_MESSAGE`）
- Produces（`modal-dialog.tsx`）：`export function ModalDialog({ open, pending, labelledBy, onCancel, children }: { open: boolean; pending: boolean; labelledBy: string; onCancel: () => void; children: ReactNode })` — 今の `ConfirmDialog` の `useEffect`（`showModal` / `close`）、`onCancel`（`preventDefault`・送信中は閉じない）、`onClose`（送信中なら開き直す。Esc 2 回の実測コメントもそのまま移す）、`className` を持つ
- Produces（`edit-post-title-button.tsx`）：`export function EditPostTitleButton({ postId, title, onUpdated, onGone }: { postId: number; title: string | null; onUpdated: () => void; onGone: () => void })`

- [ ] **Step 1: テストを書く**

`toTitleEditFailure` の 6 例：422 `too_long` → `{ kind: "field", message: "タイトルは30文字以内にしてください" }`／422 `{ errors: {} }` → `form`／404 → `{ kind: "gone" }`／401 → `{ kind: "session_expired" }`／`new ApiTimeoutError(15000)` → `form`／500 → `form`。`ApiError` の作り方は既存の `post-messages.test.ts` に合わせる。

- [ ] **Step 2: 失敗を確認**

Run: `docker compose exec frontend npx vitest run test/lib/posts/post-messages.test.ts`
Expected: FAIL（`toTitleEditFailure` が無い）

- [ ] **Step 3: `toTitleEditFailure` と文言を実装し、Step 2 で PASS を確認**

- [ ] **Step 4: `ModalDialog` を切り出し、`ConfirmDialog` をその上に組み直す**

`ConfirmDialog` の props と見た目は変えない（呼び出し側の `DeleteAttemptButton` を触らずに済むこと）。

- [ ] **Step 5: `EditPostTitleButton` を作る**

- ボタン「タイトルを編集」（`buttonClasses({ variant: "secondary" })`）。押すと入力欄に今の `title ?? ""` を入れてダイアログを開く
- ダイアログ（`ModalDialog`）：見出し「タイトルを編集」、`TextField`（ラベル「タイトル（任意）」）、Task 4 と同じカウンタ、補足 `TITLE_EDIT_HINT`、ボタン「やめる」「保存する」（送信中は「保存中…」で押せない）。`<form>` にして Enter で保存できるようにする
- 開いたら入力欄にフォーカス（`showModal()` は最初の押せる要素にフォーカスするので、入力欄を「やめる」より前に置けば足りる）。閉じたときのフォーカスの戻りは `<dialog>` の `close()` に任せる（7-6b で確認済み）
- 送信：`apiFetch<{ post: PostSummary }>(\`/api/posts/${postId}\`, { method: "PATCH", body: JSON.stringify({ post: { title } }) })`。連打は `useRef` で止める（`DeleteAttemptButton` と同じ）。空文字はそのまま送る（サーバーが NULL にする）
- 結果：
  - 成功 → 閉じる、`toast.success(POST_TITLE_UPDATED_MESSAGE)`、`onUpdated()`
  - `field` → 閉じずに入力欄の下へ
  - `gone` → 閉じる、`toast.error(POST_GONE_MESSAGE)`、`onGone()`
  - `session_expired` → 閉じる。トーストは出さない（`api.ts` が出している）
  - `form` → 閉じずに、ダイアログ上部に `role="alert"` で出す（`ConfirmDialog` の `error` と同じ見た目）

- [ ] **Step 6: マイページに置く**

`mypage-list.tsx` の投稿タブの `<li>` を、`<PostCard post={post} />` の下にボタンの行（`mt-2 flex justify-end`）を足す形にする。`ListResults` に `onPostUpdated: () => void` を足し、`MypageList` から `() => setRetryCount((count) => count + 1)` を渡す。`onGone` は `() => onDeleted(itemCount)`（お題が消えたので、削除と同じく最後の 1 枚ならページを戻し、統計も取り直す）。

- [ ] **Step 7: 「いつもの検査（フロント）」**

- [ ] **Step 8: 手動確認**（`/mypage?tab=posts` は**アドレスバーから直接ロード**して始める）

1. 「タイトルを編集」→ 今のタイトルが入り、入力欄にフォーカス → 変えて「保存する」→ カードに反映、トースト
2. 空にして保存 → 「無題」になる。もう一度開くと入力欄は空
3. 31 字で保存 → 閉じずに欄の下に文言、カウンタが赤
4. 保存を連打／送信中に Esc → PATCH は 1 回だけ（DevTools の Network）、送信中は閉じない
5. 別のタブでそのお題を削除（Rails コンソールで `discard!`）してから保存 → 閉じて、一覧から消え、トースト「このお題は削除されています」、統計の投稿数が減る
6. **7-6b の削除ダイアログが今までどおり動く**：「自分の挑戦」から削除 → Esc を 2 回 → もう一度「削除」を押すと開く
7. キーボードだけで開く・Esc で閉じる・「タイトルを編集」にフォーカスが戻る
8. 挑戦が付いたお題のタイトルを変える → お題詳細・挑戦詳細・「自分の挑戦」の「お題：…」が新しい名前

- [ ] **Step 9: コミット**

```bash
git add frontend/src frontend/test
git commit -m "feat: マイページからお題のタイトルを編集できるようにする"
```

---

### Task 6: backlog を更新する

**Files:**
- Modify: `docs/issues_backlog.md`（3-3 の節 `:206-235`、3-4 の後に 3-5 を追加、背骨 `:1207`）、`docs/README.md`（データモデルに `posts.title` の NOT NULL が書かれていれば）

- [ ] **Step 1: 3-3 の節を書き換える**

目的に「タイトルの任意化」を足す。「先に決めること」を決定済みに（上限 30・DB は変えない・案A）。タスクのチェックを入れる。完了条件を設計書の「完了条件」に。設計書へのリンクを足す。

- [ ] **Step 2: 3-5 を足す**

見出し「🔵 3-5. 検索の対象を挑戦の描写文に広げる」。背景（無題のお題がタイトル検索にかからない。3-3 設計書 決定 6）、方針（`?q=` で公開済み・未削除の挑戦の描写文も部分一致、`EXISTS` サブクエリ、`Post.search_by_title` の中身を差し替え、フロントは変更なし）、着手の目安（無題のお題が増えて見つけにくいという声が出たら）、件数が増えたら pg_bigm / pg_trgm を検討。依存：3-3

- [ ] **Step 3: 背骨に 3-3 を入れる**

`…（7-6a → 7-6b）→ 3-3 → 8-1 → 8-2b`。下の補足に 1 行：「3-3 は公開前に入れる。上限を後から付けると、超えた既存データの編集が保存できなくなるため」

- [ ] **Step 4: `rg -n "title" docs/README.md` で NOT NULL の記述を探し、あれば直す**

- [ ] **Step 5: コミット**

```bash
git add docs
git commit -m "docs: 3-3 の決定を backlog に反映し、描写文の検索を 3-5 として積む"
```

---

## 仕上げ（プッシュ前）

- [ ] 「いつもの検査」をバックエンド・フロントの両方で通す
- [ ] `/code-review high` をブランチ全体にかける。指摘を直したら、その差分にもう一度かける
- [ ] プッシュ → PR。本文に設計書へのリンク、`Closes #62`、**マージ後の Render のビルドで `db:migrate` が走る**（`backend/bin/render-build.sh`。`posts.title` を NULL 可にするだけなので既存行への影響なし）ことを書く
- [ ] Vercel プレビューで Task 3〜5 の手動確認をもう一度
