# issue 3-1 レビュー指摘と対応

- レビュー実施日: 2026-07-27
- レビュー対象: `f1a059f`（3-1 着手前の main）〜 `f698d1a`（PR #59 の先端）
- 対応ブランチ: `fix/issue-3-1-review-feedback`
- 設計: `docs/superpowers/specs/2026-07-27-issue-3-1-cloudinary-design.md`
- 計画: `docs/superpowers/plans/2026-07-27-issue-3-1-cloudinary.md`

**Critical な指摘は 0 件。** 以下はすべて堅牢性の改善で、いま動いているものが壊れていたわけではない。ただし Important 3 件はいずれも issue 3-2 で顕在化するため、3-2 の着手前に対応した。

## 対応状況

| # | 区分 | 内容 | 状態 |
|---|---|---|---|
| 1 | Important | ファイル以外のパラメータで 500 | ✅ 対応 |
| 2 | Important | `Uploader` が rewind しない | ✅ 対応 |
| 3 | Important | テストのネットワーク遮断が 1 メソッドのみ | ✅ 対応 |
| 4 | Minor | `fetch("public_id")` が rescue の外 | ✅ 対応 |
| 5 | Minor | 既定スタブが `kind` を無視 | ✅ 対応 |
| 6 | Minor | `image_bytes` の負数 | ✅ 対応 |
| 7 | Minor | `marcel` の宣言漏れ | ✅ 対応 |
| 8 | Minor | `deployment.md` の番号重複 | ✅ 対応 |
| 9 | Minor | 「読まずに弾く」コメントが誇大 | ✅ 対応 |

143 examples green / rubocop 0 offenses。

---

## Important（着手時に直す）

### 1. `Images::Validation` がファイル以外のパラメータで 500 になる

**場所**: `backend/lib/images/validation.rb` の `missing?` / `detected_content_type`

`params[:image]` の型はクライアントが決められる。ファイルパートではなく普通のフォーム値として
`image=foo` を送られると `NoMethodError` になり、issue 3-2 で 500 を返してしまう。
`image_missing` として綺麗に弾くべき。

| 入力 | 現在の結果 |
|---|---|
| `"hello"`（String） | `NoMethodError: undefined method 'rewind'` |
| `["a"]`（Array） | `NoMethodError` |
| `ActionController::Parameters` | `NoMethodError: undefined method 'size'` |
| `size` が nil を返すオブジェクト | `image_missing`（`.to_i` が効いている） |

**修正案** — 型ガードはルールを持つクラス側に置く（コントローラに漏らさない）。

```ruby
def missing?
  return true unless @file.respond_to?(:read) && @file.respond_to?(:rewind) && @file.respond_to?(:size)

  @file.size.to_i.zero?
end
```

spec を1本足す: `expect(described_class.call("hello").error_code).to eq("image_missing")`

### 2. `Images::Uploader` が rewind しない（画像が無言で壊れうる）

**場所**: `backend/lib/images/uploader.rb` の `upload_to`

**検証済み**: cloudinary 2.4.5 の `lib/cloudinary/utils.rb:1324-1338` `handle_file_param` は
**`StringIO` の分岐（1332行目）でしか `rewind` しない**。`Tempfile` と
`ActionDispatch::Http::UploadedFile` は 1334 行目の `respond_to?(:read)` 分岐に落ち、
現在位置から読まれる。

いまは `Images::Validation` の後で Marcel が位置を 0 に戻すので動いているが、
**それは transitive dependency の文書化されていない挙動に依存している**。
呼び出し側が1回でも先に読むと、例外なしで切り詰められた画像が Cloudinary に上がる。

**修正案**:

```ruby
def upload_to(target)
  @file.rewind if @file.respond_to?(:rewind)
  Cloudinary::Uploader.upload(@file, folder: target, resource_type: "image")
rescue StandardError => e
  raise UploadError, "Cloudinary upload failed: #{e.class}"
end
```

### 3. テストが実キーを持ったまま走り、塞いでいるのは 1 メソッドだけ

**場所**: `backend/spec/support/cloudinary.rb`

`docker-compose.yml` は `RAILS_ENV` に関係なく `backend/.env.development` を渡すため、
**spec 実行中も SDK に本番と同じキーが設定されている**（`RAILS_ENV=test` で
`Cloudinary.config.api_key.present? == true` を確認済み）。CI は `CLOUDINARY_URL` を
設定していないので安全。

いまのスタブは `Cloudinary::Uploader.upload` 1本のみ。`destroy` / `rename` /
`upload_large` / `unsigned_upload` などは素通りで、**共有アカウントの本番資産を
消しうる**。

**検証済み**: `Cloudinary::Uploader.call_api`（`uploader.rb:343`）が 13 個の公開メソッドの
共通出口。例外は `exists?` のみ（`utils.rb:153` で Faraday を直接使う）。

**修正案** — `upload` の既定スタブは残しつつ、`call_api` を「呼ばれたら落ちる」バックストップに
する。素通りして偽のデータを返すより、**うるさく失敗する**方がよい。

```ruby
RSpec.configure do |config|
  config.before do
    # 意図せず本物のAPIに出ようとしたら、その場で落として気づけるようにする。
    allow(Cloudinary::Uploader).to receive(:call_api).and_raise(
      "spec が Cloudinary の実APIを叩こうとしました。呼ぶメソッドを明示的にスタブしてください。"
    )

    allow(Cloudinary::Uploader).to receive(:upload).and_return(...)
  end
end
```

---

## Minor（余裕があれば）

| # | 場所 | 内容 |
|---|---|---|
| 4 | `uploader.rb:31` | `response.fetch("public_id")` が rescue の外なので、レスポンス形状が変わると 502 ではなく 500 になる。`response["public_id"] \|\| raise(UploadError, "...")` にすれば `kind` の `KeyError` と区別したまま解決する |
| 5 | `spec/support/cloudinary.rb:15` | 既定スタブが `kind` に関係なく `kotoe/test/posts/stubbed` を返す。4-2 の job spec が「generated の public_id を保存した」を posts パスのまま green にしてしまう。`options[:folder]` から導出する |
| 6 | `spec/support/image_fixtures.rb:45` | `bytesize` がマジックバイトより小さいと `ArgumentError: negative argument`。将来「4バイトの壊れたファイル」を試すときに引っかかる |
| 7 | `backend/Gemfile` | `marcel` が直接依存なのに宣言がない（activestorage 経由で入っている）。`config/application.rb` から `active_storage/engine` を外すと実行時に壊れる。`gem "marcel"` の1行を足す |
| 8 | `docs/deployment.md:41-42` | 番号付きリストの `4.` が重複している（Cloudinary の節を編集したときに混入） |
| 9 | `validation.rb:34` のコメント | 「巨大なファイルの中身を読まずに弾くため」は Marcel については正しいが、**Rack が既に全body をテンポラリファイルにバッファし終えている**ため、転送量の節約にはならない。コメントを実態に合わせる。Render のスレッド占有を本当に抑えたいなら 3-2 でエッジのボディサイズ上限が必要 |

---

## 計画ドキュメントとの差異（意図的・記録のみ）

`docs/superpowers/plans/2026-07-27-issue-3-1-cloudinary.md` の Task 1 は
「ルートの `.env.example` に `CLOUDINARY_URL` を足す」と書いてあるが、実装では
`backend/.env.example` を新設し `JWT_SECRET_KEY` ごと移した。

これは**ユーザーが明示的に選んだ**変更（`docker-compose.yml` に issue 0-1 時点で
書かれていた予告コメントの実装）。計画ドキュメント側にも「実装時にこの計画から
変えたこと」として追記済み。

## レビューを受けての気づき（プロセス面）

- 今回のレビューは **executing-plans スキルの最終ステップ（finishing-a-development-branch）を
  飛ばしたため、PR #58 のマージ後**になった。指摘に Critical が無かったので実害は出なかったが、
  次回はマージ前にレビューを挟む。
- レビューの主張のうち技術的に重い 2 件（gem が `StringIO` しか rewind しない、
  `call_api` が共通出口）は、**鵜呑みにせず gem のソースを実際に読んで裏を取った**。
  どちらも正しかった。`utils.rb:1324-1338` と `uploader.rb:343`。
