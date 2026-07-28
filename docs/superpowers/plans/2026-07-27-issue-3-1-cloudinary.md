# issue 3-1 Cloudinary 画像アップロード基盤 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** サーバー側から Cloudinary へ画像をアップロードし public_id を得る基盤（検証 PORO ＋ アップロード PORO）を作り、本番の Cloudinary キーが通ることを確認する。

**Architecture:** 責務を 2 つの PORO に分ける。`Images::Validation` はユーザーが上げたファイルの受け入れ判定（5MB / 形式）だけを行い、Cloudinary もネットワークも知らない。`Images::Uploader` は Cloudinary へ上げて public_id を返すだけで、検証を知らない。利用者が違う（お題投稿は検証あり、issue 4-2 の生成画像は検証なし）ため、合成は呼び出し側が行う。HTTP エンドポイントはこの issue では作らない（issue 3-2 の `POST /api/posts` が最初の利用者）。例外として、本番疎通のためだけの一時ルートを 1 本置き、確認後に削除 PR で消す。

**Tech Stack:** Ruby on Rails 8.1（API モード） / cloudinary gem 2.4 / marcel 1.2.1（activestorage 経由、既に `Gemfile.lock` にある） / RSpec 8 / FactoryBot

**設計ドキュメント:** `docs/superpowers/specs/2026-07-27-issue-3-1-cloudinary-design.md`

**ブランチ:** `feature/issue-3-1`（作成済み。設計ドキュメントのコミット `a42f6d0` が載っている）

## 実装時にこの計画から変えたこと

1. **env ファイルを分割した（Task 1 Step 5 は stale）。** 計画では `CLOUDINARY_URL` をルートの
   `.env.example` に足すとしていたが、実装では `backend/.env.example` を新設し、
   `JWT_SECRET_KEY` ごと backend 配下へ移した。`docker-compose.yml` に issue 0-1 の時点で
   書かれていた「Rails 専用の秘密は backend/.env.development に分ける（issue 3-1 で追加）」
   という予告コメントを実装したもの。db / frontend コンテナに秘密が渡らなくなる。
2. **コードレビューの指摘を別 PR で反映した。** 詳細と検証根拠は
   `docs/superpowers/plans/2026-07-27-issue-3-1-review-fixes.md`。

## Global Constraints

- 文字列は**ダブルクォート**。spec ファイルも含めプロジェクト全体で統一（`.rubocop.yml` の `Style/StringLiterals`）。
- コミット前に `bundle exec rubocop` と `bundle exec rspec` を通す。
- **物理削除しない**。この issue では DB を触らないため該当なし。
- **API キー・秘密情報をログ・URL・フロントに出さない。** `CLOUDINARY_URL` は API secret を含むためサーバー側のみ。例外メッセージにも元例外の `message` を含めない（キーが混ざりうる）。
- バックは**エラーコード**を返し、日本語の文言を持たない（i18n はフロントに集約）。
- 受け入れ上限は **5MB**、許可形式は **JPEG / PNG / WebP / HEIC / HEIF**。
- Cloudinary の保存先は **`kotoe/#{Rails.env}/<フォルダ名>`**（ローカルと本番で同じアカウントを共用するため、環境名をパスに含める）。
- コマンドはすべて `docker compose exec backend ...` 経由で実行する（リポジトリ直下から）。
- **main へ直接コミットしない。** 作業は `feature/issue-3-1` 上で行う。

## File Structure

| ファイル | 責務 |
|---|---|
| `backend/Gemfile` | `cloudinary` gem の宣言 |
| `backend/config/initializers/cloudinary.rb` | `CLOUDINARY_URL` 未設定を本番のみ起動時に落とす |
| `backend/lib/images/validation.rb` | 受け入れ判定。Cloudinary もネットワークも知らない |
| `backend/lib/images/uploader.rb` | Cloudinary へ上げて public_id を返す。検証を知らない |
| `backend/spec/support/image_fixtures.rb` | 各形式のマジックバイトとサンプル IO の組み立て |
| `backend/spec/support/cloudinary.rb` | 全 spec 共通の Cloudinary 既定スタブ |
| `backend/app/controllers/api/smoke_controller.rb` | **一時**。本番疎通確認用。確認後に削除 |
| `render.yaml` | 本番の環境変数宣言 |
| `.env.example` | ローカルの環境変数のひな形 |
| `docs/deployment.md` | Cloudinary の本番設定手順 |

`config/application.rb` の `config.autoload_lib` により `lib/images/` は `Images::` として autoload される（既存の `lib/cors/allowed_origins.rb` → `Cors::AllowedOrigins` と同じ）。

---

### Task 1: cloudinary gem の導入と設定のフェイルファスト

gem を入れ、`CLOUDINARY_URL` の設定漏れを本番で起動時に落とす。設定なので TDD の対象外だが、最後に既存 spec が全部通ることと、本番相当の env で意図どおり落ちることを確認する。

**Files:**
- Modify: `backend/Gemfile`
- Create: `backend/config/initializers/cloudinary.rb`
- Modify: `.env.example`

**Interfaces:**
- Consumes: なし
- Produces: `Cloudinary::Uploader.upload(file, options)` が全アプリコード・spec から参照可能になる。Task 3 がこれをスタブする。

- [ ] **Step 1: Gemfile に cloudinary を追加**

`backend/Gemfile` の `gem "devise-jwt"` の直後（`group :development, :test do` より前）に追加する。

```ruby
# 画像の保存先。CLOUDINARY_URL（api_secret を含む）はサーバー側のみに置き、
# フロントに渡すのは cloud_name だけ（配信URLに必ず現れる公開値）。
gem "cloudinary", "~> 2.4"
```

- [ ] **Step 2: gem をインストール**

```bash
docker compose exec backend bundle install
```

期待: `Bundle complete!` と表示され、`Gemfile.lock` に `cloudinary (2.4.x)` が追加される。

- [ ] **Step 3: インストールされたことを確認**

```bash
docker compose exec backend bundle exec ruby -e 'require "cloudinary"; puts Cloudinary::Uploader.method(:upload).parameters.inspect'
```

期待: `[[:req, :file], [:opt, :options]]` のような出力（`upload` が存在する）。`verify_partial_doubles = true` が有効なため、このメソッドが実在しないと Task 3 のスタブが失敗する。

- [ ] **Step 4: 初期化のフェイルファストを書く**

`backend/config/initializers/cloudinary.rb` を新規作成。

```ruby
# 画像の保存先は Cloudinary。gem は CLOUDINARY_URL を自動で読み、
# cloud_name / api_key / api_secret を設定する（明示的な設定記述は不要）。
#
#   CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
#
# この値は api_secret を含むためサーバー側のみに置く。フロントに渡すのは
# cloud_name だけで、これは配信URLに必ず現れる公開値（issue 3-2 で渡す）。
#
# 設定漏れは起動時に落とす。黙って起動すると「デプロイは green なのに
# 画像投稿だけが全部失敗する」状態になり、原因を追いにくいため。
# development / test は未設定のまま動かす運用なので本番のみに限定する
# （test は spec/support/cloudinary.rb が SDK をスタブするため実キーが要らない）。
#
# cors.rb と違って after_initialize を使わない。あちらは autoload される
# 定数（Cors::AllowedOrigins）を参照するため遅延させる必要があるが、
# ここは ENV を見るだけなので初期化時にそのまま評価してよい。
if ENV["CLOUDINARY_URL"].blank? && Rails.env.production?
  raise "CLOUDINARY_URL が設定されていません。Cloudinary ダッシュボードの " \
        "API Environment variable の値を設定してください。"
end
```

- [ ] **Step 5: `.env.example` に CLOUDINARY_URL を追加**

`JWT_SECRET_KEY=` のブロックの直後、末尾の `# NOTE: 本番（Render）には TZ=Asia/Tokyo も…` コメントより前に追加する。

```bash
# --- Cloudinary（画像の保存先）---
# ダッシュボードの "API Environment variable" に表示される値をそのまま貼る。
#   cloudinary://<api_key>:<api_secret>@<cloud_name>
#
# api_secret を含むためサーバー専用。フロント（NEXT_PUBLIC_）には絶対に置かない。
# フロントが必要とするのは cloud_name だけで、それは issue 3-2 で別途渡す。
#
# ローカルと本番は同じアカウントを使い、保存先を kotoe/<Rails.env>/ で分ける。
# 本番（Render）にも同名で設定する（値は同じでよい）。
CLOUDINARY_URL=
```

- [ ] **Step 6: 自分のローカル用に実際の値を設定**

`.env.development`（git 管理外）に、Cloudinary ダッシュボードから取得した実値を書く。**この手順はダッシュボード操作が必要なため人間が実施する。**

```bash
CLOUDINARY_URL=cloudinary://実際のkey:実際のsecret@実際のcloud名
```

書いたらコンテナを**作り直して** env を読み込ませる。

```bash
docker compose up -d backend
```

`docker compose restart` では読み込まれない。環境変数はコンテナ生成時に確定するため、
既存コンテナを再起動しても `env_file` は読み直されない。

- [ ] **Step 7: 既存の spec が壊れていないことを確認**

```bash
docker compose exec backend bundle exec rspec
```

期待: 既存の spec がすべて PASS（gem 追加で壊れていないこと）。

- [ ] **Step 8: 本番相当の env でフェイルファストが効くことを確認**

```bash
docker compose exec -e RAILS_ENV=production -e CLOUDINARY_URL= -e SECRET_KEY_BASE=dummy backend bin/rails runner 'puts "起動できてしまった"' 2>&1 | tail -5
```

期待: `CLOUDINARY_URL が設定されていません。` を含む RuntimeError で落ちる。`起動できてしまった` が出たら実装が誤っている。

`SECRET_KEY_BASE` は production 環境の起動に必要なダミー値。この env の組み合わせで production が起動できることは計画時に確認済みなので（`production boot OK` が出る）、落ちたら原因は必ず今回の initializer である。

- [ ] **Step 8b: 設定があれば本番でも起動できることを確認**

フェイルファストが厳しすぎて正常な設定まで落とさないことを見る。

```bash
docker compose exec -e RAILS_ENV=production -e CLOUDINARY_URL=cloudinary://k:s@demo -e SECRET_KEY_BASE=dummy backend bin/rails runner 'puts "production boot OK"'
```

期待: `production boot OK`。

- [ ] **Step 9: rubocop を通す**

```bash
docker compose exec backend bundle exec rubocop
```

期待: `no offenses detected`。

- [ ] **Step 10: コミット**

```bash
git add backend/Gemfile backend/Gemfile.lock backend/config/initializers/cloudinary.rb .env.example
git commit -m "feat: cloudinary gem を導入し CLOUDINARY_URL のフェイルファストを追加

CLOUDINARY_URL は api_secret を含むためサーバー側のみに置く。設定漏れは
本番のみ起動時に落とす（黙って起動すると画像投稿だけが全部失敗する状態が
デプロイ green に見えて原因を追いにくいため）。cors.rb と同じ方針。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Images::Validation（受け入れ判定）

ユーザーが上げたファイルを受け入れてよいか判定する PORO。Cloudinary もネットワークも知らない。

**Files:**
- Create: `backend/spec/support/image_fixtures.rb`
- Create: `backend/spec/lib/images/validation_spec.rb`
- Create: `backend/lib/images/validation.rb`

**Interfaces:**
- Consumes: なし（Task 1 とは独立）
- Produces:
  - `Images::Validation.call(file) -> Images::Validation::Result`
  - `Images::Validation::Result#valid? -> Boolean`
  - `Images::Validation::Result#error_code -> String, nil`（`"image_missing"` / `"image_too_large"` / `"image_type_not_allowed"`）
  - `Images::Validation::MAX_BYTES -> Integer`
  - spec ヘルパ `image_io(format, bytesize: nil) -> StringIO` と `uploaded_file(format, filename:, type:, bytesize: nil) -> ActionDispatch::Http::UploadedFile`（`format` は `:jpeg` / `:png` / `:webp` / `:heic` / `:heif` / `:pdf` / `:text`）。Task 4 と issue 3-2 の spec が使う。

- [ ] **Step 1: spec のヘルパを作る**

`backend/spec/support/image_fixtures.rb` を新規作成。`rails_helper` が `spec/support/**/*.rb` を自動で読み込む。

```ruby
# 画像判定のテストで使うサンプル。
#
# 形式の判定はファイル先頭のマジックバイトしか見ないため、本物の画像は要らない。
# バイナリを fixture としてコミットすると中身が diff で見えずレビューできないので、
# バイト列を定数で持ち、ここから IO を組み立てる。
# サイズ境界のテスト（5MB ちょうど / +1 バイト）も、巨大ファイルを
# リポジトリに置かずにパディングで作れる。
module ImageFixtures
  # 実際に marcel 1.2.1 で判定を確認した値。
  #   heic / heif … ISO base media 形式: [4byte box size]["ftyp"][major brand][minor version][compatible brands]
  MAGIC_BYTES = {
    heic: [ "\x00\x00\x00\x18", "ftyp", "heic", "\x00\x00\x00\x00", "mif1heic" ].join,
    heif: [ "\x00\x00\x00\x18", "ftyp", "mif1", "\x00\x00\x00\x00", "mif1heic" ].join,
    jpeg: "\xFF\xD8\xFF\xE0\x00\x10JFIF\x00",
    png: "\x89PNG\r\n\x1A\n",
    webp: "RIFF\x24\x00\x00\x00WEBPVP8 ",
    pdf: "%PDF-1.4\n",
    text: "this is not an image"
  }.freeze

  # 指定形式のマジックバイトを持つ IO。
  # bytesize を渡すと、その大きさになるまで末尾を 0 で埋める。
  def image_io(format, bytesize: nil)
    StringIO.new(image_bytes(format, bytesize: bytesize))
  end

  # フォームから飛んでくる形。filename / type はクライアント申告の値なので、
  # 中身と食い違う組み合わせ（詐称）も作れる。
  def uploaded_file(format, filename:, type:, bytesize: nil)
    tempfile = Tempfile.new("image-fixture")
    tempfile.binmode
    tempfile.write(image_bytes(format, bytesize: bytesize))
    tempfile.rewind

    ActionDispatch::Http::UploadedFile.new(tempfile: tempfile, filename: filename, type: type)
  end

  private

  def image_bytes(format, bytesize: nil)
    magic = MAGIC_BYTES.fetch(format).dup.force_encoding(Encoding::BINARY)
    return magic if bytesize.nil?

    magic + ("\0".b * (bytesize - magic.bytesize))
  end
end

RSpec.configure do |config|
  config.include ImageFixtures
end
```

- [ ] **Step 2: ヘルパ単体が動くことを確認**

```bash
docker compose exec backend bundle exec ruby -e '
require "stringio"
require "marcel"
formats = {
  heic: [ "\x00\x00\x00\x18", "ftyp", "heic", "\x00\x00\x00\x00", "mif1heic" ].join,
  jpeg: "\xFF\xD8\xFF\xE0\x00\x10JFIF\x00",
}
formats.each do |k, v|
  bytes = v.dup.force_encoding(Encoding::BINARY) + ("\0".b * 100)
  puts "#{k}: #{Marcel::MimeType.for(StringIO.new(bytes))} size=#{bytes.bytesize}"
end
'
```

期待: `heic: image/heic size=124` と `jpeg: image/jpeg size=113`。エンコーディングエラーが出ないこと。

- [ ] **Step 3: 失敗する spec を書く**

`backend/spec/lib/images/validation_spec.rb` を新規作成。

```ruby
require "rails_helper"

RSpec.describe Images::Validation do
  describe ".call" do
    context "受け入れる形式" do
      %i[jpeg png webp heic heif].each do |format|
        it "#{format} を通す" do
          result = described_class.call(image_io(format))

          expect(result).to be_valid
          expect(result.error_code).to be_nil
        end
      end
    end

    context "受け入れない形式" do
      it "PDF を拒否する" do
        result = described_class.call(image_io(:pdf))

        expect(result).not_to be_valid
        expect(result.error_code).to eq("image_type_not_allowed")
      end

      it "テキストを拒否する" do
        expect(described_class.call(image_io(:text)).error_code).to eq("image_type_not_allowed")
      end

      # このクラスの存在意義。Content-Type やファイル名を信じる実装だと通ってしまう。
      it "中身がテキストなら、image/jpeg を名乗り拡張子が .jpg でも拒否する" do
        forged = uploaded_file(:text, filename: "innocent.jpg", type: "image/jpeg")

        expect(described_class.call(forged).error_code).to eq("image_type_not_allowed")
      end

      # 逆方向。中身が本物なら、申告が間違っていても通す。
      it "中身が PNG なら、text/plain を名乗っていても通す" do
        mislabeled = uploaded_file(:png, filename: "photo.txt", type: "text/plain")

        expect(described_class.call(mislabeled)).to be_valid
      end
    end

    context "サイズ" do
      it "5MB ちょうどを通す" do
        expect(described_class.call(image_io(:jpeg, bytesize: 5.megabytes))).to be_valid
      end

      it "5MB を 1 バイト超えたら拒否する" do
        result = described_class.call(image_io(:jpeg, bytesize: 5.megabytes + 1))

        expect(result.error_code).to eq("image_too_large")
      end

      # サイズを形式より先に見るので、巨大な非画像は中身を読まずに弾ける。
      it "サイズ超過を形式より先に判定する" do
        result = described_class.call(image_io(:text, bytesize: 5.megabytes + 1))

        expect(result.error_code).to eq("image_too_large")
      end
    end

    context "ファイルがない" do
      it "nil を拒否する" do
        expect(described_class.call(nil).error_code).to eq("image_missing")
      end

      it "空ファイルを拒否する" do
        expect(described_class.call(StringIO.new("")).error_code).to eq("image_missing")
      end
    end

    # 判定のあと、呼び出し側がそのまま Cloudinary へ渡せる状態にしておく。
    it "判定後に IO の位置を先頭へ戻す" do
      io = image_io(:png)
      described_class.call(io)

      expect(io.pos).to eq(0)
    end

    it "上限が 5MB である" do
      expect(described_class::MAX_BYTES).to eq(5.megabytes)
    end
  end
end
```

- [ ] **Step 4: spec が失敗することを確認**

```bash
docker compose exec backend bundle exec rspec spec/lib/images/validation_spec.rb
```

期待: FAIL。`uninitialized constant Images::Validation`（`NameError`）。

- [ ] **Step 5: 実装する**

`backend/lib/images/validation.rb` を新規作成。

```ruby
module Images
  # アップロードされたファイルを受け入れてよいか判定する。
  #
  # Cloudinary もネットワークも知らない純粋な判定なので、単体で速くテストできる。
  # Images::Uploader と分けてあるのは利用者が違うため：お題画像（issue 3-2）は
  # ユーザー入力なので検証が要るが、生成画像（issue 4-2）は自前で作った PNG で
  # 検証の対象ではない。1 クラスにまとめると「検証をスキップするフラグ」が生える。
  class Validation
    MAX_BYTES = 5.megabytes

    # HEIC / HEIF は iPhone の標準形式で、Safari から生で飛んでくることがある。
    # Cloudinary 側で JPEG に変換して配信できるため受け入れる。
    ALLOWED_CONTENT_TYPES = %w[
      image/jpeg
      image/png
      image/webp
      image/heic
      image/heif
    ].freeze

    # 文言ではなくエラーコードを返す。日本語化はフロントの辞書が行う
    # （CLAUDE.md：ルールの判定はバック、見せ方はフロント）。
    Result = Data.define(:error_code) do
      def valid? = error_code.nil?
    end

    def self.call(file) = new(file).call

    def initialize(file)
      @file = file
    end

    # 最初に見つかった 1 件だけを返す（フロントの表示は 1 行のトーストで足りる）。
    # サイズを形式より先に見るのは、巨大なファイルの中身を読まずに弾くため。
    def call
      return Result.new(error_code: "image_missing") if missing?
      return Result.new(error_code: "image_too_large") if too_large?
      return Result.new(error_code: "image_type_not_allowed") unless allowed_type?

      Result.new(error_code: nil)
    end

    private

    def missing?
      @file.nil? || @file.size.to_i.zero?
    end

    def too_large?
      @file.size > MAX_BYTES
    end

    def allowed_type?
      ALLOWED_CONTENT_TYPES.include?(detected_content_type)
    end

    # クライアントが送る Content-Type とファイル名は使わない。どちらも自由に
    # 詐称できるため、ファイル先頭のマジックバイトだけで判定する。
    #
    # 呼び出し側が既に読み進めている可能性があるので、読む前に位置を戻す。
    # Marcel は読み取り後に位置を 0 に戻すため、判定後はそのまま
    # Images::Uploader へ渡せる。
    def detected_content_type
      @file.rewind
      Marcel::MimeType.for(@file)
    end
  end
end
```

- [ ] **Step 6: spec が通ることを確認**

```bash
docker compose exec backend bundle exec rspec spec/lib/images/validation_spec.rb
```

期待: 全 example PASS（17 examples 前後、0 failures）。

- [ ] **Step 7: rubocop を通す**

```bash
docker compose exec backend bundle exec rubocop
```

期待: `no offenses detected`。

- [ ] **Step 8: コミット**

```bash
git add backend/lib/images/validation.rb backend/spec/lib/images/validation_spec.rb backend/spec/support/image_fixtures.rb
git commit -m "feat: 画像の受け入れ判定（Images::Validation）

上限 5MB、JPEG/PNG/WebP/HEIC/HEIF を許可する。形式はファイル先頭の
マジックバイトで判定し、クライアント申告の Content-Type とファイル名は
使わない（どちらも詐称できるため）。返すのはエラーコードのみで、
日本語化はフロントの辞書に任せる。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Images::Uploader（Cloudinary へのアップロード）

Cloudinary へ上げて public_id を返す PORO と、全 spec 共通の既定スタブ。

**Files:**
- Create: `backend/spec/support/cloudinary.rb`
- Create: `backend/spec/lib/images/uploader_spec.rb`
- Create: `backend/lib/images/uploader.rb`

**Interfaces:**
- Consumes: `Cloudinary::Uploader.upload(file, options)`（Task 1 で導入）
- Produces:
  - `Images::Uploader.call(file, kind:) -> String`（public_id）。`kind` は `:post` か `:generated`
  - `Images::Uploader::UploadError < StandardError`
  - `Images::Uploader::FOLDERS -> Hash`
  - 全 spec で `Cloudinary::Uploader.upload` が既定スタブされ、`{"public_id" => "kotoe/test/posts/stubbed"}` を返す。Task 4 と issue 3-2 / 4-2 の spec がこれに依存する。

- [ ] **Step 1: 全 spec 共通の既定スタブを作る**

`backend/spec/support/cloudinary.rb` を新規作成。

```ruby
# Cloudinary は外部サービス。spec が実際にネットワークへ出ないよう、
# SDK のアップロードを全 spec で既定スタブ化する。
#
# 個々の spec の書き手がスタブを書き忘れても本物を叩かない、という保証を
# 仕組みで作るのが狙い。あわせて issue 3-2 以降の request spec / job spec が
# 毎回スタブを書かずに済む。
#
# 実際の契約（キーが通るか・レスポンス形状が想定どおりか）はスタブでは
# 守れないので、そこは本番スモークで担保する（設計ドキュメント参照）。
#
# 渡す引数や戻り値そのものを検証したい spec（spec/lib/images/uploader_spec.rb）は
# この既定スタブを自分で上書きする。
RSpec.configure do |config|
  config.before do
    allow(Cloudinary::Uploader).to receive(:upload).and_return(
      "public_id" => "kotoe/test/posts/stubbed"
    )
  end
end
```

- [ ] **Step 2: 失敗する spec を書く**

`backend/spec/lib/images/uploader_spec.rb` を新規作成。

引数の検証はブロック形式で受け取る。`Cloudinary::Uploader.upload` の 2 番目の引数はキーワード引数ではなく省略可能な Hash なので、ブロックで受けるのが最も曖昧さがない。

```ruby
require "rails_helper"

RSpec.describe Images::Uploader do
  let(:file) { StringIO.new("dummy") }

  describe ".call" do
    it "public_id を返す" do
      allow(Cloudinary::Uploader).to receive(:upload).and_return(
        "public_id" => "kotoe/test/posts/abc123",
        "secure_url" => "https://res.cloudinary.com/demo/image/upload/abc123.png"
      )

      expect(described_class.call(file, kind: :post)).to eq("kotoe/test/posts/abc123")
    end

    it "渡されたファイルをそのまま Cloudinary に渡す" do
      described_class.call(file, kind: :post)

      expect(Cloudinary::Uploader).to have_received(:upload) do |uploaded, _options|
        expect(uploaded).to be(file)
      end
    end

    # ローカルと本番で同じ Cloudinary アカウントを共用するため、
    # 保存先に環境名を含めて資産が混ざらないようにしている。
    it "お題画像を kotoe/<env>/posts へ上げる" do
      described_class.call(file, kind: :post)

      expect(Cloudinary::Uploader).to have_received(:upload) do |_uploaded, options|
        expect(options[:folder]).to eq("kotoe/test/posts")
      end
    end

    it "生成画像を kotoe/<env>/generated へ上げる" do
      described_class.call(file, kind: :generated)

      expect(Cloudinary::Uploader).to have_received(:upload) do |_uploaded, options|
        expect(options[:folder]).to eq("kotoe/test/generated")
      end
    end

    # 省略すると既定が "auto" になり、動画や任意のバイナリまで受け付けてしまう。
    it "resource_type を image に固定する" do
      described_class.call(file, kind: :post)

      expect(Cloudinary::Uploader).to have_received(:upload) do |_uploaded, options|
        expect(options[:resource_type]).to eq("image")
      end
    end

    # 黙って既定フォルダに入れず、プログラミングエラーとして落とす。
    it "未知の kind は KeyError で落とす" do
      expect { described_class.call(file, kind: :unknown) }.to raise_error(KeyError)
    end

    context "Cloudinary が失敗したとき" do
      it "タイムアウトを UploadError に包み直す" do
        allow(Cloudinary::Uploader).to receive(:upload).and_raise(Timeout::Error)

        expect { described_class.call(file, kind: :post) }
          .to raise_error(Images::Uploader::UploadError)
      end

      it "SDK 由来の例外を UploadError に包み直す" do
        allow(Cloudinary::Uploader).to receive(:upload).and_raise(StandardError, "boom")

        expect { described_class.call(file, kind: :post) }
          .to raise_error(Images::Uploader::UploadError)
      end

      # 元例外のメッセージには API キーやレスポンス本文が混ざりうるので持ち回らない
      # （CLAUDE.md：秘密情報をログに出さない）。
      it "元の例外メッセージを持ち回らない" do
        allow(Cloudinary::Uploader).to receive(:upload)
          .and_raise(StandardError, "cloudinary://key:secret@cloud is invalid")

        expect { described_class.call(file, kind: :post) }
          .to raise_error(Images::Uploader::UploadError, "Cloudinary upload failed: StandardError")
      end
    end
  end
end
```

- [ ] **Step 3: spec が失敗することを確認**

```bash
docker compose exec backend bundle exec rspec spec/lib/images/uploader_spec.rb
```

期待: FAIL。`uninitialized constant Images::Uploader`（`NameError`）。

- [ ] **Step 4: 実装する**

`backend/lib/images/uploader.rb` を新規作成。

```ruby
module Images
  # 画像を Cloudinary へ上げて public_id を返す。
  #
  # 受け入れ判定（サイズ・形式）は Images::Validation の担当で、ここには無い。
  # 生成画像（issue 4-2）は自前で作った PNG なので検証を通さずにここだけを使う。
  class Uploader
    # Cloudinary 由来の失敗（API エラー・タイムアウト・ネットワーク断）を 1 つにまとめる。
    # 扱いは呼び出し側が決める：issue 3-2 のコントローラは 502 + image_upload_failed、
    # issue 4-2 のジョブはリトライに乗せる。
    class UploadError < StandardError; end

    # 保存先フォルダ。パスに Rails.env を含めるので、ローカルの検証画像が
    # 本番の資産と混ざらない（同じ Cloudinary アカウントを共用する運用のため）。
    FOLDERS = {
      post: "posts",          # お題画像（issue 3-2）
      generated: "generated"  # 再現画像（issue 4-2）
    }.freeze

    def self.call(file, kind:) = new(file, kind: kind).call

    def initialize(file, kind:)
      @file = file
      @kind = kind
    end

    # @return [String] Cloudinary の public_id。DB に入れるのはこれだけ。
    def call
      # 未知の kind はここで KeyError。プログラミングエラーなので UploadError に包まない。
      target = folder

      upload_to(target).fetch("public_id")
    end

    private

    def folder
      "kotoe/#{Rails.env}/#{FOLDERS.fetch(@kind)}"
    end

    # 例外クラスは SDK のバージョンや失敗の種類（HTTP エラー・タイムアウト）で
    # 変わるため、呼び出し側が 1 つ rescue すれば済むようここで一本化する。
    #
    # 元例外の message は含めない。Cloudinary のエラー本文に接続文字列や
    # キーが混ざる可能性があり、ログに秘密情報を出さないため。
    def upload_to(target)
      Cloudinary::Uploader.upload(@file, folder: target, resource_type: "image")
    rescue StandardError => e
      raise UploadError, "Cloudinary upload failed: #{e.class}"
    end
  end
end
```

- [ ] **Step 5: spec が通ることを確認**

```bash
docker compose exec backend bundle exec rspec spec/lib/images/uploader_spec.rb
```

期待: 全 example PASS（10 examples、0 failures）。

- [ ] **Step 6: 全 spec が通ることを確認**

既定スタブを足したので、既存の spec に影響が無いことを見る。

```bash
docker compose exec backend bundle exec rspec
```

期待: すべて PASS。

- [ ] **Step 7: rubocop を通す**

```bash
docker compose exec backend bundle exec rubocop
```

期待: `no offenses detected`。

- [ ] **Step 8: コミット**

```bash
git add backend/lib/images/uploader.rb backend/spec/lib/images/uploader_spec.rb backend/spec/support/cloudinary.rb
git commit -m "feat: Cloudinary へのアップロード（Images::Uploader）

保存先は kotoe/<Rails.env>/<kind> で、ローカルと本番で同じアカウントを
使っても資産が混ざらない。resource_type は image に固定する（既定の auto は
動画や任意のバイナリまで受け付けるため）。失敗は UploadError に一本化し、
元例外のメッセージは持ち回らない（キーが混ざりうるため）。

spec は Cloudinary SDK を全体で既定スタブ化し、テストがネットワークへ
出ないことを仕組みで保証する。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 本番スモーク用の一時ルート

Render は free プランで Shell も one-off job も使えないため、本番で Cloudinary のキーが通ることを確かめる手段が HTTP しかない。**このタスクで足すコードは確認後に削除する。**

**Files:**
- Create: `backend/app/controllers/api/smoke_controller.rb`
- Modify: `backend/config/routes.rb`
- Create: `backend/spec/requests/api/smoke_spec.rb`

**Interfaces:**
- Consumes: `Images::Uploader.call(file, kind:)`、`Images::Uploader::UploadError`（Task 3）
- Produces: `POST /api/smoke/cloudinary`（要認証）。成功時 200 `{"public_id": "..."}`、失敗時 502 `{"error": "..."}`。**issue 3-1 完了後に削除される。**

- [ ] **Step 1: 失敗する spec を書く**

`backend/spec/requests/api/smoke_spec.rb` を新規作成。

```ruby
require "rails_helper"

# issue 3-1 の本番疎通確認用。本番で Cloudinary のキーが通ることを確かめたら
# コントローラ・ルートごと削除する（8-2a の /smoke と同じ扱い）。
RSpec.describe "POST /api/smoke/cloudinary" do
  let(:user) { create(:user) }

  it "未認証なら 401 を返す" do
    post "/api/smoke/cloudinary"

    expect(response).to have_http_status(:unauthorized)
  end

  it "ログイン済みなら public_id を返す" do
    token = sign_in_and_get_token(user)

    post "/api/smoke/cloudinary", headers: auth_headers(token)

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["public_id"]).to eq("kotoe/test/posts/stubbed")
  end

  it "アップロードに失敗したら 502 を返す" do
    allow(Cloudinary::Uploader).to receive(:upload).and_raise(Timeout::Error)
    token = sign_in_and_get_token(user)

    post "/api/smoke/cloudinary", headers: auth_headers(token)

    expect(response).to have_http_status(:bad_gateway)
  end
end
```

- [ ] **Step 2: spec が失敗することを確認**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/smoke_spec.rb
```

期待: FAIL。ルートが無いため `ActionController::RoutingError`。

- [ ] **Step 3: コントローラを実装する**

`backend/app/controllers/api/smoke_controller.rb` を新規作成。

```ruby
module Api
  # 【一時】issue 3-1 の本番疎通確認用。
  #
  # Render の free プランは Shell / one-off job が使えないため、本番で
  # Cloudinary のキーが通ることを確かめる手段が HTTP しかない。
  # 本番で 1 回叩いて確認したら、このファイルとルートを削除する
  # （8-2a の /smoke を #54 で追加 → #56 で削除したのと同じ扱い）。
  class SmokeController < ApplicationController
    before_action :authenticate_user!

    # 1x1 の透明 PNG。spec/fixtures はテスト用の置き場なのでアプリコードから
    # 参照せず、ここにバイト列で持つ。Base64 は Rails 自身が依存している。
    ONE_PIXEL_PNG = Base64.decode64(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk" \
      "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    ).freeze

    def cloudinary
      file = png_tempfile

      render json: { public_id: Images::Uploader.call(file, kind: :post) }
    rescue Images::Uploader::UploadError => e
      render json: { error: e.message }, status: :bad_gateway
    ensure
      file&.close!
    end

    private

    def png_tempfile
      Tempfile.new([ "smoke", ".png" ]).tap do |tempfile|
        tempfile.binmode
        tempfile.write(ONE_PIXEL_PNG)
        tempfile.rewind
      end
    end
  end
end
```

- [ ] **Step 4: ルートを追加する**

`backend/config/routes.rb` の `namespace :api do` ブロック内、`get "me" => "me#show"` の直後に追加する。

```ruby
    # 【一時】issue 3-1 の本番疎通確認用。Cloudinary の本番キーが通ることを
    # 確認したら、smoke_controller.rb ごと削除PRで消す。
    post "smoke/cloudinary" => "smoke#cloudinary"
```

- [ ] **Step 5: spec が通ることを確認**

```bash
docker compose exec backend bundle exec rspec spec/requests/api/smoke_spec.rb
```

期待: 3 examples PASS、0 failures。

- [ ] **Step 6: ローカルで実際に Cloudinary へ上がることを確認**

ここが「ローカルでの動作確認」。spec はスタブなので、ここで初めて本物を叩く。Task 1 の Step 6 で `.env.development` に実値を入れてあること。

```bash
docker compose exec backend bin/rails runner '
user = User.find_or_create_by!(email: "smoke@example.com") { |u| u.name = "smoke"; u.password = "password123" }
file = Tempfile.new(["local-smoke", ".png"]).tap { |f| f.binmode; f.write(Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")); f.rewind }
puts Images::Uploader.call(file, kind: :post)
'
```

期待: `kotoe/development/posts/<ランダム文字列>` が出力される。Cloudinary のダッシュボード（Media Library）で `kotoe/development/posts/` の下に 1x1 の画像が入っていることを目視確認する。

失敗する場合の切り分け:
- `UploadError` → `.env.development` の `CLOUDINARY_URL` が誤っている。`docker compose restart backend` を忘れていないか確認する
- `kotoe/production/...` が出た → `RAILS_ENV` が production になっている

- [ ] **Step 7: 全 spec と rubocop を通す**

```bash
docker compose exec backend bundle exec rspec && docker compose exec backend bundle exec rubocop
```

期待: 全 example PASS、`no offenses detected`。

- [ ] **Step 8: コミット**

```bash
git add backend/app/controllers/api/smoke_controller.rb backend/config/routes.rb backend/spec/requests/api/smoke_spec.rb
git commit -m "feat: 本番疎通確認用の一時スモークルート（issue 3-1）

Render の free プランは Shell / one-off job が使えないため、本番で
Cloudinary のキーが通ることを確かめる手段が HTTP しかない。1x1 の PNG を
上げて public_id を返すだけの一時ルートを置く。本番で確認できたら
削除PRで消す（8-2a の /smoke と同じ扱い）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 本番の環境変数とドキュメント

**Files:**
- Modify: `render.yaml`
- Modify: `docs/deployment.md`
- Modify: `docs/issues_backlog.md`

**Interfaces:**
- Consumes: なし
- Produces: なし（設定とドキュメント）

- [ ] **Step 1: render.yaml に CLOUDINARY_URL を追加**

`render.yaml` の `envVars` の末尾（`CORS_ALLOWED_ORIGIN_REGEX` の次の行）に追加する。

```yaml
      - { key: CLOUDINARY_URL, sync: false }
```

`sync: false` は「値をリポジトリに書かず Render ダッシュボードで手入力する」という宣言。api_secret を含むため必須。

- [ ] **Step 2: docs/deployment.md の環境変数表に行を足す**

`### Render（Rails）` の表（`| 変数 | 出所 | 値 / 備考 |`）の末尾、`CORS_ALLOWED_ORIGIN_REGEX` の行の次に追加する。

```markdown
| `CLOUDINARY_URL` | **手入力** | Cloudinary の API Environment variable。api_secret を含むためサーバー専用。未設定だと boot で raise する |
```

- [ ] **Step 3: docs/deployment.md に Cloudinary の設定手順を追記**

`### Vercel（Next.js）` の節の直前（`### Render（Rails）` の注記の後）に、次の節を追加する。

```markdown
### Cloudinary（画像の保存先）

1. Cloudinary のダッシュボードにログインし、Programmable Media の Dashboard を開く
2. **API Environment variable** に表示されている `cloudinary://<api_key>:<api_secret>@<cloud_name>` をコピーする
3. Render の kotoe-api → Environment に `CLOUDINARY_URL` として貼る
4. あわせて Cloudinary 側で**使用量アラート**を設定する（Settings → Account → Usage alerts）。
   画像の配信URLに含まれる cloud_name は公開値で、第三者が任意サイズの変換URLを
   作れてしまうため、変換クレジットの異常消費に気づけるようにしておく

ローカルと本番は同じ Cloudinary アカウントを使い、保存先を `kotoe/development/` と
`kotoe/production/` のフォルダで分けている（`Images::Uploader` がパスに `Rails.env` を含める）。

`CLOUDINARY_URL` が未設定のまま本番を起動すると、`config/initializers/cloudinary.rb`
が起動時に例外を出して落ちる。設定漏れに気づかないままデプロイが green に見える
状態を防ぐため、意図的にそうしてある。
```

- [ ] **Step 4: docs/issues_backlog.md の 3-1 にチェックを入れる**

114〜120 行目付近の 3-1 のタスクを更新する。

```markdown
### 🟢 3-1. Cloudinary 画像アップロード基盤
- 目的：画像の保存先を用意する。
- 依存：1-1
- タスク：
  - [x] Cloudinary gem 設定（`CLOUDINARY_URL` 環境変数）
  - [x] 画像アップロードの仕組み（direct or サーバー経由）を決めて実装
        → **サーバー経由**（Rails が Cloudinary へ上げる）。`Images::Validation`（受け入れ判定）
        と `Images::Uploader`（アップロード）の 2 つの PORO に分割。判断の根拠は
        `docs/superpowers/specs/2026-07-27-issue-3-1-cloudinary-design.md`
- 完了条件：画像をアップロードして URL/public_id を保存・取得できる。
```

- [ ] **Step 5: コミット**

```bash
git add render.yaml docs/deployment.md docs/issues_backlog.md
git commit -m "docs: Cloudinary の本番設定手順と 3-1 の完了チェック

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: PR を作成する**

```bash
git push -u origin feature/issue-3-1
gh pr create --title "feat: Cloudinary 画像アップロード基盤 (issue 3-1)" --body "$(cat <<'BODY'
## 概要
issue 3-1。画像の保存先（Cloudinary）と、サーバー側から上げて public_id を得る基盤を作る。

設計: `docs/superpowers/specs/2026-07-27-issue-3-1-cloudinary-design.md`

## 決めたこと
- **アップロード経路はサーバー経由**（フロント → Rails → Cloudinary）。署名付きダイレクトは採らない。API secret がサーバーに閉じること、検証を Rails に一元化できること、issue 4-2 の生成画像アップロードと同じ PORO を共有できることが理由。
- **検証とアップロードを別の PORO に分ける**。お題画像はユーザー入力なので検証が要るが、生成画像は自前の PNG で検証の対象ではない。1 クラスにまとめると「検証をスキップするフラグ」が生える。
- **形式判定はマジックバイト**。クライアント申告の Content-Type とファイル名は使わない（詐称できるため）。上限 5MB、JPEG/PNG/WebP/HEIC/HEIF を許可。
- **DB は public_id だけを持ち、配信URLはフロントが組み立てる**（issue 3-2 で実装）。Cloudinary は変換をURLパスで指定するため、URL を組み立てる側が表示サイズを決める側になる。寸法は画面の都合なのでフロントの責務。

## この PR に含まれないもの
- HTTP エンドポイント（issue 3-2 の `POST /api/posts` が最初の利用者）
- フロントの `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` と URL 組み立て（消費者が居るタイミング＝ issue 3-2 で入れる）

## 一時コード
`POST /api/smoke/cloudinary` は本番疎通確認用。Render が free プランで Shell / one-off job を使えないため HTTP でしか本番のキーを検証できない。確認後に削除PRで消す（8-2a の `/smoke` と同じ扱い）。

## マージ後にやること
1. Render ダッシュボードで `CLOUDINARY_URL` を設定
2. デプロイ後にスモークルートを 1 回叩き、`kotoe/production/posts/` に入ることを確認
3. 確認に使った画像を Cloudinary ダッシュボードから削除
4. スモークルート削除の PR を出す

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

### Task 6: 本番疎通の確認とスモークルートの削除

**この Task は PR がマージされた後に実施する。** ダッシュボード操作を含むため人間が手を動かす部分がある。

**Files:**
- Delete: `backend/app/controllers/api/smoke_controller.rb`
- Delete: `backend/spec/requests/api/smoke_spec.rb`
- Modify: `backend/config/routes.rb`

**Interfaces:**
- Consumes: `POST /api/smoke/cloudinary`（Task 4）
- Produces: なし（一時コードの除去）

- [ ] **Step 1: Render に CLOUDINARY_URL を設定する（人間が実施）**

Render ダッシュボード → kotoe-api → Environment → `CLOUDINARY_URL` に、Cloudinary の API Environment variable の値を貼る。保存すると再デプロイが走る。

- [ ] **Step 2: デプロイ完了を待ち、起動していることを確認**

```bash
curl -s https://kotoe-api.onrender.com/api/health
```

期待: `{"status":"ok","database":"ok"}`。500 が返る場合は `CLOUDINARY_URL` の設定漏れでフェイルファストが効いている可能性があるので、Render のログを見る。

（free プランはアイドルでスリープするため、最初のリクエストは 30〜60 秒かかることがある。）

- [ ] **Step 3: 本番でログインしてトークンを得る**

`<email>` / `<password>` は 8-2a のスモーク時に作ったユーザー、または新規登録したもの。

```bash
curl -s -i -X POST https://kotoe-api.onrender.com/api/auth/sign_in \
  -H "Content-Type: application/json" \
  -d '{"user":{"email":"<email>","password":"<password>"}}' | grep -i "^authorization:"
```

期待: `authorization: Bearer eyJ...` が返る。

- [ ] **Step 4: 本番のスモークルートを叩く**

```bash
curl -s -X POST https://kotoe-api.onrender.com/api/smoke/cloudinary \
  -H "Authorization: Bearer <前ステップのトークン>"
```

期待: `{"public_id":"kotoe/production/posts/<ランダム文字列>"}`。

- `502` が返ったら `CLOUDINARY_URL` の値が誤っている
- `401` が返ったらトークンが誤っている
- `kotoe/development/...` が返ったら Render の `RAILS_ENV` が production になっていない

- [ ] **Step 5: Cloudinary ダッシュボードで確認し、テスト画像を削除する（人間が実施）**

Media Library で `kotoe/production/posts/` の下に 1x1 の画像が入っていることを目視確認する。確認できたら**その画像を削除する**（本番の資産にテスト画像を残さない）。

- [ ] **Step 6: 削除用のブランチを切る**

```bash
git checkout main && git pull && git checkout -b chore/remove-cloudinary-smoke
```

- [ ] **Step 7: 一時コードを削除する**

```bash
git rm backend/app/controllers/api/smoke_controller.rb backend/spec/requests/api/smoke_spec.rb
```

あわせて `backend/config/routes.rb` から次の 3 行を削除する。

```ruby
    # 【一時】issue 3-1 の本番疎通確認用。Cloudinary の本番キーが通ることを
    # 確認したら、smoke_controller.rb ごと削除PRで消す。
    post "smoke/cloudinary" => "smoke#cloudinary"
```

- [ ] **Step 8: 全 spec と rubocop を通す**

```bash
docker compose exec backend bundle exec rspec && docker compose exec backend bundle exec rubocop
```

期待: 全 example PASS（スモークの 3 example が減っている）、`no offenses detected`。

- [ ] **Step 9: コミットして PR を出す**

```bash
git add -A
git commit -m "chore: 一時スモークルート(/api/smoke/cloudinary)を削除（3-1 検証完了）

本番で Cloudinary のキーが通ること、kotoe/production/posts/ に
上がることを確認できたため削除する。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push -u origin chore/remove-cloudinary-smoke
gh pr create --title "chore: 一時スモークルートを削除（issue 3-1 検証完了）" --body "$(cat <<'BODY'
本番で Cloudinary の疎通を確認できたため、issue 3-1 で置いた一時ルート
`POST /api/smoke/cloudinary` を削除する。

確認内容:
- 本番で `kotoe/production/posts/` に画像が上がること
- 確認に使った画像は Cloudinary ダッシュボードから削除済み

8-2a の `/smoke`（#54 で追加 → #56 で削除）と同じ扱い。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## 次の issue への申し送り

- **3-2（Post CRUD API）**: `POST /api/posts` で `Images::Validation.call(file)` → `Images::Uploader.call(file, kind: :post)` を合成する。`Result#error_code` はそのまま JSON のエラーコードとして返す。`Images::Uploader::UploadError` は 502 + `image_upload_failed` に変換する。あわせてフロントに `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` を渡し、public_id から配信URLを組み立てるヘルパを作る（純粋なユーティリティ関数なので、CLAUDE.md の方針上 Vitest を後付けする候補）。
- **4-2（描写の保存・生成）**: `GenerateImageJob` から `Images::Uploader.call(file, kind: :generated)` を呼ぶ。`UploadError` はジョブのリトライ対象にする。`Images::Validation` は通さない（自前で生成した PNG のため）。
