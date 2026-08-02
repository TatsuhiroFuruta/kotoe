# issue 4-2 描写の保存・生成（画像生成はダミー）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 挑戦（Attempt）の下書き保存・更新・生成起動・ポーリング・論理削除を API として通し、生成は固定のダミー画像を Cloudinary に上げるジョブで代替したうえで、1日あたりの生成回数上限を効かせる。

**Architecture:** 消費の記録は `attempts.generated_at` の1カラムで持つ。上限チェックから status 更新・ジョブの enqueue までを PORO `Attempts::Generation` に閉じ込め、`user` 行のロックが張るトランザクションで囲む（4-1 の「更新と enqueue を同じトランザクションに乗せる」形をそのまま満たす）。コントローラは判定を持たず、PORO が返す `Result` を HTTP に翻訳するだけにする。`GenerateImageJob` は `generating` の attempt しか掴まないことで冪等性を担保する。

**Tech Stack:** Ruby 3.4.10 / Rails 8.1.3.1（API モード）/ PostgreSQL 16 / Solid Queue / Cloudinary / RSpec + FactoryBot + shoulda-matchers / Docker Compose

**設計ドキュメント:** `docs/superpowers/specs/2026-08-02-issue-4-2-attempt-generation-design.md`

## Global Constraints

- 作業ブランチは `feature/issue-4-2`（main から作成済み。設計ドキュメントのコミット `953642b` が乗っている）。**main へ直接コミットしない**。
- **文字列はダブルクォート**。spec ファイルも含めプロジェクト全体で統一（`.rubocop.yml` の `Style/StringLiterals`）。
- コメント・コミットメッセージ・spec の `describe` / `it` は**日本語**で書く（既存コードに合わせる）。
- コミット前に `docker compose exec backend bundle exec rubocop` と `docker compose exec backend bundle exec rspec` を通す。
- コマンドは**すべて docker compose 経由**で実行する（ホストに Ruby 3.4.10 は入っていない）。
- 論理削除は `discard`（`discarded_at`）。**物理削除しない**。通常のクエリは `kept` で未削除に絞る。
- **`ActiveJob::Base.enqueue_after_transaction_commit` は `false`（既定）のまま変えない。** 変えると 4-1 で確保したトランザクションの一体性が崩れる。
- API が返すのは**エラーコードだけ**で、表示用の文言は返さない（i18n はフロント）。フィールド単位は `{ errors: { field: [code] } }`、リクエスト単位は `{ error: "code" }`。
- 時刻は UTC の ISO8601 で返す（`.utc.iso8601`）。判定の基準は JST（`config.time_zone = "Asia/Tokyo"`）。
- **画像生成API・Cloudinary のキーはサーバー側のみ**。ログや URL に秘密情報を出さない。
- 1 issue = 1 ブランチ = 1 PR。この計画のタスクはすべて同じブランチに積む。
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を付ける。
- マイグレーションを足したら**テスト用 DB も更新する**：`docker compose exec -e RAILS_ENV=test backend bin/rails db:prepare`。
- **`lib/` に新しいディレクトリを作ったら backend を restart する**（`docker compose restart backend`）。Zeitwerk が新しい名前空間を拾わず、rspec は green なのに curl だけ `uninitialized constant` で 500 になる。

## File Structure

| ファイル | 責務 |
|---|---|
| `backend/db/migrate/*_add_generated_at_to_attempts.rb` | 消費の記録カラムとインデックス |
| `backend/app/models/attempt.rb`（変更） | `description` の長さ上限。既存の enum・スコープはそのまま |
| `backend/lib/assets/dummy_generated.png` | 4-3 まで使う固定のダミー画像（1024×1024） |
| `backend/lib/assets/README.md` | そのダミー画像の作り方（バイナリは diff で読めないため） |
| `backend/app/jobs/generate_image_job.rb` | ダミー画像を Cloudinary へ上げて published にする。失敗時は failed |
| `backend/lib/attempts/generation.rb` | 生成の起動。上限チェック → status 更新 → enqueue をひとまとまりで行う |
| `backend/app/controllers/api/attempts_controller.rb` | 挑戦の5エンドポイント。HTTP の入出力だけを扱う |
| `backend/config/routes.rb`（変更） | 挑戦のルート |
| `backend/spec/factories/attempts.rb`（変更） | `generating` / `failed` の trait |
| `backend/spec/models/attempt_spec.rb`（変更） | `description` の長さ |
| `backend/spec/jobs/generate_image_job_spec.rb` | 成功・失敗・冪等性 |
| `backend/spec/lib/attempts/generation_spec.rb` | 上限・日付境界・トランザクションの一体性 |
| `backend/spec/requests/api/attempts_spec.rb` | 5エンドポイントの入出力と認可 |
| `backend/spec/rails_helper.rb`（変更） | job spec で `ActiveJob::TestHelper` を使えるようにする |
| `docs/screen_and_api_design.md`（変更） | 確定した応答の形とエラーコード |
| `docs/issues_backlog.md`（変更） | 4-2 のチェックボックス |

---

### Task 1: `generated_at` カラムと `description` の長さ上限

消費を数えるための土台。ここだけで独立してテストできる。

**Files:**
- Create: `backend/db/migrate/<timestamp>_add_generated_at_to_attempts.rb`
- Modify: `backend/db/schema.rb`（マイグレーションの実行で自動更新。手で書かない）
- Modify: `backend/app/models/attempt.rb`
- Modify: `backend/spec/models/attempt_spec.rb`
- Modify: `backend/spec/factories/attempts.rb`

**Interfaces:**
- Produces: `Attempt::MAX_DESCRIPTION_LENGTH = 1_000`、`attempts.generated_at`（`datetime`、null 可）、
  factory の trait `:generating` / `:failed`。Task 2〜7 がこれらを使う。

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/models/attempt_spec.rb` の `it { is_expected.to validate_presence_of(:description) }` の**直後**に追加する。

```ruby
  it { is_expected.to validate_length_of(:description).is_at_most(1000) }

  # description はそのまま画像生成APIのプロンプトになる。無制限だとコストとエラーの
  # 両方に効くため上限を持つ（設計ドキュメント参照）。
  it "1,000 文字ちょうどは通り、1,001 文字は too_long で落ちる" do
    expect(build(:attempt, description: "あ" * 1000)).to be_valid

    attempt = build(:attempt, description: "あ" * 1001)
    expect(attempt).not_to be_valid
    expect(attempt.errors.details[:description].pluck(:error)).to include(:too_long)
  end

  it "generated_at は既定で nil" do
    expect(create(:attempt).generated_at).to be_nil
  end
```

- [ ] **Step 2: テストが落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/models/attempt_spec.rb
```

期待：`validate_length_of` と 1,001 文字のテストが失敗する（長さのバリデーションが無いため）。`generated_at` のテストは `NoMethodError`（カラムが無いため）。

- [ ] **Step 3: マイグレーションを作る**

```bash
docker compose exec backend bin/rails generate migration AddGeneratedAtToAttempts
```

生成されたファイルの中身を、以下で**置き換える**。

```ruby
class AddGeneratedAtToAttempts < ActiveRecord::Migration[8.1]
  def change
    # この attempt が生成枠を1つ消費した時刻。generate の瞬間に一度だけ入り、以後変わらない。
    # discard しても消さないので「削除しても回数は戻さない」がデータの形で満たされる。
    # created_at では数えられない（前日に下書きを溜めれば上限をすり抜けられるため）。
    add_column :attempts, :generated_at, :datetime

    # 回数の判定クエリ（user_id ＋ generated_at の範囲）に合わせる。
    # 既存の index_attempts_on_user_id は先頭列が重なるが、6-3 のマイページが
    # user_id 単独で引くため残す。
    add_index :attempts, [ :user_id, :generated_at ]
  end
end
```

- [ ] **Step 4: マイグレーションを流す（開発用とテスト用の両方）**

```bash
docker compose exec backend bin/rails db:migrate
docker compose exec -e RAILS_ENV=test backend bin/rails db:prepare
```

`backend/db/schema.rb` に `t.datetime "generated_at"` と `index_attempts_on_user_id_and_generated_at` が入る。schema.rb は自動生成物なので手で編集しない。

- [ ] **Step 5: モデルにバリデーションを足す**

`backend/app/models/attempt.rb` の `enum :status, ...` の**直後**（`validates :description, presence: true` の行の上）に定数を置き、`validates :description` の行を差し替える。

```ruby
  # description はそのまま画像生成APIのプロンプトになるため上限を持つ。
  # 丁寧な描写でも 300〜500 文字、書き込むタイプで 800 文字前後という実測に対する余裕。
  # 後から緩めるのは安全（既存データが違反にならない）が、きつくするのは危険。
  MAX_DESCRIPTION_LENGTH = 1_000

  validates :description, presence: true, length: { maximum: MAX_DESCRIPTION_LENGTH }
```

- [ ] **Step 6: factory に trait を足す**

`backend/spec/factories/attempts.rb` の `trait :published do ... end` の**直後**に追加する。

```ruby
    # 生成中。GenerateImageJob と Attempts::Generation の spec が使う。
    trait :generating do
      status { "generating" }
      generated_at { Time.current }
    end

    trait :failed do
      status { "failed" }
      generated_at { Time.current }
    end
```

- [ ] **Step 7: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/models/attempt_spec.rb
```

期待：全件 PASS。

- [ ] **Step 8: rubocop を通してコミットする**

```bash
docker compose exec backend bundle exec rubocop
git add backend/app/models/attempt.rb backend/db/migrate backend/db/schema.rb \
        backend/spec/models/attempt_spec.rb backend/spec/factories/attempts.rb
git commit -m "$(cat <<'EOF'
feat: 生成枠の消費を記録する generated_at と描写の長さ上限を足す

生成回数は attempts.generated_at で数える。created_at や status では
前日に下書きを溜めることで上限をすり抜けられるため。discard しても
消さないので「削除しても回数は戻さない」がデータの形で満たされる。

description は画像生成APIのプロンプトになるため 1,000 文字を上限にする。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: ダミー画像と `GenerateImageJob`（成功経路）

**Files:**
- Create: `backend/lib/assets/dummy_generated.png`
- Create: `backend/lib/assets/README.md`
- Create: `backend/app/jobs/generate_image_job.rb`
- Create: `backend/spec/jobs/generate_image_job_spec.rb`

**Interfaces:**
- Consumes: `Images::Uploader.call(file, kind: :generated)` → `String`（Cloudinary の public_id）。失敗は `Images::Uploader::UploadError`。factory の `:generating` trait（Task 1）。
- Produces: `GenerateImageJob.perform_later(attempt_id)` / `perform_now(attempt_id)`。`GenerateImageJob::DUMMY_IMAGE_PATH`。キュー名は `"default"`。Task 4 の `Attempts::Generation` がこのジョブを enqueue する。

- [ ] **Step 1: ダミー画像を生成する**

`lib/assets/` は `config.autoload_lib(ignore: %w[assets tasks])` で Zeitwerk の対象外なので、バイナリを置いてよい。以下を**ホストのリポジトリルートで**実行する（Ruby は zlib しか使わないので、コンテナでもホストでも同じ結果になる）。

```bash
mkdir -p backend/lib/assets
ruby -e '
require "zlib"
SIZE = 1024
def chunk(type, data)
  [ data.bytesize ].pack("N") + type + data + [ Zlib.crc32(type + data) ].pack("N")
end
ihdr = [ SIZE, SIZE ].pack("NN") + [ 8, 2, 0, 0, 0 ].pack("C5")
raw = +""
SIZE.times do |y|
  raw << "\x00".b
  SIZE.times { |x| raw << (((x + y) / 64).even? ? "\x3C\x3F\x4A".b : "\x2A\x2D\x36".b) }
end
png = "\x89PNG\r\n\x1A\n".b + chunk("IHDR", ihdr) + chunk("IDAT", Zlib::Deflate.deflate(raw, 9)) + chunk("IEND", "")
File.binwrite("backend/lib/assets/dummy_generated.png", png)
puts "#{png.bytesize} bytes"
'
```

期待：`15329 bytes` と表示され、`file backend/lib/assets/dummy_generated.png` が
`PNG image data, 1024 x 1024, 8-bit/color RGB, non-interlaced` を返す。
中身は 64px 幅の斜めストライプ（濃紺 2 色）で、「生成結果ではない」と一目で分かる。

- [ ] **Step 2: 作り方を README に残す**

`backend/lib/assets/README.md` を新規作成する。バイナリは diff で中身が読めないため、再生成の手順を残す（`spec/support/image_fixtures.rb` が「バイナリを fixture としてコミットしない」としているのと同じ動機）。

````markdown
# lib/assets

Zeitwerk の対象外（`config.autoload_lib(ignore: %w[assets tasks])`）のディレクトリ。
コードではないファイルを置く。

## dummy_generated.png

issue 4-2 のダミー生成画像。4-3 で本物の画像生成APIに差し替わるまで、
`GenerateImageJob` がこれを毎回 Cloudinary にアップロードする。

1024×1024 / RGB / 15,329 バイト。64px 幅の斜めストライプで、
生成結果ではないことが一目で分かるようにしてある。

バイナリは diff で中身を読めないので、再生成の手順を残す。
出力は決定的なので、同じコマンドで同じバイト列になる。

```bash
ruby -e '
require "zlib"
SIZE = 1024
def chunk(type, data)
  [ data.bytesize ].pack("N") + type + data + [ Zlib.crc32(type + data) ].pack("N")
end
ihdr = [ SIZE, SIZE ].pack("NN") + [ 8, 2, 0, 0, 0 ].pack("C5")
raw = +""
SIZE.times do |y|
  raw << "\x00".b
  SIZE.times { |x| raw << (((x + y) / 64).even? ? "\x3C\x3F\x4A".b : "\x2A\x2D\x36".b) }
end
png = "\x89PNG\r\n\x1A\n".b + chunk("IHDR", ihdr) + chunk("IDAT", Zlib::Deflate.deflate(raw, 9)) + chunk("IEND", "")
File.binwrite("backend/lib/assets/dummy_generated.png", png)
'
```
````

- [ ] **Step 3: 失敗するテストを書く**

`backend/spec/jobs/generate_image_job_spec.rb` を新規作成する。

`spec/support/cloudinary.rb` が全 spec で `Cloudinary::Uploader.upload` をスタブ済みで、
戻り値は `{ "public_id" => "<folder>/stubbed" }`。生成画像のフォルダは
`kotoe/test/generated` なので、public_id は `kotoe/test/generated/stubbed` になる。

```ruby
require "rails_helper"

RSpec.describe GenerateImageJob do
  describe "#perform" do
    it "ダミー画像を上げて published にする" do
      attempt = create(:attempt, :generating)

      described_class.perform_now(attempt.id)

      attempt.reload
      expect(attempt.status).to eq("published")
      expect(attempt.generated_image_public_id).to eq("kotoe/test/generated/stubbed")
    end

    # 4-3 で本物の生成APIに差し替えたとき、お題画像のフォルダに書き込んでいないことを
    # ここで担保しておく。
    it "生成画像のフォルダ（kind: :generated）に上げる" do
      allow(Images::Uploader).to receive(:call).and_return("kotoe/test/generated/x")

      described_class.perform_now(create(:attempt, :generating).id)

      expect(Images::Uploader).to have_received(:call).with(anything, kind: :generated)
    end

    # 入口の1行で冪等性を担保する。generating の attempt しか掴まないので、
    # 以下はすべて「何もせず終わる」。
    it "削除済みの挑戦には何もしない" do
      attempt = create(:attempt, :generating)
      attempt.discard!

      expect { described_class.perform_now(attempt.id) }
        .not_to change { attempt.reload.status }
    end

    it "すでに published の挑戦には何もしない（二重実行）" do
      attempt = create(:attempt, :published)

      expect { described_class.perform_now(attempt.id) }
        .not_to change { attempt.reload.generated_image_public_id }
    end

    it "draft の挑戦には何もしない" do
      attempt = create(:attempt)

      expect { described_class.perform_now(attempt.id) }
        .not_to change { attempt.reload.status }
    end

    it "存在しない id でも落ちない" do
      expect { described_class.perform_now(0) }.not_to raise_error
    end
  end

  describe "キュー" do
    it "default キューに積まれる" do
      expect { described_class.perform_later(1) }
        .to have_enqueued_job(described_class).on_queue("default")
    end
  end
end
```

- [ ] **Step 4: テストが落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/jobs/generate_image_job_spec.rb
```

期待：`NameError: uninitialized constant GenerateImageJob` で全件失敗する。

- [ ] **Step 5: ジョブを実装する**

`backend/app/jobs/generate_image_job.rb` を新規作成する。

```ruby
# 挑戦の再現画像を作るジョブ。issue 4-2 の時点では固定のダミー画像を上げるだけで、
# 本物の画像生成APIへの差し替えは 4-3（差分は「画像の出どころ」だけになる）。
class GenerateImageJob < ApplicationJob
  # lib/assets は Zeitwerk の対象外（config.autoload_lib の ignore）。
  DUMMY_IMAGE_PATH = Rails.root.join("lib/assets/dummy_generated.png")

  queue_as :default

  def perform(attempt_id)
    # 冪等性はこの1行で担保する。generating の attempt しか掴まないので、
    # 生成中に削除された場合も、ジョブが二重に走った場合も、黙って何もせず終わる。
    attempt = Attempt.kept.generating.find_by(id: attempt_id)
    return if attempt.nil?

    public_id = upload_dummy_image

    attempt.update!(generated_image_public_id: public_id, status: :published)
  end

  private

  # 生成が成功したら即公開（結果を見てから公開を選ぶ導線は作らない）。
  def upload_dummy_image
    File.open(DUMMY_IMAGE_PATH, "rb") { |file| Images::Uploader.call(file, kind: :generated) }
  end
end
```

- [ ] **Step 6: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/jobs/generate_image_job_spec.rb
```

期待：全件 PASS。

- [ ] **Step 7: rubocop を通してコミットする**

```bash
docker compose exec backend bundle exec rubocop
git add backend/lib/assets backend/app/jobs/generate_image_job.rb backend/spec/jobs/generate_image_job_spec.rb
git commit -m "$(cat <<'EOF'
feat: ダミー画像を Cloudinary に上げる GenerateImageJob を足す

4-3 で本物の生成APIに差し替わるまでの代役。毎回アップロードするのは、
Cloudinary の失敗 → failed 遷移という本番と同じ経路を 4-2 の段階で
通せるようにするため。4-3 の差分は画像の出どころだけになる。

冪等性は入口の Attempt.kept.generating で担保する。生成中に削除された
場合も二重実行の場合も何もせず終わる。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `GenerateImageJob` の失敗経路

Cloudinary の一時障害とコードのバグを別々に扱う。これが無いと attempt が永久に `generating` のまま残り、フロントが延々ポーリングする。

**Files:**
- Modify: `backend/app/jobs/generate_image_job.rb`
- Modify: `backend/spec/jobs/generate_image_job_spec.rb`
- Modify: `backend/spec/rails_helper.rb`

**Interfaces:**
- Consumes: `Images::Uploader::UploadError`（既存）、`GenerateImageJob`（Task 2）
- Produces: `GenerateImageJob.mark_failed(attempt_id)`（クラスメソッド。`generating` の attempt を `failed` にする）

- [ ] **Step 1: job spec で `ActiveJob::TestHelper` を使えるようにする**

`backend/spec/rails_helper.rb` の `config.include FactoryBot::Syntax::Methods` の**直後**に追加する。

```ruby
  # perform_enqueued_jobs を job spec で使う。retry_on のリトライは
  # 「ブロック内で enqueue されたジョブ」として再実行されるため、
  # リトライを使い切る挙動はこれでしか書けない。
  config.include ActiveJob::TestHelper, type: :job
```

- [ ] **Step 2: 失敗するテストを書く**

`backend/spec/jobs/generate_image_job_spec.rb` の `describe "キュー"` の**手前**に追加する。

```ruby
  describe "失敗の扱い" do
    # Cloudinary の一時障害（UploadError）とコードのバグ（それ以外）を別々に扱う。
    # 宣言順（rescue_from を先、retry_on を後）が壊れると UploadError も
    # StandardError 側に吸われて 1 回目で failed になるため、その順序をここで固定する。
    it "UploadError の 1 回目は failed にせずリトライする" do
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call).and_raise(Images::Uploader::UploadError)

      expect { described_class.perform_now(attempt.id) }
        .to have_enqueued_job(described_class)
      expect(attempt.reload.status).to eq("generating")
    end

    it "UploadError を使い切ると failed になる" do
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call).and_raise(Images::Uploader::UploadError)

      perform_enqueued_jobs { described_class.perform_later(attempt.id) }

      expect(attempt.reload.status).to eq("failed")
    end

    # コードのバグは failed にしたうえで再送出する。ユーザーは失敗を見られ、
    # 開発者は solid_queue_failed_executions にエラーが残る。
    it "想定外の例外は failed にしてから再送出する" do
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call).and_raise(ArgumentError, "boom")

      expect { described_class.perform_now(attempt.id) }.to raise_error(ArgumentError)
      expect(attempt.reload.status).to eq("failed")
    end

    it "生成枠は failed でも戻さない" do
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call).and_raise(ArgumentError, "boom")

      expect { described_class.perform_now(attempt.id) }.to raise_error(ArgumentError)
      expect(attempt.reload.generated_at).to be_present
    end
  end
```

- [ ] **Step 3: テストが落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/jobs/generate_image_job_spec.rb -e "失敗の扱い"
```

期待：4 件とも失敗する。`UploadError` / `ArgumentError` がそのまま外に出て、status は `generating` のまま。

- [ ] **Step 4: 失敗経路を実装する**

`backend/app/jobs/generate_image_job.rb` の `queue_as :default` の**直後**に追加する。

```ruby
  # 宣言順に意味がある。ActiveJob はハンドラを後勝ちで探す（rescue_handlers を
  # 逆順に走査する）ため、rescue_from(StandardError) を先に、retry_on を後に書く。
  # 逆にすると UploadError も StandardError 側に吸われ、リトライされずに failed になる。
  #
  # コードのバグ：failed にしてから再送出する。ユーザーは失敗を見られ、開発者は
  # solid_queue_failed_executions にエラーが残る。握りつぶすと attempt が永久に
  # generating のまま残り、フロントが延々ポーリングする。
  rescue_from(StandardError) do |error|
    self.class.mark_failed(arguments.first)
    raise error
  end

  # Cloudinary の一時障害：3 回まで待って試す。使い切ったら failed にするが、
  # ジョブ自体は失敗扱いにしない（外部サービスの障害はコードのバグではない）。
  retry_on Images::Uploader::UploadError, wait: :polynomially_longer, attempts: 3 do |job, _error|
    Rails.logger.warn("[GenerateImageJob] Cloudinary へのアップロードに失敗しました attempt_id=#{job.arguments.first}")
    mark_failed(job.arguments.first)
  end

  # 生成枠は戻さない（生成はジョブ enqueue 時に消費する。ドメイン規則）ので
  # generated_at には触れない。
  def self.mark_failed(attempt_id)
    Attempt.generating.find_by(id: attempt_id)&.update!(status: :failed)
  end
```

`mark_failed` が `kept` で絞らないのは、生成中に削除された attempt も終端状態にしておくため（`generating` のまま残すと状態機械が壊れる）。

- [ ] **Step 5: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/jobs/generate_image_job_spec.rb
```

期待：全件 PASS（Task 2 で書いた成功経路も含めて）。

- [ ] **Step 6: rubocop を通してコミットする**

```bash
docker compose exec backend bundle exec rubocop
git add backend/app/jobs/generate_image_job.rb backend/spec/jobs/generate_image_job_spec.rb backend/spec/rails_helper.rb
git commit -m "$(cat <<'EOF'
feat: GenerateImageJob の失敗を failed に落とす

Cloudinary の一時障害は 3 回まで retry_on で試し、使い切ったら failed。
それ以外の例外は failed にしてから再送出し、solid_queue_failed_executions
にエラーを残す。握りつぶすと attempt が永久に generating のまま残り、
フロントが延々ポーリングする。

rescue_from と retry_on の宣言順が壊れると UploadError がリトライされなく
なるため、その順序を spec で固定した。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `Attempts::Generation`（上限チェックと enqueue）

この issue の中心。上限チェック・status 更新・enqueue を1つのトランザクションに閉じ込める。

**Files:**
- Create: `backend/lib/attempts/generation.rb`
- Create: `backend/spec/lib/attempts/generation_spec.rb`
- Modify: `backend/spec/rails_helper.rb`

**Interfaces:**
- Consumes: `GenerateImageJob.perform_later(attempt_id)`（Task 2）、`Attempt`（Task 1）
- Produces: `Attempts::Generation.call(attempt)` → `Attempts::Generation::Result`
  （`Data` オブジェクト。`error_code`（`String` または `nil`）と `limit`（`Integer` または `nil`）を持ち、`ok?` を答える）。
  `Attempts::Generation.daily_limit` → `Integer`。`Attempts::Generation::DEFAULT_DAILY_LIMIT = 3`。
  エラーコードは `"attempt_not_draft"` と `"generation_limit_reached"` の 2 種類。Task 6 のコントローラが使う。

**`spec/lib/` の前提（実測済み）:** `config.infer_spec_type_from_file_location!` は
`spec/lib` に type を付けない（`type` は `nil` になる）。この状態で何が使えるかを実際に確かめてある。

| | spec/lib で使えるか |
|---|---|
| トランザクションでの巻き戻し | **使える**（example をまたいでレコードは残らない） |
| `have_enqueued_job` マッチャ | **使える** |
| `travel_to` | **使えない** → Step 1 で `rails_helper` に足す |

- [ ] **Step 1: `travel_to` を spec/lib でも使えるようにする**

`backend/spec/rails_helper.rb` の `config.include FactoryBot::Syntax::Methods` の**直後**に追加する。

```ruby
  # travel_to / freeze_time。rspec-rails はこれを type 付きの example group にしか
  # 入れないため、type が付かない spec/lib では自分で include する必要がある
  # （生成回数の「1日」の境界は spec/lib/attempts/generation_spec.rb で見る）。
  config.include ActiveSupport::Testing::TimeHelpers
```

- [ ] **Step 2: 失敗するテストを書く**

`backend/spec/lib/attempts/generation_spec.rb` を新規作成する。

```ruby
require "rails_helper"

RSpec.describe Attempts::Generation do
  let(:user) { create(:user) }
  let(:attempt) { create(:attempt, user: user) }

  describe ".call" do
    it "draft を generating にして生成ジョブを積む" do
      expect { described_class.call(attempt) }
        .to have_enqueued_job(GenerateImageJob).with(attempt.id)

      attempt.reload
      expect(attempt.status).to eq("generating")
      expect(attempt.generated_at).to be_present
    end

    it "成功したら error_code が nil の Result を返す" do
      result = described_class.call(attempt)

      expect(result).to be_ok
      expect(result.error_code).to be_nil
    end

    it "draft でなければ何もせず attempt_not_draft を返す" do
      published = create(:attempt, :published, user: user)

      result = nil
      expect { result = described_class.call(published) }
        .not_to have_enqueued_job(GenerateImageJob)

      expect(result.error_code).to eq("attempt_not_draft")
      expect(published.reload.status).to eq("published")
    end
  end

  describe "1日の上限" do
    # 上限に達するまで枠を使った状態を作る。generated_at が入っていることが
    # 「枠を消費した」という意味なので、status は問わない。
    def consume(count, user: self.user, at: Time.current)
      create_list(:attempt, count, user: user, status: "published", generated_at: at)
    end

    it "既定は 3 回" do
      expect(described_class.daily_limit).to eq(3)
    end

    it "上限に達すると generation_limit_reached を返し、何も起きない" do
      consume(3)

      result = nil
      expect { result = described_class.call(attempt) }
        .not_to have_enqueued_job(GenerateImageJob)

      expect(result.error_code).to eq("generation_limit_reached")
      expect(result.limit).to eq(3)
      expect(attempt.reload.status).to eq("draft")
      expect(attempt.generated_at).to be_nil
    end

    it "上限の 1 つ手前なら通る" do
      consume(2)

      expect(described_class.call(attempt)).to be_ok
    end

    # 削除しても回数は戻さない（無限リトライ防止とコスト対策）。
    it "削除済みの生成も回数に数える" do
      consume(3).each(&:discard!)

      expect(described_class.call(attempt).error_code).to eq("generation_limit_reached")
    end

    it "他人の生成は数えない" do
      consume(3, user: create(:user))

      expect(described_class.call(attempt)).to be_ok
    end

    it "生成していない下書きは数えない" do
      create_list(:attempt, 3, user: user)

      expect(described_class.call(attempt)).to be_ok
    end

    it "KOTOE_DAILY_GENERATION_LIMIT で上書きできる" do
      allow(ENV).to receive(:fetch).and_call_original
      allow(ENV).to receive(:fetch).with("KOTOE_DAILY_GENERATION_LIMIT", 3).and_return("1")
      consume(1)

      expect(described_class.call(attempt).error_code).to eq("generation_limit_reached")
    end
  end

  describe "日付の境界" do
    # 「1日」は JST の暦日（config.time_zone = "Asia/Tokyo"）。
    # 2026-08-02 12:00 JST を「今」として、前日 23:59 と当日 0:00 の扱いを固定する。
    let(:now) { Time.zone.local(2026, 8, 2, 12, 0, 0) }

    around do |example|
      travel_to(now) { example.run }
    end

    it "前日 23:59 JST の生成は数えない" do
      create_list(:attempt, 3, user: user, generated_at: Time.zone.local(2026, 8, 1, 23, 59, 59))

      expect(described_class.call(attempt)).to be_ok
    end

    it "当日 0:00 JST の生成は数える" do
      create_list(:attempt, 3, user: user, generated_at: Time.zone.local(2026, 8, 2, 0, 0, 0))

      expect(described_class.call(attempt).error_code).to eq("generation_limit_reached")
    end
  end

  # 4-1 の設計（docs/superpowers/specs/2026-07-31-issue-4-1-solid-queue-design.md の
  # 「トランザクションの一体性」）が実際に効いていることを見る。ジョブテーブルが
  # アプリと同じ DB に同居しているため、ロールバックすればジョブ行も一緒に消える。
  # test アダプタは enqueue を配列に積むだけで DB と連動しないので、ここだけ
  # solid_queue アダプタに差し替える（spec/jobs/solid_queue_spec.rb と同じ手）。
  describe "トランザクションの一体性" do
    around do |example|
      original = ActiveJob::Base.queue_adapter
      ActiveJob::Base.queue_adapter = :solid_queue
      example.run
      ActiveJob::Base.queue_adapter = original
    end

    it "enqueue した後にロールバックするとジョブ行も残らない" do
      allow(GenerateImageJob).to receive(:perform_later).and_wrap_original do |original, *args|
        original.call(*args)
        raise ActiveRecord::Rollback
      end

      expect { described_class.call(attempt) }.not_to change(SolidQueue::Job, :count)
      expect(attempt.reload.status).to eq("draft")
    end
  end
end
```

- [ ] **Step 3: テストが落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/lib/attempts/generation_spec.rb
```

期待：`NameError: uninitialized constant Attempts` で全件失敗する。

- [ ] **Step 4: PORO を実装する**

`backend/lib/attempts/generation.rb` を新規作成する。

```ruby
module Attempts
  # 生成の起動。上限チェック → status 更新 → enqueue を、ひとまとまりで行う。
  #
  # コントローラに置かないのは、この3つが「必ず一緒に起きる」ことに意味があるため
  # （4-1 の設計「トランザクションの一体性」）。コントローラは Result を HTTP に
  # 翻訳するだけにする。文言ではなくエラーコードを返す（i18n はフロント）。
  class Generation
    DEFAULT_DAILY_LIMIT = 3

    Result = Data.define(:error_code, :limit) do
      def ok? = error_code.nil?
    end

    def self.call(attempt) = new(attempt).call

    # ENV はクラス本体ではなくここで読む。定数に畳むと起動時の値で固まり、
    # spec から差し替えられない。
    def self.daily_limit
      ENV.fetch("KOTOE_DAILY_GENERATION_LIMIT", DEFAULT_DAILY_LIMIT).to_i
    end

    def initialize(attempt)
      @attempt = attempt
    end

    def call
      # DB を書かない判定なのでロックの外で済ませる。
      return Result.new(error_code: "attempt_not_draft", limit: nil) unless @attempt.draft?

      # with_lock は users の行に SELECT ... FOR UPDATE を張り、そのままトランザクションになる。
      #
      # 1. ロックが無いと、連打や2タブからの同時リクエストが上限チェックを2つとも通過し、
      #    枠を超えて課金が発生する（4-3 以降は実費）。範囲は1ユーザーの行だけなので
      #    他のユーザーは待たない。
      # 2. status の更新と enqueue が同じトランザクションに入る。ジョブテーブルが
      #    アプリと同じ DB にあるため、ロールバックすればジョブ行も一緒に消えて
      #    孤児ジョブが出ない（ActiveJob::Base.enqueue_after_transaction_commit は
      #    false のまま変えないこと）。
      # 3. ブロックの戻り値がそのまま返るので、break や return でトランザクションを
      #    抜ける必要がない。
      @attempt.user.with_lock { start_generation }
    end

    private

    def start_generation
      limit = self.class.daily_limit
      return Result.new(error_code: "generation_limit_reached", limit: limit) if used_today >= limit

      @attempt.update!(status: :generating, generated_at: Time.current)
      GenerateImageJob.perform_later(@attempt.id)

      Result.new(error_code: nil, limit: nil)
    end

    # discard は default_scope を張らないため user.attempts には削除済みも含まれる。
    # それが狙いどおりで、「削除しても回数は戻さない」がクエリの形で満たされる。
    # 「1日」は JST の暦日（config.time_zone = "Asia/Tokyo"）。
    def used_today
      @attempt.user.attempts.where(generated_at: Time.zone.now.all_day).count
    end
  end
end
```

- [ ] **Step 5: backend を restart する**

`lib/attempts/` は新しいディレクトリなので、Zeitwerk に拾わせるために再起動が要る。これを飛ばすと rspec は green なのに curl だけ `uninitialized constant Attempts` で 500 になる。

```bash
docker compose restart backend
```

- [ ] **Step 6: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/lib/attempts/generation_spec.rb
```

期待：全件 PASS。

- [ ] **Step 7: rubocop を通してコミットする**

```bash
docker compose exec backend bundle exec rubocop
git add backend/lib/attempts backend/spec/lib/attempts backend/spec/rails_helper.rb
git commit -m "$(cat <<'EOF'
feat: 生成の起動と1日の回数上限を Attempts::Generation に置く

上限チェック・status 更新・enqueue を user 行のロックが張るトランザクションで
囲む。ロックが無いと同時リクエストが上限チェックを2つとも通過し、枠を超えて
課金が発生する。同じトランザクションに enqueue が入るため、ロールバック時に
ジョブ行も消えて孤児ジョブが出ない（4-1 の設計「トランザクションの一体性」）。

上限は既定 3 回/日で KOTOE_DAILY_GENERATION_LIMIT で上書きできる。
「1日」は JST の暦日。削除済みの生成も数える（回数は戻さない）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 下書きの作成と更新（`create` / `update`）

**Files:**
- Create: `backend/app/controllers/api/attempts_controller.rb`
- Modify: `backend/config/routes.rb`
- Create: `backend/spec/requests/api/attempts_spec.rb`

**Interfaces:**
- Consumes: `AttemptSerializer.call(attempt)`（既存。`with_likes_count` を通った Attempt を要求する）、`Attempt::MAX_DESCRIPTION_LENGTH`（Task 1）
- Produces: `Api::AttemptsController`（`create` / `update`）。private の `attempt_json(attempt)` と `attempt_attributes` は Task 6・7 も使う。
  ルート名 `api_post_attempts_path` / `api_attempt_path`。

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/attempts_spec.rb` を新規作成する。

```ruby
require "rails_helper"

RSpec.describe "挑戦 API", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }
  let(:post_record) { create(:post) }

  describe "POST /api/posts/:post_id/attempts" do
    it "下書きを作れる" do
      post "/api/posts/#{post_record.id}/attempts",
        params: { attempt: { description: "夕暮れの交差点。信号は赤。" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:created)
      expect(response.parsed_body["attempt"]).to include(
        "description" => "夕暮れの交差点。信号は赤。",
        "status" => "draft",
        "generated_image_public_id" => nil,
        "similarity_score" => nil,
        "likes_count" => 0,
        "user" => { "id" => user.id, "name" => user.name }
      )
      expect(Attempt.last.post_id).to eq(post_record.id)
    end

    it "未認証は 401" do
      post "/api/posts/#{post_record.id}/attempts",
        params: { attempt: { description: "あ" } }, as: :json

      expect(response).to have_http_status(:unauthorized)
    end

    it "削除済みのお題には作れない" do
      post_record.discard!

      post "/api/posts/#{post_record.id}/attempts",
        params: { attempt: { description: "あ" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body).to eq("error" => "not_found")
    end

    it "存在しないお題は 404" do
      post "/api/posts/0/attempts",
        params: { attempt: { description: "あ" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "描写が空なら 422 と blank" do
      post "/api/posts/#{post_record.id}/attempts",
        params: { attempt: { description: "" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("errors" => { "description" => [ "blank" ] })
    end

    it "描写が 1,000 文字を超えると 422 と too_long" do
      post "/api/posts/#{post_record.id}/attempts",
        params: { attempt: { description: "あ" * 1001 } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("errors" => { "description" => [ "too_long" ] })
    end

    # params[:attempt] の型はクライアントが決められる。スカラーを送られても
    # 500 にせず通常の 422 として扱う。
    it "attempt がスカラーでも 500 にならない" do
      post "/api/posts/#{post_record.id}/attempts",
        params: { attempt: "foo" },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    # 重複を禁じない（コストの守り手は回数制限であって重複禁止ではない）。
    # 禁じるならバリデーションが要るので、その判断をここで固定しておく。
    it "同じお題に何度でも挑戦できる" do
      create(:attempt, user: user, post: post_record)

      post "/api/posts/#{post_record.id}/attempts",
        params: { attempt: { description: "2 回目" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:created)
      expect(user.attempts.where(post: post_record).count).to eq(2)
    end

    # Kotoe は順位を競うラダーではなく、自分で動作を確かめられるほうが実用的。
    it "自分のお題にも挑戦できる" do
      own_post = create(:post, user: user)

      post "/api/posts/#{own_post.id}/attempts",
        params: { attempt: { description: "自分のお題" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:created)
    end
  end

  describe "PATCH /api/attempts/:id" do
    let(:attempt) { create(:attempt, user: user, post: post_record, description: "before") }

    it "自分の下書きを更新できる" do
      patch "/api/attempts/#{attempt.id}",
        params: { attempt: { description: "after" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]["description"]).to eq("after")
      expect(attempt.reload.description).to eq("after")
    end

    it "他人の下書きは 404" do
      others = create(:attempt)

      patch "/api/attempts/#{others.id}",
        params: { attempt: { description: "after" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "削除済みは 404" do
      attempt.discard!

      patch "/api/attempts/#{attempt.id}",
        params: { attempt: { description: "after" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    # 生成後に描写だけ書き換えられると、公開されている画像と説明が食い違う。
    it "draft でなければ 422 と attempt_not_draft" do
      published = create(:attempt, :published, user: user)

      patch "/api/attempts/#{published.id}",
        params: { attempt: { description: "after" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("error" => "attempt_not_draft")
      expect(published.reload.description).not_to eq("after")
    end

    it "空にすると 422 と blank" do
      patch "/api/attempts/#{attempt.id}",
        params: { attempt: { description: "" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("errors" => { "description" => [ "blank" ] })
      expect(attempt.reload.description).to eq("before")
    end

    it "未認証は 401" do
      patch "/api/attempts/#{attempt.id}",
        params: { attempt: { description: "after" } }, as: :json

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
```

- [ ] **Step 2: テストが落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/attempts_spec.rb
```

期待：ルートが無いため全件失敗する（`ActionController::RoutingError`）。

- [ ] **Step 3: ルートを足す**

`backend/config/routes.rb` の `resources :posts, only: %i[index create show destroy]` の行を、以下で置き換える。

```ruby
    resources :posts, only: %i[index create show destroy] do
      resources :attempts, only: %i[create]
    end

    # 挑戦（issue 4-2）。閲覧（show）だけ認証不要で、公開済み以外は本人にしか見えない。
    resources :attempts, only: %i[show update destroy] do
      post :generate, on: :member
    end
```

- [ ] **Step 4: コントローラを実装する**

`backend/app/controllers/api/attempts_controller.rb` を新規作成する。`show` / `destroy` / `generate` は Task 6・7 で足すので、ここでは `create` / `update` だけを書く。

```ruby
module Api
  # 挑戦（Attempt）。生成の可否や回数の判定は Attempts::Generation に、JSON の形は
  # シリアライザに寄せ、ここは HTTP の入出力だけを扱う。
  class AttemptsController < ApplicationController
    before_action :authenticate_user!

    def create
      # 削除済み・存在しないお題は RecordNotFound → 404。
      post = Post.kept.find(params[:post_id])
      attempt = current_user.attempts.new(post: post, description: attempt_attributes[:description])

      return render_validation_errors(attempt) unless attempt.save

      render json: { attempt: attempt_json(attempt) }, status: :created
    end

    def update
      attempt = owned_attempt
      return render_error("attempt_not_draft") unless attempt.draft?

      attempt.description = attempt_attributes[:description]
      return render_validation_errors(attempt) unless attempt.save

      render json: { attempt: attempt_json(attempt) }
    end

    private

    # current_user.attempts に限定することで、所有チェックの書き忘れが起こりようがない。
    # 他人の挑戦・存在しない ID・削除済みは、すべて RecordNotFound → 404 になる。
    def owned_attempt
      current_user.attempts.kept.find(params[:id])
    end

    # params[:attempt] の型はクライアントが決められる。attempt=foo のようなスカラーを
    # 送られても dig で TypeError にせず、通常の検証エラー（422）として扱う。
    def attempt_attributes
      params[:attempt].respond_to?(:dig) ? params[:attempt] : {}
    end

    # AttemptSerializer は with_likes_count が SELECT 句で付ける別名属性に依存している。
    # 新規・更新直後のレコードには乗っていないので、そのスコープ経由で取り直す。
    # 0 を直接埋めないのは、シリアライザの前提を1か所でも崩すと後で気づけなくなるため。
    def attempt_json(attempt)
      AttemptSerializer.call(Attempt.includes(:user).with_likes_count.find(attempt.id))
    end

    def render_validation_errors(attempt)
      errors = attempt.errors.details.transform_values { |details| details.pluck(:error) }
      render json: { errors: errors }, status: :unprocessable_content
    end

    def render_error(code, extra = {})
      render json: { error: code }.merge(extra), status: :unprocessable_content
    end
  end
end
```

- [ ] **Step 5: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/attempts_spec.rb
```

期待：全件 PASS。

- [ ] **Step 6: rubocop を通してコミットする**

```bash
docker compose exec backend bundle exec rubocop
git add backend/app/controllers/api/attempts_controller.rb backend/config/routes.rb backend/spec/requests/api/attempts_spec.rb
git commit -m "$(cat <<'EOF'
feat: 描写の下書き作成・更新 API を足す

「保存」ボタンにあたる2本。更新は draft のときだけ受け付ける。生成後に
描写だけ書き換えられると、公開されている画像と説明が食い違うため。

所有チェックは current_user.attempts.kept.find に寄せ、他人・削除済み・
存在しない ID をすべて 404 に倒す（3-2 の destroy と同じ形）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 生成の起動（`generate`）

**Files:**
- Modify: `backend/app/controllers/api/attempts_controller.rb`
- Modify: `backend/spec/requests/api/attempts_spec.rb`

**Interfaces:**
- Consumes: `Attempts::Generation.call(attempt)` → `Result`（`ok?` / `error_code` / `limit`）（Task 4）、`attempt_json` / `owned_attempt` / `render_error`（Task 5）
- Produces: `POST /api/attempts/:id/generate` → 202 / 404 / 422

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/attempts_spec.rb` の `describe "PATCH /api/attempts/:id"` ブロックの**直後**（`RSpec.describe` の閉じ `end` の手前）に追加する。

```ruby
  describe "POST /api/attempts/:id/generate" do
    let(:attempt) { create(:attempt, user: user, post: post_record) }

    it "生成を起動すると 202 と generating を返し、ジョブが積まれる" do
      expect {
        post "/api/attempts/#{attempt.id}/generate", headers: auth_headers(token), as: :json
      }.to have_enqueued_job(GenerateImageJob).with(attempt.id)

      expect(response).to have_http_status(:accepted)
      expect(response.parsed_body["attempt"]["status"]).to eq("generating")
      expect(attempt.reload.generated_at).to be_present
    end

    it "他人の挑戦は 404" do
      others = create(:attempt)

      post "/api/attempts/#{others.id}/generate", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "draft でなければ 422 と attempt_not_draft" do
      published = create(:attempt, :published, user: user)

      post "/api/attempts/#{published.id}/generate", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("error" => "attempt_not_draft")
    end

    it "未認証は 401" do
      post "/api/attempts/#{attempt.id}/generate", as: :json

      expect(response).to have_http_status(:unauthorized)
    end

    # 「1日」は JST の暦日。API が返す時刻は他のフィールドと同じく UTC の ISO8601 に
    # 揃えるので、JST 翌日 0 時は …T15:00:00Z になる。
    it "上限に達すると 422 とコード・上限・回復時刻を返す" do
      travel_to(Time.zone.local(2026, 8, 2, 12, 0, 0)) do
        create_list(:attempt, 3, user: user, status: "published", generated_at: Time.current)

        post "/api/attempts/#{attempt.id}/generate", headers: auth_headers(token), as: :json

        expect(response).to have_http_status(:unprocessable_content)
        expect(response.parsed_body).to eq(
          "error" => "generation_limit_reached",
          "limit" => 3,
          "resets_at" => "2026-08-02T15:00:00Z"
        )
      end
      expect(attempt.reload.status).to eq("draft")
    end
  end
```

`travel_to` は Task 4 の Step 1 で `rails_helper` に include 済み。request spec は `type: :request` が付くので、その設定が無くても使えるが、二重に include しても問題は起きない。

- [ ] **Step 2: テストが落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/attempts_spec.rb -e "generate"
```

期待：`generate` のルートに対応するアクションが無いため失敗する。

- [ ] **Step 3: アクションを実装する**

`backend/app/controllers/api/attempts_controller.rb` の `update` の**直後**（`private` の手前）に追加する。

```ruby
    def generate
      attempt = owned_attempt
      result = Attempts::Generation.call(attempt)

      return render_generation_error(result) unless result.ok?

      render json: { attempt: attempt_json(attempt) }, status: :accepted
    end
```

`private` の中、`render_error` の**直後**に追加する。

```ruby
    # 上限到達のときだけ、フロントが「あと◯時間で回復します」を組み立てられるよう
    # 補助情報を足す。文言そのものは返さない（i18n はフロント）。
    def render_generation_error(result)
      return render_error(result.error_code) if result.limit.nil?

      render_error(result.error_code, limit: result.limit, resets_at: next_reset_at)
    end

    # 「1日」は JST の暦日なので回復は JST の翌 0 時。返す形は他のフィールドと同じく
    # UTC の ISO8601 に揃える。
    def next_reset_at
      Time.zone.tomorrow.beginning_of_day.utc.iso8601
    end
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/attempts_spec.rb
```

期待：全件 PASS。

- [ ] **Step 5: rubocop を通してコミットする**

```bash
docker compose exec backend bundle exec rubocop
git add backend/app/controllers/api/attempts_controller.rb backend/spec/requests/api/attempts_spec.rb
git commit -m "$(cat <<'EOF'
feat: 生成を起動する API を足す

判定は Attempts::Generation が持ち、コントローラは Result を HTTP に
翻訳するだけにする。上限到達のときだけ limit と resets_at を足し、
「あと◯時間で回復します」の文言はフロントが組み立てる。

resets_at は JST 翌 0 時を UTC の ISO8601 で返す（判定の基準は JST、
線の上での表現は他のフィールドと揃える）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: ポーリング／比較ビューと論理削除（`show` / `destroy`）

**Files:**
- Modify: `backend/app/controllers/api/attempts_controller.rb`
- Modify: `backend/spec/requests/api/attempts_spec.rb`

**Interfaces:**
- Consumes: `PostSerializer.call(post)`（既存。`with_counts` を通った Post を要求する）、Task 5 の private メソッド
- Produces: `GET /api/attempts/:id` → `{ "attempt": {...}, "post": {...} }`、`DELETE /api/attempts/:id` → 204

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/requests/api/attempts_spec.rb` の `describe "POST /api/attempts/:id/generate"` の**直後**に追加する。

```ruby
  describe "GET /api/attempts/:id" do
    it "公開済みの挑戦は未認証でも取得でき、お題も一緒に返る" do
      attempt = create(:attempt, :published, user: user, post: post_record)
      create_list(:like, 2, attempt: attempt)

      get "/api/attempts/#{attempt.id}"

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]).to include(
        "id" => attempt.id,
        "status" => "published",
        "generated_image_public_id" => "kotoe/test/generated/sample",
        "likes_count" => 2
      )
      # 比較ビューが「元画像 vs 再現画像」を並べるため、元画像がこの1本で揃う。
      expect(response.parsed_body["post"]).to include(
        "id" => post_record.id,
        "image_public_id" => post_record.image_public_id
      )
    end

    it "自分の下書きは取得できる" do
      attempt = create(:attempt, user: user)

      get "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]["status"]).to eq("draft")
    end

    it "生成中の自分の挑戦をポーリングできる" do
      attempt = create(:attempt, :generating, user: user)

      get "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(response.parsed_body["attempt"]["status"]).to eq("generating")
    end

    # 403 にせず存在ごと隠す。未認証も 401 ではなく 404 にする。published が
    # 認証不要である以上、401 は「認証すれば見える何かがある」と漏らすため。
    it "他人の下書きは 404" do
      others = create(:attempt)

      get "/api/attempts/#{others.id}", headers: auth_headers(token)

      expect(response).to have_http_status(:not_found)
    end

    it "未認証で他人の下書きを取ると 404" do
      others = create(:attempt)

      get "/api/attempts/#{others.id}"

      expect(response).to have_http_status(:not_found)
    end

    it "削除済みは本人でも 404" do
      attempt = create(:attempt, :published, user: user)
      attempt.discard!

      get "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(response).to have_http_status(:not_found)
    end

    it "お題が削除されていたら 404" do
      attempt = create(:attempt, :published, user: user, post: post_record)
      post_record.discard!

      get "/api/attempts/#{attempt.id}"

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "DELETE /api/attempts/:id" do
    it "自分の挑戦を論理削除できる" do
      attempt = create(:attempt, :published, user: user)

      delete "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(response).to have_http_status(:no_content)
      expect(attempt.reload).to be_discarded
      expect(Attempt.where(id: attempt.id)).to exist
    end

    # 削除しても回数は戻さない（無限リトライ防止とコスト対策）。
    it "削除しても generated_at は消えない" do
      attempt = create(:attempt, :published, user: user, generated_at: Time.current)

      delete "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(attempt.reload.generated_at).to be_present
    end

    it "生成中でも削除できる" do
      attempt = create(:attempt, :generating, user: user)

      delete "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(response).to have_http_status(:no_content)
      expect(attempt.reload).to be_discarded
    end

    it "他人の挑戦は 404" do
      others = create(:attempt)

      delete "/api/attempts/#{others.id}", headers: auth_headers(token)

      expect(response).to have_http_status(:not_found)
    end

    it "未認証は 401" do
      attempt = create(:attempt, user: user)

      delete "/api/attempts/#{attempt.id}"

      expect(response).to have_http_status(:unauthorized)
    end
  end
```

- [ ] **Step 2: テストが落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/attempts_spec.rb -e "GET /api/attempts"
```

期待：`show` アクションが無いため失敗する。

- [ ] **Step 3: `show` を認証不要にする**

`backend/app/controllers/api/attempts_controller.rb` の `before_action :authenticate_user!` の行を置き換える。

```ruby
    # show だけ認証不要。公開済みの挑戦は誰でも見られる（共有用パーマリンク）。
    before_action :authenticate_user!, except: :show
```

- [ ] **Step 4: `show` / `destroy` を実装する**

`generate` の**直後**（`private` の手前）に追加する。

```ruby
    def show
      attempt = visible_attempt
      post = Post.kept.includes(:user).with_counts.find(attempt.post_id)

      render json: { attempt: AttemptSerializer.call(attempt), post: PostSerializer.call(post) }
    end

    def destroy
      # 生成中でも削除できる。ジョブ側が kept で絞っているので、走っても何もしない。
      # generated_at は消さない（削除しても回数は戻さない）。
      owned_attempt.discard!
      head :no_content
    end
```

`private` の中、`owned_attempt` の**直後**に追加する。

```ruby
    # 公開済みは誰でも、それ以外は本人だけ。見えない場合は 403 ではなく 404 にして
    # 存在ごと隠す。未認証も 401 ではなく 404 にする（published が認証不要である以上、
    # 401 は「認証すれば見える何かがある」と漏らすため）。
    def visible_attempt
      attempt = Attempt.kept.includes(:user).with_likes_count.find(params[:id])
      raise ActiveRecord::RecordNotFound unless attempt.published? || attempt.user_id == current_user&.id

      attempt
    end
```

- [ ] **Step 5: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/attempts_spec.rb
```

期待：全件 PASS。「お題が削除されていたら 404」は `Post.kept.find` の `RecordNotFound` が `ApplicationController` の `rescue_from` に拾われて通る。

- [ ] **Step 6: バックエンド全体のテストと rubocop を通してコミットする**

```bash
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec rubocop
git add backend/app/controllers/api/attempts_controller.rb backend/spec/requests/api/attempts_spec.rb
git commit -m "$(cat <<'EOF'
feat: 挑戦の取得（ポーリング／比較）と論理削除 API を足す

show は公開済みなら未認証でも返し、下書き・生成中・失敗は本人にしか
見せない。見えない場合は 403 ではなく 404 で存在ごと隠す。未認証も
401 にしない（published が認証不要である以上、401 は「認証すれば
見える何かがある」と漏らすため）。

比較ビューが「元画像 vs 再現画像」を並べるため、お題も同じ応答に含める。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: ローカルでの動作確認（ワーカーを通した一連の流れ）

RSpec は Cloudinary もワーカーもスタブしている。実際に Solid Queue のワーカーが処理して `published` に変わるところまでを、ブラウザ相当の HTTP で確かめる。

**Files:**
- なし（確認のみ。問題が見つかったら該当タスクに戻る）

**Interfaces:**
- Consumes: Task 1〜7 のすべて

- [ ] **Step 1: 環境を立て直す**

`lib/attempts/` を足しているので、backend を確実に読み直させる。

```bash
docker compose up -d
docker compose restart backend
docker compose logs -f worker
```

`worker` のログに Solid Queue の supervisor 起動が出ることを確認したら Ctrl-C で抜ける。

- [ ] **Step 2: ユーザーとお題を用意してトークンを取る**

```bash
docker compose exec backend bin/rails runner '
user = User.find_or_create_by!(email: "smoke-4-2@example.com") { |u| u.name = "スモーク"; u.password = "password123" }
post = Post.find_or_create_by!(title: "4-2 動作確認", user: user) { |p| p.image_public_id = "kotoe/development/posts/dummy" }
puts "post_id=#{post.id}"
'

TOKEN=$(curl -si -X POST http://localhost:3000/api/auth/sign_in \
  -H "Content-Type: application/json" \
  -d '{"user":{"email":"smoke-4-2@example.com","password":"password123"}}' \
  | grep -i "^authorization:" | cut -d" " -f2- | tr -d "\r")
echo "${TOKEN:0:20}..."
```

- [ ] **Step 3: 下書きを作って生成を起動する**

`POST_ID` は Step 2 の出力に置き換える。

```bash
ATTEMPT=$(curl -s -X POST http://localhost:3000/api/posts/POST_ID/attempts \
  -H "Content-Type: application/json" -H "Authorization: $TOKEN" \
  -d '{"attempt":{"description":"夕暮れの交差点。信号は赤で、傘をさした人が渡っている。"}}')
echo "$ATTEMPT"

ATTEMPT_ID=$(echo "$ATTEMPT" | ruby -rjson -e 'puts JSON.parse(STDIN.read)["attempt"]["id"]')

curl -s -X POST "http://localhost:3000/api/attempts/$ATTEMPT_ID/generate" \
  -H "Authorization: $TOKEN"
```

期待：作成の応答が `"status":"draft"`、生成の応答が `"status":"generating"`。

- [ ] **Step 4: ポーリングして published になることを確認する**

```bash
for i in 1 2 3 4 5; do
  curl -s "http://localhost:3000/api/attempts/$ATTEMPT_ID" \
    | ruby -rjson -e 'j = JSON.parse(STDIN.read); puts "#{j["attempt"]["status"]} #{j["attempt"]["generated_image_public_id"]}"'
  sleep 2
done
```

期待：数秒で `generating` → `published` に変わり、`kotoe/development/generated/...` の public_id が入る。
**ここが 4-1 から委譲された「ワーカーが実際にジョブを処理する」確認のローカル版**にあたる。

- [ ] **Step 5: 生成回数の上限が効くことを確認する**

Step 3 を繰り返して 4 回目を叩く（既に 1 回消費しているので、あと 2 回成功して 4 回目が弾かれる）。

期待：4 回目が 422 で、本文が
`{"error":"generation_limit_reached","limit":3,"resets_at":"...T15:00:00Z"}`。

- [ ] **Step 6: 削除しても回数が戻らないことを確認する**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE "http://localhost:3000/api/attempts/$ATTEMPT_ID" -H "Authorization: $TOKEN"
```

期待：`204`。そのうえで新しい下書きを作って generate を叩くと、やはり `generation_limit_reached` が返る。

- [ ] **Step 7: 確認に使ったデータを片づける**

```bash
docker compose exec backend bin/rails runner '
user = User.find_by(email: "smoke-4-2@example.com")
next if user.nil?
user.attempts.each(&:discard)
user.posts.each(&:discard)
puts "discarded: attempts=#{user.attempts.count} posts=#{user.posts.count}"
'
```

**物理削除はしない**（プロジェクト規約）。ローカルの開発 DB なのでユーザーごと消したくなるが、`discard` に留める。

---

### Task 9: ドキュメントの更新

**Files:**
- Modify: `docs/screen_and_api_design.md`
- Modify: `docs/issues_backlog.md`

- [ ] **Step 1: API 一覧に確定した内容を反映する**

`docs/screen_and_api_design.md` の「### 挑戦（Attempt）」の表の**直後**、`> 補足：「保存」ボタン…` の段落の**手前**に追加する。

````markdown
実装は issue 4-2。確定した挙動：

- 状態は `draft → generating → published`（生成成功で即公開）または `failed`。
  **`published` / `failed` は終端**で、再試行は新しい下書きを作る。
- `PATCH` と `generate` は **draft のときだけ**受け付ける。それ以外は 422 `attempt_not_draft`。
- 生成回数は **1日 3 回**（`KOTOE_DAILY_GENERATION_LIMIT` で上書き可）。「1日」は JST の暦日。
  上限到達は 422 で、補助情報を添える：

  ```json
  { "error": "generation_limit_reached", "limit": 3, "resets_at": "2026-08-02T15:00:00Z" }
  ```

- `GET /api/attempts/:id` は `{ "attempt": {...}, "post": {...} }` を返す（比較ビューが
  元画像を必要とするため）。`published` は誰でも、それ以外は**本人のみ**で、他人・未認証からは
  404（403 や 401 にせず存在ごと隠す）。
- `DELETE` は論理削除で、`generated_at` を消さない（**回数は戻らない**）。生成中でも削除できる。
- 描写（`description`）は **1〜1,000 文字**。超過は 422 `{ "errors": { "description": ["too_long"] } }`。
````

- [ ] **Step 2: バックログのチェックボックスを埋める**

`docs/issues_backlog.md` の「### 🟢 4-2」のタスクのうち、**本番確認の2件を除いて** `- [ ]` を `- [x]` に変える。本番確認（`本番でのワーカー稼働確認` と `Render 無料枠のメモリ実測`）は Task 10 で行うため、この時点では未チェックのまま残す。

- [ ] **Step 3: コミットする**

```bash
git add docs/screen_and_api_design.md docs/issues_backlog.md
git commit -m "$(cat <<'EOF'
docs: 挑戦 API の確定した挙動を設計ドキュメントに反映する

状態遷移・エラーコード・生成回数上限・可視性・描写の長さを、実装した
とおりに API 一覧へ書き足す。本番確認の2件は未着手なのでバックログの
チェックは残す。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 本番での確認（4-1 からの委譲ぶん）

**PR がマージされ、Render のデプロイが完了してから行う。** 4-1 の時点では本番でジョブを enqueue する手段が無く（Render 無料インスタンスはシェルが使えない）、この issue に委譲されていた。

**Files:**
- Modify: `docs/README.md`（実測値の追記）
- Modify: `docs/issues_backlog.md`（残りのチェックボックス）

- [ ] **Step 1: `SOLID_QUEUE_IN_PUMA` が本番に実在することを目視で確認する**

Render のダッシュボード → `kotoe-api` → Environment を開き、`SOLID_QUEUE_IN_PUMA` が設定されていることを見る。**未設定でもデプロイは成功し、ジョブが無言で溜まるだけ**になるため、この目視が要る。

- [ ] **Step 2: 本番で一連の流れを叩く**

Task 8 の Step 2〜4 と同じ手順を、`http://localhost:3000` を `https://kotoe-api.onrender.com` に置き換えて実行する。無料インスタンスはスリープからの復帰に約1分かかるので、最初の1本はタイムアウトを長めに取る。

期待：`generating` → `published` に変わる。**これが本番でワーカーが生きている証拠**になる。

- [ ] **Step 3: メモリを実測する**

Render のダッシュボード → `kotoe-api` → Metrics で、生成を数回流した直後のメモリ使用量を読む。512 MB に Puma＋supervisor＋dispatcher＋worker が収まっているかを見る。

収まっていない場合は有料ワーカーへの切り出しを検討するが、`docs/README.md` の「無料枠の制約」のとおり **$7 のワーカーは連鎖が切れて実質 $26/月**になる。判断はそこを読んでから行う。

- [ ] **Step 4: 本番の確認データを片づける**

Task 8 の Step 7 と同じ `bin/rails runner` は本番では使えない（シェルが無い）。API 経由で `DELETE /api/attempts/:id` と `DELETE /api/posts/:id` を叩いて論理削除する。8-2a のスモークユーザーが残っている場合は、同じ機会に投稿とあわせて片づける。

- [ ] **Step 5: 実測値を記録してコミットする**

`docs/README.md` の「## 💰 無料枠の制約」の「### 各プラットフォームの実数値」の表の**直後**に、測った値を追記する。

```markdown
### Render 無料枠のメモリ実測（issue 4-2 で計測・<計測日>）

| 状態 | 使用量 |
|---|---|
| アイドル（Puma＋Solid Queue の supervisor / dispatcher / worker） | <実測値> MB |
| 生成ジョブの処理中 | <実測値> MB |

上限は 512 MB。<収まっている／収まっていない と、そこからの判断を1〜2行で書く>
```

`docs/issues_backlog.md` の 4-2 に残っていた本番確認2件を `- [x]` にする。

```bash
git add docs/README.md docs/issues_backlog.md
git commit -m "$(cat <<'EOF'
docs: 本番のワーカー稼働確認と無料枠のメモリ実測を記録する

4-1 から委譲されていた2件。本番URLで generating → published に変わる
ことを確認し、Render の 512 MB に対する実測値を残す。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 完了条件

- 描写の保存・生成（ダミー）・即公開・削除が動く
- 生成回数制限（3回/日・JST の暦日）が効き、削除しても戻らない
- `docker compose exec backend bundle exec rspec` と `bundle exec rubocop` が green
- 本番で `generating` → `published` に変わることを確認済み（Task 10）
