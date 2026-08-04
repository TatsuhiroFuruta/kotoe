# issue 4-3 画像生成APIの本接続 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GenerateImageJob` が返す固定のダミー画像を、OpenAI の gpt-image-2 が描写文から生成した実画像に差し替える。あわせてサービス全体のコストガードを入れる。

**Architecture:** 画像を作る道具は `lib/images/` の PORO（`Prompt` / `Generator` / `Generators::Openai` / `Generators::Dummy`）に置き、`self.call` を唯一の入口にする。生成の可否判定は既存の `Attempts::Generation`（ドメインのルール）に残し、ジョブは3者を配線して失敗を `failed` + `failure_reason` に落とすだけにする。プロバイダの切り替えを知るのは `Images::Generator` 1か所だけで、本番のみ実 API、ローカル / CI / E2E はダミーで回る。

**Tech Stack:** Rails 8.1（API モード）/ Net::HTTP（gem を足さない）/ Solid Queue / Cloudinary / RSpec + webmock

**設計ドキュメント:** `docs/superpowers/specs/2026-08-04-issue-4-3-image-generation-design.md`（判断の根拠はすべてここ。迷ったら読む）

## Global Constraints

- ブランチは `feature/issue-4-3`（作成済み）。main へ直接コミットしない。1 issue = 1 ブランチ = 1 PR
- コミット前に `docker compose exec backend bundle exec rubocop` と `docker compose exec backend bundle exec rspec` を通す
- **文字列はダブルクォート**（spec も含めプロジェクト全体で統一）
- **API キーはサーバー（Rails）側のみ**。フロントに出さない。ログ・URL パラメータにも出さない
- **エラーは文言ではなくコードを返す**（i18n はフロント側の辞書）
- 論理削除は `discard`。物理削除しない
- 生成枠は失敗しても削除しても**戻さない**。`generated_at` に触れない
- モデル / 品質 / 出力形式 / 圧縮率は**環境変数にせず定数**にする
- 例外メッセージに外部 API のレスポンス本文とプロンプト（ユーザーの描写文）を入れない
- 確定値（設計で決定済み。勝手に変えない）:
  - モデル `gpt-image-2` / `size` `1024x1024` / `quality` `low`
  - `output_format` `webp` / `output_compression` `90` / `moderation` `auto`
  - `open_timeout` 10 秒 / `read_timeout` 150 秒
  - リトライ: 生成 API は **2 回**、Cloudinary は **3 回**
  - サービス全体の1日上限の既定値 **50**
  - `config/queue.yml` の `workers.threads` は **3 のまま据え置く**（下げない）

**よく使うコマンド**

```bash
docker compose exec backend bundle exec rspec <path>
docker compose exec backend bundle exec rubocop
docker compose exec backend bin/rails db:migrate
docker compose exec -e RAILS_ENV=test backend bin/rails db:prepare
docker compose restart backend
```

## File Structure

| ファイル | 責務 |
|---|---|
| `db/migrate/*_add_failure_reason_to_attempts.rb`（新規） | `attempts.failure_reason` の追加 |
| `app/models/attempt.rb`（変更） | `FAILURE_REASONS` と inclusion バリデーション |
| `app/serializers/attempt_serializer.rb`（変更） | `failure_reason` を応答に載せる |
| `lib/images/prompt.rb`（新規） | 描写文 → プロンプト文字列（純粋関数） |
| `lib/images/generator.rb`（新規） | 例外クラス階層 ＋ プロバイダの選択と委譲 |
| `lib/images/generators/openai.rb`（新規） | `POST /v1/images/generations`。HTTP ステータス → 例外クラスの翻訳 |
| `lib/images/generators/dummy.rb`（新規） | 4-2 の固定 PNG を yield |
| `app/jobs/generate_image_job.rb`（変更） | 配線とエラーハンドラの拡張 |
| `lib/attempts/generation.rb`（変更） | キルスイッチとサービス全体の1日上限 |
| `app/controllers/api/attempts_controller.rb`（変更） | エラーコード → 422 / 503 の振り分け |
| `config/initializers/openai.rb`（新規） | `OPENAI_API_KEY` の起動時チェック |
| `Gemfile` / `spec/support/webmock.rb`（変更・新規） | spec の HTTP を塞ぐ |

---

### Task 1: `attempts.failure_reason` の追加

失敗の理由を保持して API で返せるようにする。ここだけで独立してテストできる。

**Files:**
- Create: `backend/db/migrate/<timestamp>_add_failure_reason_to_attempts.rb`
- Modify: `backend/app/models/attempt.rb`
- Modify: `backend/app/serializers/attempt_serializer.rb`
- Modify: `backend/spec/factories/attempts.rb`
- Test: `backend/spec/models/attempt_spec.rb`, `backend/spec/requests/api/attempts_spec.rb`

**Interfaces:**
- Produces: `Attempt::FAILURE_REASONS`（`%w[content_policy rate_limited api_error upload_failed internal_error]`）、`attempt.failure_reason`（String または nil）、`AttemptSerializer.call` の応答に `failure_reason` キー

- [ ] **Step 1: マイグレーションを生成する**

```bash
docker compose exec backend bin/rails generate migration AddFailureReasonToAttempts failure_reason:string
```

生成されたファイルが下記になっていることを確認する（インデックスは張らない。検索条件にならないため）。

```ruby
class AddFailureReasonToAttempts < ActiveRecord::Migration[8.1]
  def change
    add_column :attempts, :failure_reason, :string
  end
end
```

- [ ] **Step 2: マイグレーションを適用する（開発DBとテストDBの両方）**

```bash
docker compose exec backend bin/rails db:migrate
docker compose exec -e RAILS_ENV=test backend bin/rails db:prepare
```

- [ ] **Step 3: 失敗するモデル spec を書く**

`spec/models/attempt_spec.rb` の validation を書いている describe に追記する。

```ruby
    it { is_expected.to validate_inclusion_of(:failure_reason).in_array(described_class::FAILURE_REASONS).allow_nil }
```

- [ ] **Step 4: 落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/models/attempt_spec.rb
```

Expected: FAIL（`NameError: uninitialized constant Attempt::FAILURE_REASONS`）

- [ ] **Step 5: モデルに定数とバリデーションを足す**

`app/models/attempt.rb` の `MAX_DESCRIPTION_LENGTH` の下に置く。

```ruby
  # 生成が失敗した理由。文言ではなくコードを持ち、翻訳はフロントの辞書が担当する。
  #
  # status と違って enum にしない。status は状態機械でスコープに意味があるが、
  # failure_reason は分岐にも一覧にも使わない付随情報で、enum にすると
  # Attempt.api_error のようなスコープが生えて紛らわしくなる。
  FAILURE_REASONS = %w[content_policy rate_limited api_error upload_failed internal_error].freeze
```

`validates :status, presence: true` の下に足す。

```ruby
  validates :failure_reason, inclusion: { in: FAILURE_REASONS }, allow_nil: true
```

- [ ] **Step 6: 通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/models/attempt_spec.rb
```

Expected: PASS

- [ ] **Step 7: 失敗する request spec を書く**

`spec/requests/api/attempts_spec.rb` の `describe "GET /api/attempts/:id"` に追記する。

```ruby
    it "失敗した挑戦は理由コードを返す" do
      attempt = create(:attempt, :failed, user: user, failure_reason: "content_policy")

      get "/api/attempts/#{attempt.id}", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]).to include(
        "status" => "failed",
        "failure_reason" => "content_policy"
      )
    end

    it "失敗していない挑戦の failure_reason は null" do
      attempt = create(:attempt, :published, user: user)

      get "/api/attempts/#{attempt.id}", as: :json

      expect(response.parsed_body["attempt"]).to include("failure_reason" => nil)
    end
```

- [ ] **Step 8: 落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/attempts_spec.rb
```

Expected: FAIL（応答に `failure_reason` キーが無い）

- [ ] **Step 9: シリアライザに足す**

`app/serializers/attempt_serializer.rb` の `status:` の下に1行足す。

```ruby
      failure_reason: attempt.failure_reason,
```

- [ ] **Step 10: ファクトリの `:failed` trait に理由を足す**

`spec/factories/attempts.rb`。失敗した挑戦は必ず理由を持つのが正常な状態なので、trait をその形にしておく。

```ruby
    trait :failed do
      status { "failed" }
      generated_at { Time.current }
      failure_reason { "api_error" }
    end
```

- [ ] **Step 11: 通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/models/attempt_spec.rb spec/requests/api/attempts_spec.rb
```

Expected: PASS

- [ ] **Step 12: rubocop を通してコミット**

```bash
docker compose exec backend bundle exec rubocop
cd backend && git add app/models/attempt.rb app/serializers/attempt_serializer.rb db/migrate db/schema.rb spec/factories/attempts.rb spec/models/attempt_spec.rb spec/requests/api/attempts_spec.rb
git commit -m "feat: 生成失敗の理由（failure_reason）を持たせる"
```

---

### Task 2: `Images::Prompt`

描写文からプロンプト文字列を組み立てる純粋関数。外部依存が無く、単体で完結する。

**Files:**
- Create: `backend/lib/images/prompt.rb`
- Test: `backend/spec/lib/images/prompt_spec.rb`

**Interfaces:**
- Produces: `Images::Prompt.call(description) → String`、`Images::Prompt::PREFIX`（String）

- [ ] **Step 1: 失敗する spec を書く**

`spec/lib/images/prompt_spec.rb` を新規作成する。

```ruby
require "rails_helper"

RSpec.describe Images::Prompt do
  describe ".call" do
    it "接頭辞のあとに描写文をそのまま置く" do
      expect(described_class.call("青い空と白い雲")).to eq("#{described_class::PREFIX}\n青い空と白い雲")
    end

    it "描写文を書き換えない" do
      expect(described_class.call("赤い車。文字は無い。")).to end_with("赤い車。文字は無い。")
    end

    # 素の描写文をそのまま投げると画像内への文字の描き込みや勝手なイラスト調への
    # 寄せが混ざり、「描写の忠実さを競う」という評価軸がブレる。
    it "描写にない要素を足さないよう指示する" do
      expect(described_class.call("空")).to include("描写に書かれていない要素を足さないこと")
    end

    it "文字を描き込まないよう指示する" do
      expect(described_class.call("空")).to include("文字・透かし・枠は描き込まないこと")
    end
  end
end
```

- [ ] **Step 2: 落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/lib/images/prompt_spec.rb
```

Expected: FAIL（`NameError: uninitialized constant Images::Prompt`）

- [ ] **Step 3: 実装する**

`lib/images/prompt.rb` を新規作成する。

```ruby
module Images
  # 描写文から画像生成APIに渡すプロンプトを組み立てる。
  #
  # 素の描写文だけを投げると、画像内への文字の描き込みや勝手なイラスト調への寄せが
  # 混ざり、「描写の忠実さを競う」という Kotoe の評価軸がブレる。接頭辞は全ユーザーに
  # 等しくかかるので公平性は損なわれない。
  #
  # 元画像やお題のタイトルは渡さない（渡すとゲームが成立しない）。日本語のまま投げる
  # （gpt-image 系は多言語対応で、翻訳を挟むと費用が増えるうえ意味もずれる）。
  #
  # 受け取るのは Attempt ではなく描写文の文字列だけ。プロンプトの組み立てにモデルの
  # 都合は要らないので、依存を文字列 1 つに絞る。
  class Prompt
    PREFIX = <<~TEXT.strip
      以下の描写だけをもとに画像を1枚生成してください。
      描写に書かれていない要素を足さないこと。文字・透かし・枠は描き込まないこと。
    TEXT

    def self.call(description) = "#{PREFIX}\n#{description}"
  end
end
```

- [ ] **Step 4: 通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/lib/images/prompt_spec.rb
```

Expected: PASS

- [ ] **Step 5: rubocop を通してコミット**

```bash
docker compose exec backend bundle exec rubocop
cd backend && git add lib/images/prompt.rb spec/lib/images/prompt_spec.rb
git commit -m "feat: 描写文からプロンプトを組み立てる Images::Prompt を足す"
```

---

### Task 3: webmock の導入と `Images::Generators::Openai` の成功経路

OpenAI を叩いて画像を取り出す部分。エラーの分類は Task 4 で足す。

**Files:**
- Modify: `backend/Gemfile`
- Create: `backend/spec/support/webmock.rb`
- Create: `backend/lib/images/generator.rb`（この時点では例外クラスだけ）
- Create: `backend/lib/images/generators/openai.rb`
- Test: `backend/spec/lib/images/generators/openai_spec.rb`

**Interfaces:**
- Consumes: なし
- Produces:
  - `Images::Generator::Error < StandardError`（`#code → String`、`.new(code, detail: nil)`）
  - `Images::Generator::TransientError < Images::Generator::Error`
  - `Images::Generator::PermanentError < Images::Generator::Error`
  - `Images::Generators::Openai.call(prompt) { |file| ... } → ブロックの戻り値`。yield されるのは読み出し位置が先頭の File（Tempfile）で、ブロックを抜けると削除される

- [ ] **Step 1: webmock を Gemfile に足す**

`group :test do` の中、`shoulda-matchers` の下に置く。

```ruby
  # 外部APIの HTTP を spec で塞ぐ。画像生成API（issue 4-3）は SDK を使わず
  # Net::HTTP を直接叩くため、リクエストの組み立て（URL・ヘッダ・ボディ）そのものが
  # 検証対象になる。require するだけで全 spec が外部へ出なくなる安全網も同時に得る。
  gem "webmock"
```

```bash
docker compose exec backend bundle install
docker compose restart backend
```

- [ ] **Step 2: spec のサポートファイルを置く**

`spec/support/webmock.rb` を新規作成する（`rails_helper` が `spec/support/**/*.rb` を自動で読む）。

```ruby
# 外部への HTTP を全 spec で塞ぐ。require するだけで WebMock が Net::HTTP を
# 差し替え、スタブしていない通信は例外になる。
#
# spec/support/cloudinary.rb が Cloudinary SDK について用意しているのと同じ性質を、
# HTTP レベルで得る。素通りして偽のデータを返すより、うるさく失敗する方がよい。
require "webmock/rspec"
```

- [ ] **Step 3: 既存の spec が壊れていないことを確認する**

```bash
docker compose exec backend bundle exec rspec
```

Expected: PASS（Cloudinary は SDK レベルでスタブ済みなので HTTP には出ない）

- [ ] **Step 4: 失敗する spec を書く**

`spec/lib/images/generators/openai_spec.rb` を新規作成する。

```ruby
require "rails_helper"

RSpec.describe Images::Generators::Openai do
  let(:image) { "fake-webp-binary".b }
  let(:success_body) { { data: [ { b64_json: Base64.strict_encode64(image) } ] }.to_json }

  # ENV の差し替えは spec/lib/attempts/generation_spec.rb と同じ手を使う。
  before do
    allow(ENV).to receive(:fetch).and_call_original
    allow(ENV).to receive(:fetch).with("OPENAI_API_KEY").and_return("sk-test")
  end

  def stub_generation(status: 200, body: nil)
    stub_request(:post, "https://api.openai.com/v1/images/generations")
      .to_return(status: status, body: body, headers: { "Content-Type" => "application/json" })
  end

  describe ".call" do
    it "デコードした画像を、先頭から読める File として yield する" do
      stub_generation(body: success_body)

      read = nil
      described_class.call("空の絵") { |file| read = file.read }

      expect(read).to eq(image)
    end

    it "ブロックの戻り値をそのまま返す" do
      stub_generation(body: success_body)

      expect(described_class.call("空の絵") { "kotoe/test/generated/x" }).to eq("kotoe/test/generated/x")
    end

    # ジョブが ensure で後始末する責任を負わずに済むよう、ブロック形式で必ず消す。
    it "ブロックを抜けたら一時ファイルを消す" do
      stub_generation(body: success_body)

      path = described_class.call("空の絵", &:path)

      expect(File.exist?(path)).to be(false)
    end

    # 確定値。勝手に変えるとコストと出力品質が変わる（設計ドキュメント参照）。
    it "モデル・サイズ・品質・出力形式・圧縮率・moderation を指定して送る" do
      stub_generation(body: success_body)

      described_class.call("空の絵") { nil }

      expect(WebMock).to have_requested(:post, "https://api.openai.com/v1/images/generations")
        .with(
          headers: { "Authorization" => "Bearer sk-test", "Content-Type" => "application/json" },
          body: {
            model: "gpt-image-2",
            prompt: "空の絵",
            size: "1024x1024",
            quality: "low",
            output_format: "webp",
            output_compression: 90,
            moderation: "auto",
            n: 1
          }
        )
    end
  end
end
```

- [ ] **Step 5: 落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/lib/images/generators/openai_spec.rb
```

Expected: FAIL（`NameError: uninitialized constant Images::Generators`）

- [ ] **Step 6: 例外クラスを定義する**

`lib/images/generator.rb` を新規作成する。この時点では例外の型だけを置く（プロバイダの選択は Task 5）。

```ruby
module Images
  # 画像生成の入口。プロバイダの選択は Task 5 で足す。
  class Generator
    # 画像生成の失敗。code はそのまま attempts.failure_reason に入る。
    #
    # リトライの可否を「型」で表す。ジョブ側の if ではなく型で分けることで、
    # ActiveJob の宣言的なハンドラ（retry_on / discard_on）にそのまま乗る。
    class Error < StandardError
      attr_reader :code

      # message に外部APIのレスポンス本文を入れない。エラー本文に鍵や個人情報が
      # 混ざりうるため（Images::Uploader が元例外のクラス名だけを残しているのと
      # 同じ理由）。プロンプト（＝ユーザーの描写文）も出さない。
      def initialize(code, detail: nil)
        @code = code
        super([ code, detail ].compact.join(" "))
      end
    end

    # 時間を置けば直る。retry_on の対象。
    class TransientError < Error; end

    # 同じ入力なら必ずまた失敗する（ポリシー違反・キー不正・残高切れ）。
    # リトライしても実費が増えるだけなので discard_on の対象にする。
    class PermanentError < Error; end
  end
end
```

- [ ] **Step 7: Openai プロバイダを実装する（成功経路のみ）**

`lib/images/generators/openai.rb` を新規作成する。

```ruby
require "net/http"
require "base64"

module Images
  module Generators
    # OpenAI の画像生成API（POST /v1/images/generations）を叩き、生成された画像を
    # File として yield する。
    #
    # 公式 gem を使わないのは、Stainless 生成の SDK が全エンドポイントぶんのコードを
    # 読み込むため（本番の余裕は 37 MB しかない。docs/README.md の「Render 無料枠の
    # メモリ実測」参照）。使うのはこのエンドポイント 1 本だけ。
    class Openai
      ENDPOINT = URI("https://api.openai.com/v1/images/generations").freeze

      # 環境変数にしない。コストと出力品質を左右するプロダクトの判断なので、
      # 変更が PR として履歴に残るべきもの。
      MODEL = "gpt-image-2"
      SIZE = "1024x1024"
      QUALITY = "low"           # 1024x1024 で約 $0.006/枚
      OUTPUT_FORMAT = "webp"    # PNG だとピーク 5〜7 MB。WebP で 1〜2 MB に収まる
      OUTPUT_COMPRESSION = 90   # 将来のダウンロード導線を見据えて画質側に寄せた値
      MODERATION = "auto"       # 公開UGCなので緩めない

      OPEN_TIMEOUT = 10
      # 「複雑なプロンプトで最大2分」（公式ドキュメント）。短くすると、生成は済んで
      # 課金もされたのに待ちきれず、リトライで同じ1枠に二重課金することになる。
      READ_TIMEOUT = 150

      def self.call(prompt, &block) = new(prompt).call(&block)

      def initialize(prompt)
        @prompt = prompt
      end

      # @yieldparam [File] 読み出し位置が先頭の画像ファイル。ブロックを抜けると消える
      # @return [Object] ブロックの戻り値（ジョブは Cloudinary の public_id を受け取る）
      def call(&block)
        image = Base64.decode64(fetch_b64_image)

        # ディスクに落とすのは、デコード後のバイナリを、Cloudinary が multipart 本文を
        # 組み立てる前に Ruby のヒープから解放するため。ブロック形式なので消し忘れない。
        Tempfile.create([ "kotoe-generated", ".webp" ], binmode: true) do |file|
          file.write(image)
          file.rewind
          block.call(file)
        end
      end

      private

      def fetch_b64_image
        response = post_request

        raise_for_status(response) unless response.is_a?(Net::HTTPSuccess)

        # 応答の形が変わるのは向こう側の問題。KeyError で 500 にせず api_error に寄せる。
        JSON.parse(response.body).dig("data", 0, "b64_json") ||
          raise(Generator::PermanentError.new("api_error", detail: "no b64_json"))
      end

      def post_request
        http = Net::HTTP.new(ENDPOINT.host, ENDPOINT.port)
        http.use_ssl = true
        http.open_timeout = OPEN_TIMEOUT
        http.read_timeout = READ_TIMEOUT

        http.request(build_request)
      end

      def build_request
        # ローカル変数に置くのは、文字列補間の中でシングルクォートを使わずに済ませるため
        # （プロジェクトの規約はダブルクォート統一）。
        api_key = ENV.fetch("OPENAI_API_KEY")

        request = Net::HTTP::Post.new(ENDPOINT)
        request["Authorization"] = "Bearer #{api_key}"
        request["Content-Type"] = "application/json"
        request.body = JSON.generate(
          model: MODEL,
          prompt: @prompt,
          size: SIZE,
          quality: QUALITY,
          output_format: OUTPUT_FORMAT,
          output_compression: OUTPUT_COMPRESSION,
          moderation: MODERATION,
          n: 1
        )
        request
      end

      # 失敗の分類は Task 4 で実装する。
      def raise_for_status(response)
        raise Generator::PermanentError.new("api_error", detail: "status=#{response.code}")
      end
    end
  end
end
```

- [ ] **Step 8: 新しいディレクトリを作ったのでコンテナを再起動する**

`lib/images/generators/` は新しいディレクトリなので、Zeitwerk に拾わせるために再起動が要る。これをしないと rspec は green なのに実行時だけ `uninitialized constant` になる。

```bash
docker compose restart backend
```

- [ ] **Step 9: 通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/lib/images/generators/openai_spec.rb
```

Expected: PASS（4 examples）

- [ ] **Step 10: rubocop を通してコミット**

```bash
docker compose exec backend bundle exec rubocop
cd backend && git add Gemfile Gemfile.lock spec/support/webmock.rb lib/images/generator.rb lib/images/generators/openai.rb spec/lib/images/generators/openai_spec.rb
git commit -m "feat: OpenAI の画像生成APIを叩くクライアントを足す"
```

---

### Task 4: `Images::Generators::Openai` のエラー分類

HTTP の応答をリトライすべき例外／すべきでない例外に振り分ける。Task 3 の `raise_for_status` を本実装に差し替える。

**Files:**
- Modify: `backend/lib/images/generators/openai.rb`
- Test: `backend/spec/lib/images/generators/openai_spec.rb`

**Interfaces:**
- Consumes: `Images::Generator::TransientError` / `PermanentError`（Task 3）、`Images::Generators::Openai.call`（Task 3）
- Produces: 分類の対応表（下記 spec がそのまま仕様）

- [ ] **Step 1: 失敗する spec を書く**

`spec/lib/images/generators/openai_spec.rb` の末尾（`describe ".call"` の閉じ括弧の後、最後の `end` の前）に追記する。

```ruby
  describe "失敗の分類" do
    def call_and_capture
      described_class.call("空の絵") { nil }
      nil
    rescue Images::Generator::Error => e
      e
    end

    # 同じ描写文なら必ずまた弾かれるので、リトライしない。
    it "400 のポリシー違反は PermanentError の content_policy" do
      stub_generation(status: 400, body: { error: { code: "content_policy_violation" } }.to_json)

      error = call_and_capture

      expect(error).to be_a(Images::Generator::PermanentError)
      expect(error.code).to eq("content_policy")
    end

    it "400 の moderation_blocked も content_policy として扱う" do
      stub_generation(status: 400, body: { error: { code: "moderation_blocked" } }.to_json)

      expect(call_and_capture.code).to eq("content_policy")
    end

    # 実際の error.code / error.type の文字列は本番スモークで採取するまで確定できない。
    # 認識できない値は api_error に倒し、想定外のコードで落ちないようにする。
    it "400 の未知のコードは PermanentError の api_error" do
      stub_generation(status: 400, body: { error: { code: "something_new" } }.to_json)

      error = call_and_capture

      expect(error).to be_a(Images::Generator::PermanentError)
      expect(error.code).to eq("api_error")
    end

    it "401 は PermanentError の api_error（直さない限り永久に失敗する）" do
      stub_generation(status: 401, body: { error: { code: "invalid_api_key" } }.to_json)

      error = call_and_capture

      expect(error).to be_a(Images::Generator::PermanentError)
      expect(error.code).to eq("api_error")
    end

    it "429 のレート制限は TransientError の rate_limited" do
      stub_generation(status: 429, body: { error: { type: "requests" } }.to_json)

      error = call_and_capture

      expect(error).to be_a(Images::Generator::TransientError)
      expect(error.code).to eq("rate_limited")
    end

    # 前払いクレジットが尽きた状態。待っても直らないのでリトライしない。
    it "429 の insufficient_quota は PermanentError の api_error" do
      stub_generation(status: 429, body: { error: { type: "insufficient_quota" } }.to_json)

      error = call_and_capture

      expect(error).to be_a(Images::Generator::PermanentError)
      expect(error.code).to eq("api_error")
    end

    it "500 は TransientError の api_error" do
      stub_generation(status: 500, body: "")

      error = call_and_capture

      expect(error).to be_a(Images::Generator::TransientError)
      expect(error.code).to eq("api_error")
    end

    it "503 は TransientError の api_error" do
      stub_generation(status: 503, body: "")

      expect(call_and_capture).to be_a(Images::Generator::TransientError)
    end

    it "タイムアウトは TransientError の api_error" do
      stub_request(:post, "https://api.openai.com/v1/images/generations").to_timeout

      error = call_and_capture

      expect(error).to be_a(Images::Generator::TransientError)
      expect(error.code).to eq("api_error")
    end

    # プロキシの HTML エラーページなど、JSON でない本文が返ることがある。
    # 分類できないだけなので落とさず api_error に倒す。
    it "本文が JSON でなくても落ちずに分類する" do
      stub_generation(status: 400, body: "<html>Bad Request</html>")

      error = call_and_capture

      expect(error).to be_a(Images::Generator::PermanentError)
      expect(error.code).to eq("api_error")
    end

    it "200 でも b64_json が無ければ PermanentError の api_error" do
      stub_generation(body: { data: [] }.to_json)

      error = call_and_capture

      expect(error).to be_a(Images::Generator::PermanentError)
      expect(error.code).to eq("api_error")
    end

    # レスポンス本文には鍵や個人情報が混ざりうる。プロンプトはユーザーの描写文そのもの。
    it "例外メッセージにレスポンス本文とプロンプトを含めない" do
      stub_generation(status: 400, body: { error: { code: "x", message: "secret-detail" } }.to_json)

      expect(call_and_capture.message).not_to include("secret-detail")
      expect(call_and_capture.message).not_to include("空の絵")
    end
  end
```

- [ ] **Step 2: 落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/lib/images/generators/openai_spec.rb
```

Expected: FAIL（Task 3 の暫定実装は全部 `api_error` の PermanentError を返すため、content_policy / rate_limited / Transient 系と、タイムアウトが素通りするケースが落ちる）

- [ ] **Step 3: タイムアウトと接続断を TransientError に包む**

`lib/images/generators/openai.rb` の `post_request` に `rescue` を足す。

```ruby
      # 例外クラスは失敗の種類（接続・読み取り・SSL）で変わるので、呼び出し側が
      # 1 つ rescue すれば済むようここで一本化する。いずれも時間を置けば直りうる。
      def post_request
        http = Net::HTTP.new(ENDPOINT.host, ENDPOINT.port)
        http.use_ssl = true
        http.open_timeout = OPEN_TIMEOUT
        http.read_timeout = READ_TIMEOUT

        http.request(build_request)
      rescue Timeout::Error, IOError, SystemCallError, OpenSSL::SSL::SSLError => e
        raise Generator::TransientError.new("api_error", detail: e.class.name)
      end
```

- [ ] **Step 4: 分類のロジックを実装する**

`raise_for_status` の暫定実装を差し替え、下の private メソッド群を足す。

```ruby
      # 分類の根拠は設計ドキュメントの「エラーの分類」表。
      def raise_for_status(response)
        status = response.code.to_i

        raise build_error(status, extract_error(response))
      end

      def build_error(status, error)
        detail = "status=#{status}"

        return Generator::PermanentError.new("content_policy", detail: detail) if content_policy?(status, error)
        return Generator::PermanentError.new("api_error", detail: detail) if quota_exhausted?(status, error)
        return Generator::TransientError.new("rate_limited", detail: detail) if status == 429
        return Generator::TransientError.new("api_error", detail: detail) if status >= 500

        Generator::PermanentError.new("api_error", detail: detail)
      end

      def content_policy?(status, error)
        status == 400 && CONTENT_POLICY_CODES.include?(error["code"])
      end

      def quota_exhausted?(status, error)
        status == 429 && error["type"] == INSUFFICIENT_QUOTA
      end

      # 本文が JSON でない（プロキシの HTML エラーページ等）ことも、error が
      # ハッシュでないこともある。分類できないだけなので落とさず空として扱う。
      def extract_error(response)
        parsed = JSON.parse(response.body)
        error = parsed.is_a?(Hash) ? parsed["error"] : nil

        error.is_a?(Hash) ? error : {}
      rescue JSON::ParserError, TypeError
        {}
      end
```

定数を `MODERATION` の下に足す。

```ruby
      # 実際に返る文字列は本番スモークで採取して確定させる。認識できない値は
      # api_error に倒れるので、取りこぼしてもジョブは壊れない。
      CONTENT_POLICY_CODES = %w[content_policy_violation moderation_blocked].freeze
      INSUFFICIENT_QUOTA = "insufficient_quota"
```

- [ ] **Step 5: 通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/lib/images/generators/openai_spec.rb
```

Expected: PASS（16 examples）

- [ ] **Step 6: rubocop を通してコミット**

```bash
docker compose exec backend bundle exec rubocop
cd backend && git add lib/images/generators/openai.rb spec/lib/images/generators/openai_spec.rb
git commit -m "feat: 画像生成APIの失敗をリトライ可否で分類する"
```

---

### Task 5: `Images::Generators::Dummy` とプロバイダの選択

ローカル / CI / E2E が実費なしで回る経路を作り、`Images::Generator` に切り替えを持たせる。

**Files:**
- Create: `backend/lib/images/generators/dummy.rb`
- Modify: `backend/lib/images/generator.rb`
- Create: `backend/config/initializers/openai.rb`
- Test: `backend/spec/lib/images/generators/dummy_spec.rb`, `backend/spec/lib/images/generator_spec.rb`

**Interfaces:**
- Consumes: `Images::Generators::Openai.call`（Task 3）、`Images::Generator::Error` 階層（Task 3）
- Produces: `Images::Generator.call(prompt) { |file| ... } → ブロックの戻り値`、`Images::Generator.provider_name → String`、`Images::Generators::Dummy.call(prompt) { |file| ... }`

- [ ] **Step 1: Dummy の失敗する spec を書く**

`spec/lib/images/generators/dummy_spec.rb` を新規作成する。

```ruby
require "rails_helper"

RSpec.describe Images::Generators::Dummy do
  describe ".call" do
    it "ダミー画像を、先頭から読める File として yield する" do
      read = nil
      described_class.call("空の絵") { |file| read = file.read }

      expect(read).to eq(File.binread(described_class::IMAGE_PATH))
    end

    it "ブロックの戻り値をそのまま返す" do
      expect(described_class.call("空の絵") { "kotoe/test/generated/x" }).to eq("kotoe/test/generated/x")
    end

    it "プロンプトの内容にかかわらず同じ画像を返す" do
      first = described_class.call("赤", &:read)
      second = described_class.call("青", &:read)

      expect(first).to eq(second)
    end
  end
end
```

- [ ] **Step 2: 落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/lib/images/generators/dummy_spec.rb
```

Expected: FAIL（`NameError: uninitialized constant Images::Generators::Dummy`）

- [ ] **Step 3: Dummy を実装する**

`lib/images/generators/dummy.rb` を新規作成する。画像は 4-2 が置いた `lib/assets/dummy_generated.png` をそのまま使う。

```ruby
module Images
  module Generators
    # 実費のかからないダミー。ローカル / CI / E2E（8-1）はこちらで回る。
    #
    # 8-1 の E2E はコアループ（ログイン→描写→生成→比較）を回すため、実APIだと
    # テストのたびに課金され、生成に最大2分かかってテストが遅く不安定になる。
    #
    # 契約は Openai と同じ。「読み出し位置が先頭の File を yield し、ブロックの
    # 戻り値を返す」。ジョブから両者の区別がつかないことが、ローカルと本番で
    # 同じ経路を通すための条件になる。
    class Dummy
      # lib/assets は Zeitwerk の対象外（config.autoload_lib の ignore）。
      IMAGE_PATH = Rails.root.join("lib/assets/dummy_generated.png")

      def self.call(_prompt, &block) = File.open(IMAGE_PATH, "rb", &block)
    end
  end
end
```

- [ ] **Step 4: 通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/lib/images/generators/dummy_spec.rb
```

Expected: PASS

- [ ] **Step 5: `Images::Generator` の失敗する spec を書く**

`spec/lib/images/generator_spec.rb` を新規作成する。

```ruby
require "rails_helper"

RSpec.describe Images::Generator do
  def stub_provider_env(value)
    allow(ENV).to receive(:fetch).and_call_original
    allow(ENV).to receive(:fetch).with("KOTOE_IMAGE_PROVIDER").and_return(value)
  end

  describe ".provider_name" do
    # 実費を払うのは本番だけ。ローカル・CI・E2E はダミーで回る。
    it "既定は dummy（test 環境）" do
      expect(described_class.provider_name).to eq("dummy")
    end

    it "production の既定は openai" do
      allow(Rails).to receive(:env).and_return(ActiveSupport::StringInquirer.new("production"))

      expect(described_class.provider_name).to eq("openai")
    end

    # プロンプトを調整するときにローカルで本物を試せるようにしておく。
    it "KOTOE_IMAGE_PROVIDER で上書きできる" do
      stub_provider_env("openai")

      expect(described_class.provider_name).to eq("openai")
    end
  end

  describe ".call" do
    it "既定ではダミーに委譲する" do
      expect(described_class.call("空の絵", &:read)).to eq(File.binread(Images::Generators::Dummy::IMAGE_PATH))
    end

    it "openai を指定すると Openai に委譲する" do
      stub_provider_env("openai")
      allow(Images::Generators::Openai).to receive(:call).and_return("kotoe/test/generated/x")

      expect(described_class.call("空の絵")).to eq("kotoe/test/generated/x")
      expect(Images::Generators::Openai).to have_received(:call).with("空の絵")
    end

    # 設定ミスで黙ってダミーが本番に出ると、全ユーザーに同じ画像が配られて
    # しかも枠は消費される。気づけるように落とす。
    it "知らないプロバイダ名は起動時ではなく呼び出しで落とす" do
      stub_provider_env("midjourney")

      expect { described_class.call("空の絵") { nil } }.to raise_error(ArgumentError, /midjourney/)
    end
  end
end
```

- [ ] **Step 6: 落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/lib/images/generator_spec.rb
```

Expected: FAIL（`NoMethodError: undefined method 'provider_name'`）

- [ ] **Step 7: `Images::Generator` にプロバイダの選択を足す**

`lib/images/generator.rb` の `class Generator` の中、例外クラスの定義の**下**に足す。

```ruby
    PROVIDERS = {
      "openai" => Generators::Openai,
      "dummy" => Generators::Dummy
    }.freeze

    # 実費を払うのは本番だけ。8-1 の E2E は実APIだとテストのたびに課金され、
    # 生成に最大2分かかって遅く不安定になる。プロンプトを調整するときは
    # ローカルでも KOTOE_IMAGE_PROVIDER=openai に切り替えられる。
    def self.provider_name
      ENV.fetch("KOTOE_IMAGE_PROVIDER") { Rails.env.production? ? "openai" : "dummy" }
    end

    def self.provider
      PROVIDERS.fetch(provider_name) do
        raise ArgumentError, "KOTOE_IMAGE_PROVIDER が不正です: #{provider_name.inspect}"
      end
    end

    # プロバイダの切り替えを知っているのはここ 1 か所だけ。ジョブから見れば
    # 「プロンプトを渡すと画像ファイルが来る」だけになる。
    #
    # @yieldparam [File] 読み出し位置が先頭の画像ファイル
    # @return [Object] ブロックの戻り値
    def self.call(prompt, &block) = provider.call(prompt, &block)
```

- [ ] **Step 8: 通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/lib/images/generator_spec.rb spec/lib/images/generators
```

Expected: PASS

- [ ] **Step 9: 起動時チェックを足す**

`config/initializers/openai.rb` を新規作成する。

```ruby
# 画像生成APIのキー（issue 4-3）。api_secret と同じくサーバー側のみに置き、
# フロントには絶対に出さない。
#
# 設定漏れは起動時に落とす。黙って起動すると「デプロイは green なのに生成だけが
# 全部 failed になる」状態になり、しかも生成枠は戻らないのでユーザーが枠を溶かす。
# config/initializers/cloudinary.rb と同じ方針。
#
# 実APIを使う設定のときだけ見る（ローカル・CI はダミーなのでキーが要らない）。
#
# after_initialize を使うのは、autoload される定数（Images::Generator）を参照するため
# （config/initializers/cors.rb と同じ理由）。
Rails.application.config.after_initialize do
  if Images::Generator.provider_name == "openai" && ENV["OPENAI_API_KEY"].blank?
    raise "OPENAI_API_KEY が設定されていません。実APIを使わない場合は " \
          "KOTOE_IMAGE_PROVIDER=dummy を設定してください。"
  end
end
```

- [ ] **Step 10: アプリが起動することと全 spec が通ることを確認する**

```bash
docker compose restart backend
docker compose exec backend bundle exec rspec
curl -s localhost:3000/api/health
```

Expected: rspec は全件 PASS、health が `{"status":"ok",...}` を返す

- [ ] **Step 11: rubocop を通してコミット**

```bash
docker compose exec backend bundle exec rubocop
cd backend && git add lib/images/generator.rb lib/images/generators/dummy.rb config/initializers/openai.rb spec/lib/images/generator_spec.rb spec/lib/images/generators/dummy_spec.rb
git commit -m "feat: 画像生成のプロバイダを環境で切り替えられるようにする"
```

---

### Task 6: `GenerateImageJob` を本物の生成に差し替える

ダミー固定だったジョブを `Images::Generator` 経由にし、失敗を `failure_reason` 付きで落とす。

**Files:**
- Modify: `backend/app/jobs/generate_image_job.rb`
- Test: `backend/spec/jobs/generate_image_job_spec.rb`

**Interfaces:**
- Consumes: `Images::Prompt.call(description)`（Task 2）、`Images::Generator.call(prompt, &block)`（Task 5）、`Images::Generator::TransientError` / `PermanentError`（Task 3）、`Attempt#failure_reason`（Task 1）
- Produces: `GenerateImageJob.mark_failed(attempt_id, reason)`

- [ ] **Step 1: 失敗する spec を書く**

`spec/jobs/generate_image_job_spec.rb` の `describe "失敗の扱い"` の中に追記する。

```ruby
    # 同じ描写文なら必ずまた弾かれるので、リトライせずその場で終端にする。
    it "PermanentError はリトライせず failed にして理由を残す" do
      attempt = create(:attempt, :generating)
      allow(Images::Generator).to receive(:call)
        .and_raise(Images::Generator::PermanentError.new("content_policy"))

      expect { described_class.perform_now(attempt.id) }
        .not_to have_enqueued_job(described_class)

      attempt.reload
      expect(attempt.status).to eq("failed")
      expect(attempt.failure_reason).to eq("content_policy")
    end

    it "PermanentError の原因をログに残す" do
      attempt = create(:attempt, :generating)
      allow(Images::Generator).to receive(:call)
        .and_raise(Images::Generator::PermanentError.new("api_error", detail: "status=401"))
      allow(Rails.logger).to receive(:warn)

      described_class.perform_now(attempt.id)

      expect(Rails.logger).to have_received(:warn).with(/attempt_id=#{attempt.id}.*status=401/)
    end

    it "TransientError の 1 回目は failed にせずリトライする" do
      attempt = create(:attempt, :generating)
      allow(Images::Generator).to receive(:call)
        .and_raise(Images::Generator::TransientError.new("rate_limited"))

      expect { described_class.perform_now(attempt.id) }
        .to have_enqueued_job(described_class)
      expect(attempt.reload.status).to eq("generating")
    end

    # 回数を 2 にとどめるのはコストの理由。タイムアウトは「API が課金対象の生成を
    # 終えたのに待ちきれなかった」場合を含み、リトライすると同じ1枠に二重課金になる。
    it "TransientError を使い切ると failed になり理由が残る" do
      attempt = create(:attempt, :generating)
      allow(Images::Generator).to receive(:call)
        .and_raise(Images::Generator::TransientError.new("rate_limited"))

      perform_enqueued_jobs { described_class.perform_later(attempt.id) }

      attempt.reload
      expect(attempt.status).to eq("failed")
      expect(attempt.failure_reason).to eq("rate_limited")
    end

    it "UploadError を使い切ると failure_reason は upload_failed" do
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call).and_raise(Images::Uploader::UploadError)

      perform_enqueued_jobs { described_class.perform_later(attempt.id) }

      expect(attempt.reload.failure_reason).to eq("upload_failed")
    end

    it "想定外の例外の failure_reason は internal_error" do
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call).and_raise(ArgumentError, "boom")

      expect { described_class.perform_now(attempt.id) }.to raise_error(ArgumentError)
      expect(attempt.reload.failure_reason).to eq("internal_error")
    end
```

`describe "#perform"` の中にも追記する。

```ruby
    it "描写文から組み立てたプロンプトで生成する" do
      attempt = create(:attempt, :generating, description: "夕暮れの交差点")
      allow(Images::Generator).to receive(:call).and_return("kotoe/test/generated/x")

      described_class.perform_now(attempt.id)

      expect(Images::Generator).to have_received(:call).with(Images::Prompt.call("夕暮れの交差点"))
    end
```

- [ ] **Step 2: 落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/jobs/generate_image_job_spec.rb
```

Expected: FAIL（`Images::Generator` を呼んでいない／`failure_reason` が nil のまま）

- [ ] **Step 3: ジョブを書き換える**

`app/jobs/generate_image_job.rb` を丸ごと下記に差し替える。`DUMMY_IMAGE_PATH` と `upload_dummy_image` は `Images::Generators::Dummy` に移ったので消す。

```ruby
# 挑戦の再現画像を作るジョブ。画像の出どころは Images::Generator が決める
# （本番は OpenAI、ローカル・CI・E2E はダミー）。ここは配線と、失敗を終端状態に
# 落とすことだけを担当する。
class GenerateImageJob < ApplicationJob
  queue_as :default

  # 宣言順に意味がある。ActiveJob はハンドラを後勝ちで探す（rescue_handlers を
  # 逆順に走査する）ため、rescue_from(StandardError) を先に、retry_on / discard_on を
  # 後に書く。逆にすると個別の例外もすべて StandardError 側に吸われる。
  #
  # コードのバグ：failed にしてから再送出する。ユーザーは失敗を見られ、開発者は
  # solid_queue_failed_executions にエラーが残る。握りつぶすと attempt が永久に
  # generating のまま残り、フロントが延々ポーリングする。
  rescue_from(StandardError) do |error|
    self.class.mark_failed(arguments.first, "internal_error")
    raise error
  end

  # 同じ入力なら必ずまた失敗する（ポリシー違反・キー不正・残高切れ）。リトライしても
  # 実費が増えるだけなので捨てる。ジョブ自体は失敗扱いにしない（外部サービスの都合や
  # ユーザーの入力はコードのバグではない）ので、原因はログにだけ残す。
  discard_on Images::Generator::PermanentError do |job, error|
    Rails.logger.warn(
      "[GenerateImageJob] 画像生成に失敗しました（再試行しません） " \
      "attempt_id=#{job.arguments.first} error=#{error.message}"
    )
    mark_failed(job.arguments.first, error.code)
  end

  # 時間を置けば直る失敗。回数を 2 にとどめるのはコストの理由で、タイムアウトは
  # 「API が課金対象の生成を終えたのに、こちらが待ちきれなかった」場合を含むため、
  # リトライすると同じ1枠に二重課金になる。
  retry_on Images::Generator::TransientError, wait: :polynomially_longer, attempts: 2 do |job, error|
    Rails.logger.warn(
      "[GenerateImageJob] 画像生成に失敗しました（再試行を使い切りました） " \
      "attempt_id=#{job.arguments.first} error=#{error.message}"
    )
    mark_failed(job.arguments.first, error.code)
  end

  # Cloudinary の一時障害：3 回まで待って試す（失敗しても実費が出ないため生成側より多い）。
  # 使い切ったら failed にするが、ジョブ自体は失敗扱いにしない。
  # Images::Uploader は StandardError をすべて UploadError に包むため、ここには一時障害
  # だけでなく本番の CLOUDINARY_URL の設定漏れのような「直さない限り永久に失敗し続ける」
  # 障害も来る。solid_queue_failed_executions に残らないので、このログが唯一の手がかりになる。
  # message には元例外のクラス名しか入らない（Uploader が秘密情報を落としている）。
  retry_on Images::Uploader::UploadError, wait: :polynomially_longer, attempts: 3 do |job, error|
    Rails.logger.warn(
      "[GenerateImageJob] Cloudinary へのアップロードに失敗しました " \
      "attempt_id=#{job.arguments.first} error=#{error.message}"
    )
    mark_failed(job.arguments.first, "upload_failed")
  end

  # 生成枠は戻さない（生成はジョブ enqueue 時に消費する。ドメイン規則）ので
  # generated_at には触れない。kept で絞らないのは、生成中に削除された attempt も
  # 終端状態にしておくため（generating のまま残すと状態機械が壊れる）。
  def self.mark_failed(attempt_id, reason)
    Attempt.generating.find_by(id: attempt_id)&.update!(status: :failed, failure_reason: reason)
  end

  def perform(attempt_id)
    # 冪等性はこの1行で担保する。generating の attempt しか掴まないので、
    # 生成中に削除された場合も、ジョブが二重に走った場合も、黙って何もせず終わる。
    attempt = Attempt.kept.generating.find_by(id: attempt_id)
    return if attempt.nil?

    public_id = Images::Generator.call(Images::Prompt.call(attempt.description)) do |file|
      Images::Uploader.call(file, kind: :generated)
    end

    # 生成が成功したら即公開（結果を見てから公開を選ぶ導線は作らない）。
    attempt.update!(generated_image_public_id: public_id, status: :published)
  end
end
```

- [ ] **Step 4: 通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/jobs/generate_image_job_spec.rb
```

Expected: PASS（4-2 から引き継いだ既存の example も含めて全件）

- [ ] **Step 5: rubocop を通してコミット**

```bash
docker compose exec backend bundle exec rubocop
cd backend && git add app/jobs/generate_image_job.rb spec/jobs/generate_image_job_spec.rb
git commit -m "feat: 生成ジョブを本物の画像生成APIにつなぐ"
```

---

### Task 7: キルスイッチとサービス全体の1日上限

コストの上限を、生成枠を消費する前（enqueue する前）に効かせる。

**Files:**
- Modify: `backend/lib/attempts/generation.rb`
- Modify: `backend/app/controllers/api/attempts_controller.rb`
- Test: `backend/spec/lib/attempts/generation_spec.rb`, `backend/spec/requests/api/attempts_spec.rb`

**Interfaces:**
- Consumes: `Attempts::Generation::Result`（既存。`error_code` / `limit`）
- Produces: `Attempts::Generation.enabled? → Boolean`、`Attempts::Generation.service_daily_limit → Integer`、エラーコード `generation_disabled` / `service_generation_limit_reached`

- [ ] **Step 1: 失敗する spec を書く**

`spec/lib/attempts/generation_spec.rb` の `describe "1日の上限"` の**後ろ**に追記する。

```ruby
  # 4-2 が 4-3 に送った宿題。実費が発生するのはここからなので、コストの上限をここで持つ。
  describe "キルスイッチ" do
    def stub_enabled_env(value)
      allow(ENV).to receive(:fetch).and_call_original
      allow(ENV).to receive(:fetch).with("KOTOE_GENERATION_ENABLED", "true").and_return(value)
    end

    it "既定では有効" do
      expect(described_class).to be_enabled
    end

    it "false で止まり、ジョブも積まれず枠も減らない" do
      stub_enabled_env("false")

      result = nil
      expect { result = described_class.call(attempt) }
        .not_to have_enqueued_job(GenerateImageJob)

      expect(result.error_code).to eq("generation_disabled")
      attempt.reload
      expect(attempt.status).to eq("draft")
      expect(attempt.generated_at).to be_nil
    end

    it "0 と off でも止まる" do
      stub_enabled_env("0")
      expect(described_class).not_to be_enabled

      stub_enabled_env("off")
      expect(described_class).not_to be_enabled
    end

    # ダッシュボードで値を空にしただけで全ユーザーの生成が止まると、原因が分からない。
    it "空文字は既定（有効）に落とす" do
      stub_enabled_env("")

      expect(described_class).to be_enabled
    end
  end

  describe "サービス全体の1日上限" do
    def stub_service_limit_env(value)
      allow(ENV).to receive(:fetch).and_call_original
      allow(ENV).to receive(:fetch).with("KOTOE_SERVICE_DAILY_GENERATION_LIMIT", 50).and_return(value)
    end

    it "既定は 50 枚" do
      expect(described_class.service_daily_limit).to eq(50)
    end

    # 個人上限（3回）だけでは、利用者が増えると総額が青天井になる。
    it "全体で上限に達すると service_generation_limit_reached を返す" do
      stub_service_limit_env("2")
      create_list(:attempt, 2, status: "published", generated_at: Time.current)

      result = nil
      expect { result = described_class.call(attempt) }
        .not_to have_enqueued_job(GenerateImageJob)

      expect(result.error_code).to eq("service_generation_limit_reached")
      expect(attempt.reload.generated_at).to be_nil
    end

    # 個人上限と違って、他人の生成も数に入るのがこのガードの目的。
    it "他人の生成も数に入る" do
      stub_service_limit_env("1")
      create(:attempt, user: create(:user), status: "published", generated_at: Time.current)

      expect(described_class.call(attempt).error_code).to eq("service_generation_limit_reached")
    end

    it "上限の 1 つ手前なら通る" do
      stub_service_limit_env("2")
      create(:attempt, status: "published", generated_at: Time.current)

      expect(described_class.call(attempt)).to be_ok
    end

    it "空文字や数値でない値は既定値に落とす" do
      stub_service_limit_env("")
      expect(described_class.service_daily_limit).to eq(50)

      stub_service_limit_env("abc")
      expect(described_class.service_daily_limit).to eq(50)

      stub_service_limit_env("0")
      expect(described_class.service_daily_limit).to eq(50)
    end
  end
```

- [ ] **Step 2: 落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/lib/attempts/generation_spec.rb
```

Expected: FAIL（`NoMethodError: undefined method 'enabled?'`）

- [ ] **Step 3: `Attempts::Generation` にガードを足す**

`DEFAULT_DAILY_LIMIT` の下に定数を足す。

```ruby
    SERVICE_DEFAULT_DAILY_LIMIT = 50
```

`self.daily_limit` の下にクラスメソッドを2つ足す。

```ruby
    # サービス全体のキルスイッチ。暴走や不正利用に気づいたとき、コードを触らず
    # Render の環境変数だけで即止められるようにする。
    #
    # 「明示的に false のときだけ止める」形にする。ダッシュボードで値を空にした
    # だけで全ユーザーの生成が止まると、原因の切り分けができない（daily_limit と同じ考え方）。
    def self.enabled?
      ActiveModel::Type::Boolean.new.cast(ENV.fetch("KOTOE_GENERATION_ENABLED", "true")) != false
    end

    # サービス全体の1日上限。Kotoe は誰でも登録できるため、個人の上限（3回）だけでは
    # 利用者が増えると総額が青天井になる。50 枚/日 で月額の最悪値が約 $16.5 に収まる
    # （前払いクレジット $20 より下なので、常にこちらの穏やかなガードが先に効く）。
    def self.service_daily_limit
      configured = ENV.fetch("KOTOE_SERVICE_DAILY_GENERATION_LIMIT", SERVICE_DEFAULT_DAILY_LIMIT).to_i

      configured.positive? ? configured : SERVICE_DEFAULT_DAILY_LIMIT
    end
```

`call` の先頭に1行足す。

```ruby
    def call
      return Result.new(error_code: "generation_disabled", limit: nil) unless self.class.enabled?

      # DB を書かない判定なのでロックの外で済ませる。
      return Result.new(error_code: "attempt_not_draft", limit: nil) unless @attempt.draft?

      @attempt.user.with_lock { start_generation }
    end
```

`start_generation` の、draft の再確認と個人上限の判定のあいだに足す。

```ruby
      service_limit = self.class.service_daily_limit
      if service_used_today >= service_limit
        return Result.new(error_code: "service_generation_limit_reached", limit: nil)
      end
```

`used_today` の下に private メソッドを足す。

```ruby
    # サービス全体の1日の生成枚数。ユーザー行のロックはユーザー間を直列化しないので
    # 同時実行で数枚オーバーしうるが、桁が守れれば目的（コストの上限）は果たせる。
    #
    # 既存インデックス（user_id, generated_at）には乗らないが、1日に数十回しか走らず
    # テーブルは月450行しか増えないので専用インデックスは張らない
    # （必要になれば issue 3-4 で計測して判断する）。
    def service_used_today
      Attempt.where(generated_at: Time.zone.now.all_day).count
    end
```

- [ ] **Step 4: 通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/lib/attempts/generation_spec.rb
```

Expected: PASS

- [ ] **Step 5: 失敗する request spec を書く**

`spec/requests/api/attempts_spec.rb` の `describe "POST /api/attempts/:id/generate"` の中、上限のテストの後ろに追記する。

```ruby
    # 「誰の問題か」でステータスを分ける。422 はユーザーが訂正できるもの、
    # 503 はこちら側の都合。フロントは前者を訂正可能なエラー、後者を
    # 時間を置いて再訪する案内として出し分ける。
    it "キルスイッチが off なら 503" do
      allow(Attempts::Generation).to receive(:enabled?).and_return(false)

      post "/api/attempts/#{attempt.id}/generate", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:service_unavailable)
      expect(response.parsed_body).to eq("error" => "generation_disabled")
      expect(attempt.reload.status).to eq("draft")
    end

    it "サービス全体の上限に達すると 503 と回復時刻を返す" do
      allow(Attempts::Generation).to receive(:service_daily_limit).and_return(1)

      travel_to(Time.zone.local(2026, 8, 2, 12, 0, 0)) do
        create(:attempt, user: create(:user), status: "published", generated_at: Time.current)

        post "/api/attempts/#{attempt.id}/generate", headers: auth_headers(token), as: :json

        expect(response).to have_http_status(:service_unavailable)
        expect(response.parsed_body).to eq(
          "error" => "service_generation_limit_reached",
          "resets_at" => "2026-08-02T15:00:00Z"
        )
      end
    end
```

- [ ] **Step 6: 落ちることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/attempts_spec.rb
```

Expected: FAIL（422 が返る）

- [ ] **Step 7: コントローラでステータスを振り分ける**

`app/controllers/api/attempts_controller.rb` の `render_generation_error` を差し替える。

```ruby
    # エラーコードを HTTP に翻訳する。判定は Attempts::Generation が済ませている。
    #
    # 422 は「あなたの操作の問題」（訂正できる）、503 は「こちら側の都合」
    # （キルスイッチ・サービス全体の上限）。文言そのものは返さない（i18n はフロント）。
    #
    # 全体の上限では limit を返さない。サービスの容量は内部の事情で、ユーザーが
    # 行動を変えられる情報ではないため。
    def render_generation_error(result)
      case result.error_code
      when "generation_disabled"
        render json: { error: result.error_code }, status: :service_unavailable
      when "service_generation_limit_reached"
        render json: { error: result.error_code, resets_at: next_reset_at }, status: :service_unavailable
      when "generation_limit_reached"
        render_error(result.error_code, limit: result.limit, resets_at: next_reset_at)
      else
        render_error(result.error_code)
      end
    end
```

- [ ] **Step 8: 通ることを確認する**

```bash
docker compose exec backend bundle exec rspec
```

Expected: 全件 PASS

- [ ] **Step 9: rubocop を通してコミット**

```bash
docker compose exec backend bundle exec rubocop
cd backend && git add lib/attempts/generation.rb app/controllers/api/attempts_controller.rb spec/lib/attempts/generation_spec.rb spec/requests/api/attempts_spec.rb
git commit -m "feat: 生成のキルスイッチとサービス全体の1日上限を足す"
```

---

### Task 8: ドキュメントの更新

設計中に判明した既存ドキュメントの誤りの訂正を含む。

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/deployment.md`
- Modify: `docs/screen_and_api_design.md`
- Modify: `docs/issues_backlog.md`

**Interfaces:**
- Consumes: Task 1〜7 で確定した環境変数名・エラーコード・定数

- [ ] **Step 1: `docs/README.md` の「画像生成 API の選定（重要）」を決定内容に更新する**

候補の比較表の下に、決定した内容を足す。単価は 2026-08-04 時点の 1024×1024 の値。

```markdown
### 決定（issue 4-3・2026-08-04）

**`gpt-image-2` / `quality: low` / `1024x1024` / `output_format: webp` / `output_compression: 90`。**

`gpt-image-1` は 2026-10-23 に停止するため対象外。gpt-image-2 の low は $0.006/枚で、
最安の gpt-image-1-mini の low（$0.005）とほぼ同額である。Kotoe の面白さは
「描写文にどれだけ忠実に再現されるか」なので、プロンプト追従性は商品価値そのもの。
描写文（最大1,000文字）のテキスト入力を含めて **1枚あたり約 $0.011**、
想定 5 人 × 3 回/日 × 30 日 ＝ 450 枚/月 で **約 $5/月**。

モデル・品質・出力形式・圧縮率は環境変数にせず定数（`Images::Generators::Openai`）で持つ。
コストと出力品質を左右する判断なので、変更が PR として履歴に残るべきものだから。
```

- [ ] **Step 2: `docs/README.md` のメモリ削減候補の誤りを訂正する**

「Render 無料枠のメモリ実測」の削減候補にある次の行を探す。

```markdown
- 画像データをメモリに載せず Cloudinary へ渡す（生成 API が URL を返すなら、その URL を
  Cloudinary に取り込ませる経路が使える）
```

これを次に置き換える。

```markdown
- ~~画像データをメモリに載せず Cloudinary へ渡す（生成 API が URL を返すなら、その URL を
  Cloudinary に取り込ませる経路が使える）~~
  → **成立しない**（issue 4-3 で判明）。gpt-image 系は **base64（`b64_json`）でしか
  画像を返さず**、URL 受け取りに対応していない。画像は必ず Ruby のヒープを通る。
  代わりに **`output_format: webp` / `output_compression: 90`** でデータ量そのものを
  1/5 に落とし、瞬間ピークを 5〜7 MB から 1〜2 MB にした
```

- [ ] **Step 3: `docs/README.md` の無料枠の節に Cloudinary のクレジットの数え方を足す**

「Render 無料枠のメモリ実測」の節の後ろに足す。

```markdown
### Cloudinary の無料枠の数え方（issue 4-3 で調査・2026-08-04 時点）

25 クレジット/月。**1 クレジット ＝ 変換1,000回 ＝ ストレージ1GB ＝ 帯域1GB** で、
3つの用途に好きな配分で使える。

- **変換は「派生アセットが初めて作られたとき」に1回だけ**数えられる。同じ変換URLへの
  2回目以降のアクセスは加算されない（CDN から配信される）
- 変換と帯域は毎月リセットされるが、**ストレージだけは在庫で積み上がる**

450枚/月・12ヶ月時点の試算（1枚を10回閲覧と仮定）：

| | WebP(90) 0.3 MB/枚 | PNG 1.5 MB/枚 |
|---|---|---|
| ストレージ（累積 1.6 GB / 8.1 GB） | 1.6 | 8.1 |
| 帯域 | 1.35 | 6.75 |
| ダウンロード用 `f_png` 変換 | 0.45 | 0（不要） |
| **合計（クレジット/月）** | **約 3.4 / 25** | **約 15 / 25** |

**「PNG で保存して変換を避ければ安い」は成り立たない。** 一覧のサムネイルや比較ビューでは
どちらの保存形式でも変換を使うため、変換の発生は形式に依存しない。枠を先に食うのは
変換ではなくストレージと帯域である。
```

- [ ] **Step 4: `docs/deployment.md` の Render の環境変数の表に4行足す**

`SOLID_QUEUE_IN_PUMA` の行の下に足す。

```markdown
| `OPENAI_API_KEY` | **手入力** | 画像生成 API のキー。**サーバー専用**。`KOTOE_IMAGE_PROVIDER=openai` のとき未設定だと boot で raise する |
| `KOTOE_IMAGE_PROVIDER` | **手入力** | `openai`。未設定でも production の既定は `openai` だが、明示しておく |
| `KOTOE_GENERATION_ENABLED` | 任意 | 既定 `true`。`false` / `0` / `off` で生成を全停止（キルスイッチ） |
| `KOTOE_SERVICE_DAILY_GENERATION_LIMIT` | 任意 | 既定 `50`。サービス全体の1日の生成枚数 |
```

- [ ] **Step 5: `docs/deployment.md` に OpenAI の節を足す**

> **⚠️ 実行後に訂正済み。** 下の文面にある「OpenAI の monthly budget は遮断ではなく通知」は
> **不正確**だった。実際には **Spend alert（通知のみ）と Hard spend limit（`Enforce a hard
> limit` を ON にすると 429 で遮断）の2種類**がある。実物の設定画面を見て判明した。
> 最終的に書かれた内容は `docs/deployment.md` と設計ドキュメントを参照すること。
> 以下は当時の計画の記録としてそのまま残す。

「Cloudinary（画像の保存先）」の節の後ろに足す。

```markdown
### OpenAI（画像生成）

1. platform.openai.com の Project で API キーを発行し、Render の kotoe-api →
   Environment に `OPENAI_API_KEY` として貼る
2. **前払いクレジットを $20 購入し、オートリチャージを off にする**
3. 予算アラートを **$5**（80% / 95% 通知）に設定する

**⚠️ OpenAI の monthly budget は遮断ではなく通知である**（2026年時点）。上限に達しても
メールとダッシュボードのバナーが出るだけで、キーは動き続け課金も積み上がる。
**唯一の本当のハードストップは「前払いクレジット＋オートリチャージ off」**。

コストガードは3層で、**穏やかなガードが先に効くように値を決めてある**。

| 層 | 値 | 効いたときに起きること |
|---|---|---|
| アプリ側の1日上限 | 50 枚/日 | `generate` が **503 で即座に断られる**。ジョブは積まれず、**生成枠も消費されない** |
| 予算アラート | $5 | メール通知のみ。遮断しない |
| 前払いクレジット | $20・オートリチャージ off | ジョブは走り、API が 429 を返し、attempt が **failed** になる。枠は戻らない |

前払いを 50枚/日 の月額最悪値（$16.5）**より上**に置くのが要点。下に置くと、アプリ側の
穏やかなガードに達する前に残高が尽き、乱暴なほうの失敗が先に起きる。

**生成を緊急停止したいとき**は `KOTOE_GENERATION_ENABLED=false` を設定する。
デプロイは不要で、環境変数の変更による再起動だけで効く。
```

- [ ] **Step 6: `docs/screen_and_api_design.md` の挑戦 API を更新する**

「実装は issue 4-2。確定した挙動：」の箇条書きのうち、`generation_limit_reached` の
JSON ブロックの**直後**（`- GET /api/attempts/:id は …` の行の前）に2項目を挿入する。

```markdown
- サービス全体でも **1日 50 枚**の上限を持つ（`KOTOE_SERVICE_DAILY_GENERATION_LIMIT`
  で上書き可、issue 4-3）。到達すると **503**。個人の上限（422）と分けているのは、
  422 が「あなたの操作の問題」、503 が「こちら側の都合」だから。

  ```json
  { "error": "service_generation_limit_reached", "resets_at": "2026-08-02T15:00:00Z" }
  ```

  `KOTOE_GENERATION_ENABLED=false`（キルスイッチ）のときも **503** で
  `{ "error": "generation_disabled" }` を返す。どちらもジョブを積まず、**生成枠も消費しない**。
- 失敗した挑戦は `failure_reason` を持つ（issue 4-3）。値は `content_policy` /
  `rate_limited` / `api_error` / `upload_failed` / `internal_error` のいずれかで、
  `failed` 以外は `null`。文言は返さず、フロントの辞書で翻訳する。
```

あわせて、既存の「状態は `draft → generating → published` …」の項に、生成が本物の
画像生成API（gpt-image-2）になったことを一言足す。

```markdown
- 生成画像は **WebP** で Cloudinary に保存する（issue 4-3）。**ダウンロードURLには必ず
  `f_png` / `f_jpg` と `fl_attachment` を付ける**こと。
```

- [ ] **Step 7: `docs/issues_backlog.md` の 4-3 を更新する**

チェックボックスを埋め、決定内容と 7-3 への申し送りを足す。

```markdown
### 🟢 4-3. 画像生成APIの本接続
- 目的：ダミーを本物の画像生成に差し替える。
- 依存：4-2
- タスク：
  - [x] 画像生成API（gpt-image-2 / low / WebP90）クライアント実装（**APIキーはサーバー側のみ**）
        → 公式 gem を使わず Net::HTTP。理由は
        `docs/superpowers/specs/2026-08-04-issue-4-3-image-generation-design.md`
  - [x] `GenerateImageJob` をダミー→本APIに差し替え、失敗時 status: failed
        → プロバイダは `KOTOE_IMAGE_PROVIDER` で切替。ローカル・CI・E2E はダミー
  - [x] エラー/リトライ、コスト観点の最小ガード
        → リトライの可否を例外の型で表す（生成 2 回・Cloudinary 3 回）。
        失敗の理由は `attempts.failure_reason` で返す。
        コストガードは「アプリ 50枚/日 → 予算アラート $5 → 前払い $20」の3層
  - [ ] **本番スモーク**：実キーでの疎通、`memory.peak` の実測、実エラー文字列の採取、
        キルスイッチの動作確認
- 完了条件：実際の描写文から画像が生成され published になる。失敗時は failed になり再試行できる。
- **7-3 への申し送り**：生成画像は WebP で保存しているため、**ダウンロードURLには必ず
  `f_png` / `f_jpg` と `fl_attachment` を付ける**。保存URLをそのまま `download` 属性に
  渡すと `.webp` が落ち、macOS の Preview で開けない環境がある。
```

- [ ] **Step 8: コミット**

```bash
git add docs/README.md docs/deployment.md docs/screen_and_api_design.md docs/issues_backlog.md
git commit -m "docs: issue 4-3 の決定内容を反映し、URL取り込み案の誤りを訂正する"
```

---

## 最終確認とプッシュ

- [ ] **Step 1: 全 spec と rubocop を通す**

```bash
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec rubocop
docker compose exec backend bundle exec brakeman
```

Expected: すべて green

- [ ] **Step 2: アプリが実際に起動して生成が通ることを手で確認する**

```bash
docker compose restart backend
curl -s localhost:3000/api/health
```

ブラウザまたは curl で「下書き作成 → generate → GET でポーリング」を1往復し、
`status` が `generating` → `published` に変わり `generated_image_public_id` が入ることを見る
（ローカルはダミープロバイダなので実費は出ない）。

- [ ] **Step 3: プッシュして PR を作る**

```bash
git push -u origin feature/issue-4-3
```

PR の本文には次を書く。

- 何を実装したか（ダミー → gpt-image-2、コストガード、`failure_reason`）
- **依存追加**：`webmock`（`group :test` のみ・本番のメモリに影響しない）と、その理由
- **既存ドキュメントの訂正**（README の URL 取り込み案が成立しないこと、ほか）
- **マージ後に本番スモークが必要**であること（下記）

> **⚠️ 実行後の訂正。** ここに「OpenAI の monthly budget が遮断ではなく通知」と書いていたが
> **不正確**だった（Step 5 の注記を参照）。コストガードも 3 層ではなく **4 層**
> （アプリ 50枚/日 → Spend alert $5 → Hard spend limit $20 → 前払い $20）になった。

## マージ後の本番スモーク（手作業）

コードではなくダッシュボード操作を含むため、PR とは別に実施する。

- [ ] Render に `OPENAI_API_KEY` と `KOTOE_IMAGE_PROVIDER=openai` を設定する
- [ ] OpenAI で前払いクレジット $20 を購入し、**オートリチャージを off**、予算アラートを $5（80% / 95%）に設定する
- [ ] 本番URLで generate を叩き、`published` になること、Cloudinary の `kotoe/production/generated` に WebP が上がることを確認する
- [ ] `GET /api/health` の `memory.peak` を **生成前 / 1回後 / 2回後** で記録する（4-2 の 475 MB からの増分。危なければ `config/queue.yml` の `workers.threads` を下げる）
- [ ] **ポリシー違反を意図的に起こし、実際の `error.code` / `error.type` の文字列を採取して `Images::Generators::Openai::CONTENT_POLICY_CODES` と spec に反映する**（設計時点では推測でしかない箇所）
- [ ] `KOTOE_GENERATION_ENABLED=false` にして 503 が返ることを確認し、`true` に戻す
- [ ] スモークデータの後始末（8-2a から持ち越しているぶんも含めて）
- [ ] 実測値を `docs/README.md` の無料枠の節に追記する（別 PR）
