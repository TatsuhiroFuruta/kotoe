# issue 3-1 設計：Cloudinary 画像アップロード基盤

- Issue: `docs/issues_backlog.md` の 3-1
- Branch: `feature/issue-3-1`
- 前提: 8-2a（本番スケルトン）まで完了。backbone は `… → 2-2 → 8-2a → 3-1 → 3-2 → …`

## 目的

画像の保存先（Cloudinary）を用意し、**サーバー側から画像をアップロードして public_id を得る**仕組みを作る。この issue は基盤のみで、HTTP エンドポイントは作らない。実際の利用者は 3-2（`POST /api/posts`）と 4-2（`GenerateImageJob`）。

## 方針の確定事項（ユーザー合意済み）

1. **スコープは「基盤 + 本番スモーク」**。3-1 では本番用の HTTP エンドポイントを作らない。
   - 理由: エンドポイントを作っても 3-2 の `POST /api/posts` に吸収されて捨てることになる。
   - ただし CLAUDE.md の「本番固有の統合はその機能を実装した回にその都度スモーク確認」に従い、Cloudinary の本番キー疎通は今回取る。
2. **アップロード経路はサーバー経由**（フロント → Rails → Cloudinary）。署名付きダイレクトアップロードは採らない。
   - 理由: (a) API secret がサーバーに閉じる。(b) 形式・サイズの検証を Rails に一元化できる（「ルールの判定はバック」）。(c) **4-2 の `GenerateImageJob` は必ずサーバー側アップロードになる**ので、同じ PORO を両方で使える。ダイレクトを選ぶと経路が 2 本になる。
   - ダイレクトの弱点: public_id をクライアントが自己申告する構造になり、Admin API で存在・所有を検証する後処理が要る。
   - 将来の乗り換え条件: **同時アップロード数**が Puma のスレッドを食い潰すようになったとき（累計画像枚数やストレージ量は関係ない）。DB は public_id を持つ形のまま変わらないので、Post のモデル・スキーマ・シリアライザを触らずに「お題投稿の経路だけ」差し替えられる。生成画像のアップロードは Solid Queue のワーカープロセス側で走るため、そもそも Puma スレッドを消費しない。
3. **受け入れ条件**: 上限 **5MB**、形式 **JPEG / PNG / WebP / HEIC / HEIF**。
   - 5MB の根拠: Cloudinary 無料プランの上限は 10MB だが、上限いっぱいまで許すと Render を通る時間がそのまま延びる（＝スレッド占有）。スマホ写真は概ね 2〜4MB なので実用上困らない。
   - HEIC を許す根拠: iPhone の標準形式で Safari から生で飛んでくることがある。Cloudinary 側で JPEG に変換して配信できるため実装は増えない。
4. **画像 URL の組み立てはフロント**。バックは public_id だけを返す。
   - 理由: Cloudinary は変換を URL のパスで指定するため、「URL を組み立てる側」＝「表示サイズを決める側」になる。寸法は画面の都合＝フロントの責務（CLAUDE.md「見せ方はフロント」）。バックに持たせると画面を足すたびにシリアライザを触ることになる。
   - `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` の露出について: cloud name は**秘密情報ではない**。配信 URL に必ず現れる公開値であり、バックが URL を組み立てる案を採っても同じようにブラウザから見える。cloud name だけでできるのは「既知の public_id に対する任意変換 URL の生成」のみで、アップロード（署名 or unsigned preset が必要／本プロジェクトは unsigned preset を使わない）も削除・改変（Admin API の key + secret が必要）もできない。
   - 残るリスクは**変換クレジットの消費**。MVP では Cloudinary の使用量アラートで検知する運用とし、実害が出たら named transformation ＋ strict transformations に寄せる。
5. **RSpec では Cloudinary SDK のメソッドをスタブする**（WebMock / VCR は入れない）。
   - 理由: 検証したいのは「SDK の使い方」ではなく「自前 PORO の振る舞い」。実際の契約（キーが通るか・レスポンス形状）は本番スモークが担保する。gem 追加も避けられる。
6. **ローカル開発でも実際に Cloudinary へ上げる**。環境の分離はフォルダで行う（`kotoe/development/` と `kotoe/production/`）。別アカウントは作らない。

## 既存コードの調査結果（設計の根拠）

- **marcel 1.2.1 は既に `Gemfile.lock` にある**（activestorage 経由）。`config/application.rb` で `active_storage/engine` を読み込み済みのため、マジックバイト判定に gem 追加は不要。
- `config/application.rb` に `config.autoload_lib(ignore: %w[assets tasks])` があり、`lib/` 配下は Zeitwerk で autoload される。既存の `lib/cors/allowed_origins.rb` → `Cors::AllowedOrigins` と同じ流儀で `lib/images/` を置ける。
- `config/initializers/cors.rb` は「本番のみ、設定不足なら `after_initialize` で raise」というフェイルファストの前例を持つ。Cloudinary の初期化もこれに揃える。
- `spec/support/` は `rails_helper` が自動読み込みする（`auth_helpers.rb` / `shoulda_matchers.rb` の前例あり）。
- `render.yaml` は `plan: free`。**free インスタンスは Shell / one-off job が使えない**ため、本番でコードを走らせる手段は HTTP 経由に限られる（本番スモークの設計に影響）。
- `db/schema.rb`: `posts.image_public_id`（NOT NULL）と `attempts.generated_image_public_id`（NULL 可）が 1-1 で作成済み。**スキーマ変更は不要**。

## 成果物

| ファイル | 種別 | 内容 |
|---|---|---|
| `backend/Gemfile` | 更新 | `gem "cloudinary"` を追加 |
| `backend/config/initializers/cloudinary.rb` | 新規 | `CLOUDINARY_URL` のフェイルファスト |
| `backend/lib/images/validation.rb` | 新規 | 受け入れ判定（Cloudinary を知らない） |
| `backend/lib/images/uploader.rb` | 新規 | Cloudinary へのアップロード（検証を知らない） |
| `backend/spec/lib/images/validation_spec.rb` | 新規 | 境界値・形式・詐称ケース |
| `backend/spec/lib/images/uploader_spec.rb` | 新規 | 渡すオプション・戻り値・例外の包み直し |
| `backend/spec/support/cloudinary.rb` | 新規 | 全 spec 共通の既定スタブ |
| `backend/spec/support/image_fixtures.rb` | 新規 | 各形式のマジックバイト定数とサンプル IO の組み立て |
| `backend/app/controllers/api/smoke_controller.rb` | 新規（**一時**） | 本番スモーク用。確認後に削除 PR |
| `backend/config/routes.rb` | 更新 | スモークルート（**一時**） |
| `render.yaml` | 更新 | `CLOUDINARY_URL`（`sync: false`） |
| `.env.example` | 更新 | `CLOUDINARY_URL` |
| `docs/deployment.md` | 更新 | Cloudinary の本番設定手順 |
| `docs/issues_backlog.md` | 更新 | 3-1 の完了チェック |

**3-1 に含めないもの**: `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` とフロントの URL 組み立てヘルパ。3-1 の時点では表示する画面が無く、使われないコードが残るだけになる。3-2 で `GET /api/posts` が public_id を返すようになったタイミングで、実際の消費者と一緒に入れる。

## 責務分割：なぜ「検証」と「アップロード」を分けるか

利用者が違う。

- **お題投稿（3-2）**: ユーザーが上げたファイル → 5MB / 形式の検証が必要 → その後アップロード
- **生成画像（4-2）**: 画像生成 API が返した自前の PNG → ユーザー入力ではないので 5MB / HEIC のルールは無関係 → 検証なしでアップロード

1 クラスにまとめると 4-2 側で「検証をスキップするフラグ」が生える。分けておけば合成は呼び出し側が 2 行書くだけで済み、それぞれ単独でテストできる。副次的に `Images::Validation` が Cloudinary もネットワークも知らない純粋な判定になるため、spec が速く境界値を網羅しやすい。

## `Images::Validation`

```ruby
result = Images::Validation.call(uploaded_file)
result.valid?      #=> true / false
result.error_code  #=> nil / "image_missing" / "image_too_large" / "image_type_not_allowed"
```

戻り値は `error_code` を 1 つ持つ値オブジェクト（`Data.define`）。`valid?` は `error_code.nil?` の別名。エラーは**最初に見つかった 1 件だけ**を返す（全件収集はしない。フロントの表示は 1 行のトーストで足りるため）。判定順は「存在 → サイズ → 形式」で、サイズを先に見ることで巨大ファイルの中身を読まずに弾ける。

- `MAX_BYTES = 5.megabytes`
- 許可形式: `image/jpeg` / `image/png` / `image/webp` / `image/heic` / `image/heif`
- **形式判定は `Marcel::MimeType.for(io)` でファイル先頭のマジックバイトから行う。クライアント申告の `Content-Type` とファイル名は使わない**（どちらも詐称できるため）。
- 返すのは**エラーコードのみ**。日本語文言は持たない（CLAUDE.md: i18n はフロントに集約）。

### Marcel の判定結果（実測で確認済み）

計画時に marcel 1.2.1 で実際に確認した。許可・拒否したい形式がすべて期待どおりに判定される。

| 与えたマジックバイト | Marcel の判定 | 扱い |
|---|---|---|
| `ftyp` + `heic` ブランド | `image/heic` | 許可 |
| `ftyp` + `mif1` ブランド | `image/heif` | 許可 |
| JPEG (`FF D8 FF E0` + JFIF) | `image/jpeg` | 許可 |
| PNG (`89 50 4E 47 …`) | `image/png` | 許可 |
| WebP (`RIFF` … `WEBP`) | `image/webp` | 許可 |
| PDF (`%PDF-1.4`) | `application/pdf` | 拒否 |
| プレーンテキスト | `application/octet-stream` | 拒否 |

また `Marcel::MimeType.for(io)` は**読み取り後に IO の位置を 0 に戻す**ことも確認した（`StringIO` / `Tempfile` の両方）。判定の直後にそのまま Cloudinary へ渡せる。なお `Validation` 側でも読み取り前に明示的に `rewind` する（呼び出し側が既に読んでいる可能性があるため）。

## `Images::Uploader`

```ruby
Images::Uploader.call(file, kind: :post)
#=> "kotoe/development/posts/a1b2c3d4e5"
```

- `kind:` は `:post`（お題画像）と `:generated`（4-2 の再現画像）の 2 つ。未知の値は `KeyError` で落とす（黙って既定フォルダに入れない）。
- 保存先は `kotoe/#{Rails.env}/#{kind に対応するフォルダ名}`。**環境名をパスに含める**ので、ローカルの検証画像が本番の資産と混ざらない。

  | `kind:` | フォルダ |
  |---|---|
  | `:post` | `kotoe/<env>/posts` |
  | `:generated` | `kotoe/<env>/generated` |

- public_id は Cloudinary の自動生成に任せる。ランダム文字列になるため、他人の画像 ID を推測して総当たりできない。
- `resource_type: "image"` を明示する。既定の `"auto"` は動画や任意バイナリまで受け付けてしまう。
- 失敗時は `Images::Uploader::UploadError` に包んで raise。**扱いは呼び出し側が決める**——3-2 のコントローラは 502 + `image_upload_failed`、4-2 のジョブはリトライに乗せる、と分岐できる。
- 戻り値は public_id の文字列のみ。DB に入れるのはこれだけなので余計な情報を持ち回らない。

## 初期化とフェイルファスト

`config/initializers/cloudinary.rb` で、**本番のみ** `CLOUDINARY_URL` 未設定なら起動時に raise する。`cors.rb` と同じ流儀。黙って壊れて全アップロードが失敗するより、起動時に落ちるほうが原因を追いやすい。development / test は未設定のまま動かす運用のため対象外（test は既定スタブがあるので実キーは不要）。

## テスト

### `spec/lib/images/validation_spec.rb`（Cloudinary を一切触らない）

| ケース | 期待 |
|---|---|
| 5MB ちょうど | 通す |
| 5MB + 1 byte | `image_too_large` |
| jpeg / png / webp / heic | 通す |
| テキスト・PDF | `image_type_not_allowed` |
| **中身はテキストなのに `Content-Type: image/jpeg` と名乗る** | `image_type_not_allowed` |
| nil / 空ファイル | `image_missing` |

太字のケースがこのクラスの存在意義。マジックバイトで判定する設計がここで効いていることを spec で固定する。

**画像ファイルはリポジトリにコミットしない。** 判定はファイル先頭のマジックバイトしか見ないので、本物の画像は不要。`spec/support/image_fixtures.rb` にマジックバイトを定数で持ち、そこから `StringIO` / `ActionDispatch::Http::UploadedFile` を組み立てるヘルパを提供する。

この方が優れている理由:

- **何をテストしているかが diff で読める**。バイナリ fixture は中身が見えず、レビューで検証できない
- サイズ境界（5MB ちょうど / +1 バイト）を、巨大ファイルをコミットせずに作れる（マジックバイト + パディング）
- 3-2 の request spec でも同じヘルパを使い回せる

### `spec/lib/images/uploader_spec.rb`（`Cloudinary::Uploader.upload` をスタブ）

- 渡すオプションが正しいか（`folder` に `Rails.env` が入る、`resource_type: "image"`）
- 戻り値が public_id の文字列になるか
- Cloudinary が例外を投げたら `Images::Uploader::UploadError` に包み直すか

### `spec/support/cloudinary.rb`（全 spec 共通の既定スタブ）

`Cloudinary::Uploader.upload` を全体で既定スタブ化し、ダミーの public_id を返させる。狙いは 2 つ:

1. **テストが絶対にネットワークへ出ない**ことを、個々の spec の書き手の注意力に依存せず保証する
2. 3-2 以降の request spec / job spec が、毎回スタブを書かなくても通る

個別の検証をしたい spec（`uploader_spec` 等）は自分で上書きする。

## 環境設定

| 場所 | 内容 |
|---|---|
| `.env.example` | `CLOUDINARY_URL=` とコメント。**secret を含むのでサーバー専用**である旨を明記 |
| `render.yaml` | `- { key: CLOUDINARY_URL, sync: false }`。値は Render ダッシュボードで手入力 |
| Cloudinary ダッシュボード | 月次クレジットの**使用量アラート**を設定（cloud name 露出に対する保険） |
| `docs/deployment.md` | 上記の本番設定手順を追記 |

ローカルと本番は**同じ Cloudinary アカウント・同じキー**を使い、`kotoe/development/` と `kotoe/production/` のフォルダで分ける。

## 本番スモーク（一時コード）

Render が free プランのため Shell も one-off job も使えない。本番でコードを走らせる手段は「HTTP で叩けるものを置く」しかない。

**一時ルート `POST /api/smoke/cloudinary` を置く。** 要ログイン。固定の小さな画像を Cloudinary に上げて public_id を返すだけ。確認できたら**別 PR で削除**する。

実装上の細部:

- アップロードする画像は**コントローラ内に 1x1 の PNG をバイト列で持つ**。`spec/fixtures/` はテスト用の置き場なので、アプリケーションコードから参照しない。
- `kind: :post` を使う（スモークのために `Images::Uploader` へ使い捨ての `kind` を足さない）。結果として `kotoe/production/posts/` にテスト画像が 1 枚入るので、**確認後に Cloudinary ダッシュボードから手動で削除する**。

代替案とその却下理由:

- `/api/health` に Cloudinary 設定の有無だけ足す → 環境変数が入っているかしか分からず、キーが有効か・実際に上がるかを検証できない。スモークとして弱すぎる。
- 本番スモークを 3-2 まで先送り → 捨てコードは要らないが、3-2 で失敗したときに「Cloudinary の設定なのか Post の実装なのか」の切り分けができなくなる。

一時ルートは「捨てるコードを書く」点で、方針 1 でエンドポイント作成を却下した理屈と表面上は矛盾する。違いは、あちらが「3-2 に吸収されて役目を終える本番機能」なのに対し、こちらは**最初から使い捨てと分かっている数行**であること。8-2a の `/smoke`（#54 で追加 → #56 で削除）と同じ扱いで、削除 PR まで含めて 1 セットとする。

## 完了確認の手順

0. **前提**: Cloudinary アカウントを作成し、ダッシュボードから `CLOUDINARY_URL` を取得して `.env.development`（git 管理外）に設定する。ダッシュボード操作は代行できないためユーザーが実施する。
1. `bundle exec rubocop` / `bundle exec rspec` が green
2. **ローカル**: `rails console` から実画像を 1 枚アップロードし、`kotoe/development/posts/` に入ることと public_id が返ることを目視確認
3. **本番**: Render ダッシュボードで `CLOUDINARY_URL` を設定 → main マージ → デプロイ後、スモークルートを 1 回叩いて `kotoe/production/posts/` に入ることを確認。確認後、その画像を Cloudinary ダッシュボードから削除する
4. スモークルート削除の PR を出す

## 後続 issue への申し送り

- **3-2**: `POST /api/posts` で `Images::Validation` → `Images::Uploader` を合成する。`UploadError` を 502 + `image_upload_failed` に変換する。フロントの `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` と URL 組み立てヘルパをここで入れる（CLAUDE.md の方針上、純粋なユーティリティ関数なので Vitest を後付けする候補）。
- **4-2**: `GenerateImageJob` から `Images::Uploader.call(file, kind: :generated)` を呼ぶ。`UploadError` はジョブのリトライ対象にする。
