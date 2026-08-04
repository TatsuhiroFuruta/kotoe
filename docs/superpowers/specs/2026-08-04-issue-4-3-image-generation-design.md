# issue 4-3 設計：画像生成APIの本接続

- Issue: `docs/issues_backlog.md` の 4-3
- Branch: `feature/issue-4-3`
- 前提: 4-2（描写の保存・生成／画像はダミー）まで完了。背骨は `… → 4-1 → 4-2 → 4-3 → 5-1 → …`
- **着手前に読むこと**: `docs/README.md` の「Render 無料枠のメモリ実測」（4-2 の指示）

## 目的

固定のダミー画像を、実際の描写文から生成した画像に差し替える。4-2 が
「差し替わるのは画像の出どころだけ」という形に整えてあるので、変更の中心は
`GenerateImageJob#upload_dummy_image` の置き換えになる。

あわせて、4-2 が「実費が発生する回に置くのが自然」として明示的にこの issue へ送った
**サービス全体のコストガード**をここで入れる。

## スコープ

**含む**

- `Images::Prompt`（描写文 → プロンプト文字列）
- `Images::Generator`（プロバイダの選択と Tempfile の受け渡し）
- `Images::Generators::Openai`（`POST /v1/images/generations` を Net::HTTP で叩く）
- `Images::Generators::Dummy`（4-2 の固定 PNG。ローカル / CI / E2E 用）
- `GenerateImageJob` のエラー分類の拡張（リトライの可否を例外の型で表す）
- マイグレーション1本（`attempts.failure_reason`）
- キルスイッチ（`KOTOE_GENERATION_ENABLED`）とサービス全体の1日上限（既定 50 枚）
- 起動時チェック（プロバイダが openai なのに `OPENAI_API_KEY` が無ければ raise）
- webmock の追加（`group :test` のみ）
- RSpec（model / lib / job / request）
- ドキュメント更新（README・deployment・screen_and_api_design・issues_backlog）
- 本番スモーク（実キーでの疎通、メモリ実測、実エラー文字列の採取）

**含まない**

- `similarity_score` の実値化（8-4 の CLIP）
- 生成画像の NSFW チェック（5-3）
- ダウンロード導線そのもの（マイルストーン7）。ここでは 7-3 の URL ヘルパに向けた
  規約（「ダウンロードURLは `f_png,fl_attachment` 必須」）を書き残すだけ
- フロントの画面（マイルストーン7）
- 生成の可否・回数の判定ロジックの作り直し（4-2 の `Attempts::Generation` に追加するだけ）

## 方針の確定事項（ユーザー合意済み）

### 1. モデルは `gpt-image-2` / quality `low` / 1024×1024

2026-08-04 時点の公式ドキュメントの単価（1024×1024）：

| モデル | low | medium | high | テキスト入力 |
|---|---|---|---|---|
| gpt-image-1-mini | $0.005 | $0.011 | $0.036 | $2/1M tokens |
| **gpt-image-2** | **$0.006** | $0.053 | $0.211 | $5/1M tokens |
| gpt-image-1.5 | $0.009 | $0.034 | $0.133 | $5/1M tokens |

`gpt-image-1` は **2026-10-23 に停止**するため選択肢から外した。

README が書いた当初の推奨は「GPT Image 1 Mini の Low」だったが、現在は最新フラッグシップの
gpt-image-2 の low が $0.006 で mini の low($0.005) とほぼ同額である。**Kotoe の面白さは
「描写文にどれだけ忠実に再現されるか」なので、プロンプト追従性は商品価値そのもの**。
差額 $0.001/枚 を払う価値があると判断した。

描写文（最大1,000文字）のテキスト入力を含めて **1枚あたり約 $0.011**。
想定 5 人 × 3 回/日 × 30 日 ＝ 450 枚/月 で **約 $5/月**。

**モデル・品質・出力形式・圧縮率は環境変数にせず定数にする。** これらは「ダッシュボードで
気軽に切り替える設定」ではなく、コストと出力品質を左右するプロダクトの判断なので、
変更が PR として履歴に残るべきものである。

### 2. 出力形式は WebP・`output_compression: 90`

**gpt-image 系は base64（`b64_json`）でしか画像を返さない。** URL 受け取りは非対応。
README の「生成 API が URL を返すなら、その URL を Cloudinary に取り込ませる経路が使える」
というメモリ削減案は**成立しない**（README を訂正する）。

したがって画像は必ず Ruby のヒープを通る。1 枚あたりの経路は次のとおりで、
**瞬間ピークは画像サイズの約4倍**になる。

```
HTTP レスポンス本文（base64 = 画像の1.33倍）
  → JSON.parse でもう1コピー
  → Base64.decode64 でバイナリ1コピー
  → Cloudinary の multipart 本文でもう1コピー
```

| 出力形式 | 画像サイズ | 瞬間ピーク（1枚） |
|---|---|---|
| PNG（既定・可逆） | 約 1.0〜1.5 MB | 約 5〜7 MB |
| **WebP（圧縮90）** | **約 0.3 MB** | **約 1〜2 MB** |
| WebP（圧縮85） | 約 0.15 MB | 約 0.5〜0.9 MB |

**本番の余裕は 37 MB しかない**（4-2 の実測：生成2回後で 475 MB / 512 MB）。
圧縮 85 ではなく 90 を選んだのは、将来のダウンロード導線を見据えて画質側に寄せたため。

**Cloudinary のコストでも WebP が有利。** 無料枠は 25 クレジット/月で、
1 クレジット ＝ 変換1,000回 ＝ ストレージ1GB ＝ 帯域1GB。変換は「派生アセットが初めて
作られたとき」に1回だけ数えられ、同じ変換URLへの2回目以降は加算されない。
変換と帯域は毎月リセットされるが、**ストレージだけは在庫で積み上がる**。

450枚/月・12ヶ月時点の試算（1枚を10回閲覧と仮定）：

| | WebP(90) 0.3 MB/枚 | PNG 1.5 MB/枚 |
|---|---|---|
| ストレージ（累積 1.6 GB / 8.1 GB） | 1.6 クレジット | 8.1 クレジット |
| 帯域 | 1.35 クレジット | 6.75 クレジット |
| ダウンロード用 `f_png` 変換 | 0.45 クレジット | 0（不要） |
| **合計** | **約 3.4 / 25** | **約 15 / 25** |

**「PNG で保存して変換を避ければ安い」は成り立たない。** 一覧のサムネイルや比較ビューでは
どちらの保存形式でも変換（`f_auto,q_auto` 等）を使うため、変換の発生は形式に依存しない。
そして枠を先に食うのは変換ではなくストレージと帯域である。

**ダウンロード導線への影響（マイルストーン7への申し送り）**：Cloudinary は配信時に形式を
変換できるので、WebP で保存していても `f_png,fl_attachment` を付けたURLで PNG として
ダウンロードさせられる。**7-3 の Cloudinary URL ヘルパの規約として「ダウンロードURLには
必ず `f_png` / `f_jpg` を付ける」を書き残す**。これを忘れて保存URLをそのまま `download`
属性に渡すと `.webp` が落ち、macOS の Preview で開けない環境がある。

### 3. `moderation` は既定の `"auto"` のまま

公開 UGC なので緩める理由がない。

### 4. プロンプトは最小限の固定接頭辞 ＋ 描写文

```
以下の描写だけをもとに画像を1枚生成してください。
描写に書かれていない要素を足さないこと。文字・透かし・枠は描き込まないこと。

{description}
```

- 元画像やお題タイトルは**渡さない**（渡すとゲームが成立しない）
- 日本語のまま投げる。gpt-image 系は多言語対応で、翻訳を挟むと費用が増え意味もずれる
- 接頭辞を置くのは公平性のためではなく**ノイズの除去**のため。素の描写文だけだと画像内への
  文字の描き込みや勝手なイラスト調への寄せが混ざり、「描写の忠実さを競う」という評価軸が
  ブレる。接頭辞は全ユーザーに等しくかかるので公平性は損なわれない
- 接頭辞のトークンは1枚あたり $0.0003 程度で誤差

### 5. ローカル / CI はダミー、本番のみ実 API

`KOTOE_IMAGE_PROVIDER`（`dummy` | `openai`）。既定は **production なら `openai`、それ以外は `dummy`**。

8-1 の E2E がコアループ（ログイン→描写→生成→比較）を回すため、実 API を叩くと
E2E のたびに課金され、しかも生成は最大2分かかるのでテストが遅く不安定になる。
一方でプロンプトの調整時にはローカルで本物を確かめたいので、環境変数で上書きできるようにする。

### 6. 失敗しても生成枠は戻さない

CLAUDE.md のドメイン規則は「**削除しても**回数は戻さない」で、失敗時には触れていないが、
**全ケースで戻さない**と決めた。

`content_policy` だけ戻す案は実費がほぼゼロなので UX 上は優しいが、**弾かれる文章を
投げ続ければ何回でも外部 API を叩ける穴が開き、1日3回の上限が実質無効になる**。
1回あたりの実費が小さくても、上限のないループが作れること自体がリスクである。

上限は3回なので1回失っても当日あと2回試せるうえ、`failure_reason` を返すぶん
「ポリシーに触れたので生成されませんでした（残り2回）」と正直に伝えられる。

`generated_at` が入っている ＝ 枠を1つ使った、が例外なく成り立つ状態を保つ。

### 7. コストガードは3層。**穏やかなガードが先に効くように値を決める**

**OpenAI の monthly budget は 2026 年現在、遮断ではなく通知である。** 上限に達しても
メールとダッシュボードのバナーが出るだけでキーは動き続け、課金も積み上がる。
**唯一の本当のハードストップは「前払いクレジット＋オートリチャージ off」**。

| 層 | 値 | 効いたときに起きること |
|---|---|---|
| **アプリ側の1日上限** | 50 枚/日 | `generate` が **503 で即座に断られる**。ジョブは積まれず、**生成枠も消費されない** |
| 予算アラート | $5（+ 80%/95% 通知） | メール通知のみ。遮断しない |
| 前払いクレジット | **$20**・オートリチャージ off | ジョブは走り、API が 429 を返し、attempt が **failed** になる。枠は戻らない |

**前払いを 50枚/日 の月額最悪値（$16.5）より上に置くのが要点。** 下に置くと、アプリ側の
穏やかなガードに達する前に残高が尽き、乱暴なほうの失敗が先に起きる。$20 なら残高切れは
「アプリ側のガードをすり抜けるバグがあったとき」だけの最後の砦になる。

予算アラートを $5 にするのは、遮断しない以上低く置いて損がなく、$5 が想定利用
（5人 × 3回 × 30日）ちょうどなので**想定を超えた瞬間に気づける**ため。

利用者数と最悪コストの対応：

| 利用者数 | 最大生成枚数/日 | 月額 |
|---|---|---|
| 5人（想定） | 15枚 | 約 $5 |
| 20人 | 60枚 | 約 $20 |
| 50人 | 150枚 | 約 $50 |
| 100人 | 300枚 | 約 $99 |

Kotoe は誰でも登録できるため、1人3回の上限だけでは総額が青天井になる。これが
サービス全体の上限を置く理由。

### 8. クライアントは自前 PORO ＋ Net::HTTP（gem を足さない）

`Gemfile.lock` を見ると Faraday と Net::HTTP は cloudinary gem 経由で既にロード済み。
公式 `openai` gem（0.77.0）の依存自体は軽い（base64 / cgi / connection_pool）が、
Stainless 生成の SDK なので Responses / Chat / Assistants / Realtime など**全エンドポイント
ぶんのコードを読み込む**。今回使うのは `POST /v1/images/generations` の1本だけであり、
**余裕 37 MB の本番で不要な数千ファイルを Puma のベースラインに載せるのは割に合わない**。

代償は API 変更を自分で追うこと。エンドポイントが1本なので許容する。

## 既存コードの調査結果（設計の根拠）

- `GenerateImageJob` は `upload_dummy_image` で `lib/assets/dummy_generated.png` を
  `Images::Uploader.call(file, kind: :generated)` に渡すだけ。差し替え対象はここ1か所
- 失敗の二段構え（`rescue_from(StandardError)` を**先**、`retry_on UploadError` を**後**）が
  実装済み。ActiveJob はハンドラを後勝ちで探すため宣言順に意味がある（4-2 で job spec に固定済み）
- 冪等性は `Attempt.kept.generating.find_by(id:)` の1行で担保済み
- `Attempts::Generation` が上限チェック → status 更新 → enqueue を `user.with_lock` の
  トランザクションで囲んでいる。4-3 で作り直す必要はなく、ガードを足すだけ
- `Images::Uploader` は `kind: :generated` のフォルダ（`kotoe/<env>/generated`）を持ち、
  `@file.rewind` と `UploadError` への一本化も済んでいる。**変更不要**
- `attempts` テーブルに `generated_at` と `[user_id, generated_at]` インデックスが 4-2 で追加済み
- `Attempt` の `status` は enum（draft / generating / published / failed）
- `AttemptSerializer` は `with_likes_count` が SELECT 句で付ける別名属性に依存する。
  コントローラは `attempt_json` でそのスコープ経由で取り直している
- コントローラの `render_error(code, extra = {})` は 422 固定。503 を返すには分岐が要る
- `config/initializers/cloudinary.rb` が `CLOUDINARY_URL` 未設定時に起動を落とす前例がある
- `spec/support/cloudinary.rb` が全 spec で Cloudinary を塞いでいる（`call_api` を raise、
  `upload` は既定値を返す）。**HTTP レベルのスタブ機構は無い**
- `config/queue.yml` の `workers.threads` は 3

## アーキテクチャ

```
GenerateImageJob
  ├─ Images::Prompt.call(description)  … 描写文 → プロンプト文字列
  ├─ Images::Generator.call(prompt) {} … プロバイダを選んで画像を作り、File を yield
  │    ├─ Images::Generators::Openai   … POST /v1/images/generations（Net::HTTP）
  │    └─ Images::Generators::Dummy    … 4-2 の固定PNGを返す
  └─ Images::Uploader.call(file, kind: :generated)  … 変更なし
```

`Images::Prompt` は `Attempt` ではなく**描写文の文字列だけ**を受け取る。プロンプトの組み立ては
モデルの都合を知る必要がないため、依存を文字列1つに絞れる。

**`Images::` 名前空間に揃える。** 既に `Images::Uploader` / `Images::Validation` があり、
「画像そのものを扱う道具」の置き場として一貫する。生成の可否・回数の判定（ドメインのルール）は
引き続き `Attempts::Generation` の担当で、境界を混ぜない。

**受け渡しは Tempfile をブロックで yield する。**

```ruby
Images::Generator.call(prompt) do |file|
  Images::Uploader.call(file, kind: :generated)
end
```

戻り値で Tempfile を返すと呼び出し側が `ensure` で後始末する責任を負い、忘れると Render の
一時ディスクに残る。ブロック形式なら消し忘れが起こりえない。ディスクに落とすのは、
デコード後のバイナリを、Cloudinary が multipart 本文を組み立てる前に Ruby のヒープから
解放するため。

契約は2つ。**`Images::Generator.call` はブロックの戻り値をそのまま返す**（ジョブは
`public_id` を受け取る）。**両プロバイダとも、読み出し位置が先頭にある File 互換の
オブジェクトを yield する**（openai は Tempfile、dummy は `lib/assets/dummy_generated.png` を
開いた File）。ジョブから見て両者の区別がつかないことが、ローカルと本番で同じ経路を
通すための条件になる。

**プロバイダの切り替えを知っているのは `Images::Generator` の1か所だけ。** ジョブから見れば
「プロンプトを渡すと画像ファイルが来る」だけになる。

### `config/queue.yml` の `workers.threads` は 3 のまま据え置く

README は削減候補として「threads を 1 に下げる」を挙げているが、4-2 の実測（+89 MB / +24 MB）は
**15 KB のダミー画像**で観測された値である。つまりあの増分は画像データではなく
copy-on-write が解けたぶん（Ruby / Rails のページ）であり、スレッド数を減らしても減らない。

本物の生成で増えるのは主に「Net::HTTP・JSON・Base64 のコードパスに初めて触れることによる
COW 解消」で、これもスレッド数と無関係。一方 WebP(90) なら同時実行1本あたり 1〜2 MB なので、
3 並列でも 3〜6 MB にとどまる。

生成は最大2分かかるため threads=1 にすると**後続のユーザーが2分待たされる**。
据え置きとし、本番スモークで `memory.peak` が危なければ下げる。

## エラーの分類

`Images::Generator` は失敗を**リトライすべきかどうか**で2つの例外クラスに分ける。
判断をジョブ側の `if` に書かず例外の型で表すことで、ActiveJob の宣言的なハンドラに乗る。

```ruby
Images::Generator::Error           # code を持つ基底クラス
  ├─ TransientError                # 時間を置けば直る
  └─ PermanentError                # 同じ入力なら必ずまた失敗する
```

| 応答 | 分類 | `failure_reason` |
|---|---|---|
| 400（ポリシー違反） | Permanent | `content_policy` |
| 400（その他）・401・403 | Permanent | `api_error` |
| 429（レート制限） | Transient | `rate_limited` |
| 429（`insufficient_quota` ＝ 残高切れ） | Permanent | `api_error` |
| 5xx | Transient | `api_error` |
| タイムアウト・接続断 | Transient | `api_error` |
| Cloudinary の障害（4-2 で実装済み） | — | `upload_failed` |
| 想定外の例外（コードのバグ） | — | `internal_error` |

判定に使うエラー文字列（`error.code` / `error.type`）は**実物のレスポンスを見るまで確定
できない**。**認識できない値は `api_error` に倒す**フォールバックを必ず置き、本番スモークで
実際の文字列を採取して spec に固定する。

エラー本文をそのまま例外メッセージに含めない（`Images::Uploader` が
`"Cloudinary upload failed: #{e.class}"` にとどめているのと同じ理由。ログに秘密情報を
出さない）。プロンプト（＝ユーザーの描写文）もログに出さない。

## `GenerateImageJob`

```ruby
def perform(attempt_id)
  attempt = Attempt.kept.generating.find_by(id: attempt_id)
  return if attempt.nil?

  public_id = Images::Generator.call(Images::Prompt.call(attempt.description)) do |file|
    Images::Uploader.call(file, kind: :generated)
  end

  attempt.update!(generated_image_public_id: public_id, status: :published)
end
```

ハンドラは 4-2 の構造をそのまま拡張する（`rescue_from(StandardError)` を先に宣言する理由も維持）。

```ruby
rescue_from(StandardError)      { mark_failed(id, "internal_error"); raise }   # 先に宣言
discard_on   PermanentError     { mark_failed(id, error.code) }                # 再試行しない
retry_on     TransientError,        attempts: 2 { mark_failed(id, error.code) }
discard_on   Uploader::UploadError  { mark_failed(id, "upload_failed") }       # 下記のとおり
```

**生成側のリトライ回数を 2 にとどめるのはコストの理由。** タイムアウトは「API が課金対象の
生成を終えたのに、こちらが待ちきれなかった」場合を含む。この状態でリトライすると
**同じ1枠に対して2回課金**される。3回なら最大3倍。あわせて `read_timeout` は 150 秒と
長めに取り（ドキュメントは「複雑なプロンプトで最大2分」）、そもそもタイムアウトさせない方に寄せる。
`open_timeout` は 10 秒。

**Cloudinary の失敗はジョブごと再実行してはいけない**（実装レビューで発見。当初は 4-2 の
`retry_on UploadError, attempts: 3` をそのまま残す設計だった）。4-2 ではアップロードするのが
ディスク上のダミー PNG だったため再実行は無料だったが、4-3 では**生成とアップロードが同じ
ジョブの中にある**ので、ジョブを再実行すると OpenAI の生成もやり直され、**1枠に対して実費が
3倍**かかる（実測で確認）。

これは単なる無駄ではなく、**コストガードの前提を壊す**。「アプリ 50 枚/日 ＝ 月額最悪 $16.5 <
前払いクレジット $20」という3層の設計は **1 枠 ＝ 1 生成**を前提にしており、3 倍に増幅すると
最悪値が $49.5/日 になって、穏やかなガードより先に残高が尽きる。

したがって**アップロードだけをジョブの中で再試行する**（`GenerateImageJob#upload_with_retry`、
`UPLOAD_ATTEMPTS = 3` / `UPLOAD_RETRY_WAIT = 3` 秒）。画像はもう手元にあるので上げ直すのは無料で、
同じ File を渡し直せるのは `Images::Uploader` が毎回 `rewind` するため。使い切った `UploadError`
はジョブレベルで `discard_on` し、終端にする。「Cloudinary が何度失敗しても生成は 1 回」を
job spec で固定する。

**`discard_on` を使うのは、ポリシー違反がコードのバグではないため。** 4-2 が Cloudinary の
恒久障害を「ジョブ自体は成功扱いにしてログに残す」と決めたのと同じ考え方で、
`solid_queue_failed_executions` を本当に人が見るべきものだけに保つ。

`mark_failed` は引数に `failure_reason` を取る形に変える。`kept` で絞らないこと
（生成中に削除された attempt も終端状態にする）と、`generated_at` に触れないこと
（枠は戻さない）は 4-2 のまま維持する。

**状態遷移そのものは 4-2 から変えない。** `failed` は終端で、再試行は新しい下書きを作る
（同じ attempt を再生成しない）。これにより「1 attempt = 最大 1 回の生成」が保たれ、
消費の記録が `generated_at` の1カラムで正確に数えられる、という 4-2 の前提が維持される。

## データモデルの変更

```ruby
add_column :attempts, :failure_reason, :string
```

インデックスは張らない（検索条件にならない）。

```ruby
FAILURE_REASONS = %w[content_policy rate_limited api_error upload_failed internal_error].freeze
validates :failure_reason, inclusion: { in: FAILURE_REASONS }, allow_nil: true
```

**enum にしない。** `status` を enum にしたのは状態機械でスコープに意味があるからだが、
`failure_reason` は分岐にも一覧にも使わない付随情報である。enum にすると `Attempt.api_error`
のようなスコープが生えて紛らわしい。

`AttemptSerializer` に `failure_reason` を足す。`similarity_score` と同じく常に返し、
失敗時以外は `nil`。

## API 契約の変更

### `POST /api/attempts/:id/generate`

`Attempts::Generation` に2つのガードを追加する。既存の `Result` の形は変えない。

```ruby
def call
  return Result.new(error_code: "generation_disabled", limit: nil) unless self.class.enabled?
  return Result.new(error_code: "attempt_not_draft", limit: nil) unless @attempt.draft?

  @attempt.user.with_lock { start_generation }   # この中で全体上限 → 個人上限 の順に見る
end
```

全体上限のカウントは `Attempt.where(generated_at: Time.zone.now.all_day).count`。
既存インデックス（`[user_id, generated_at]`）には乗らずシーケンシャルスキャンになるが、
**1日に数十回しか走らず、テーブルは月450行しか増えない**。専用インデックスは張らず、
必要になれば issue 3-4（パフォーマンス）で計測して判断する。

ユーザー行のロックはユーザー間を直列化しないため、全体上限は同時実行で数枚オーバーしうる。
桁が守れれば目的は果たせるので許容する。

**HTTP ステータスは「誰の問題か」で分ける。**

| エラーコード | ステータス | 追加情報 |
|---|---|---|
| `attempt_not_draft`（既存） | 422 | — |
| `generation_limit_reached`（既存・個人） | 422 | `limit`, `resets_at` |
| `service_generation_limit_reached` | **503** | `resets_at` |
| `generation_disabled` | **503** | — |

422 は「あなたの操作の問題」、503 は「こちら側の都合」。フロントは前者を訂正可能なエラーとして、
後者を時間を置いて再訪する案内として出し分けられる。

全体上限では `limit`（50）を返さない。サービスの容量は内部の事情で、ユーザーが行動を
変えられる情報ではないため。`resets_at` は個人上限と同じく JST 翌0時を UTC の ISO8601 で返す。

コントローラは `render_error` に 503 を返す経路を足す。コード → ステータスの対応は
コントローラが持つ（PORO はルールを、コントローラは HTTP への翻訳を担当する、という 4-2 の分担を維持）。

### `GET /api/attempts/:id`

応答の `attempt` に `failure_reason` が加わる（`failed` 以外は `null`）。
文言は返さない。フロントの辞書で翻訳する（CLAUDE.md の i18n 方針）。

## 環境変数（すべてサーバー側のみ）

| 変数 | 既定 | 用途 |
|---|---|---|
| `OPENAI_API_KEY` | なし | **秘密**。Render に手入力。フロントには絶対に出さない |
| `KOTOE_IMAGE_PROVIDER` | production は `openai`、他は `dummy` | ローカル / CI をダミーで回す |
| `KOTOE_GENERATION_ENABLED` | `true` | キルスイッチ。`false` / `0` / `off` で停止 |
| `KOTOE_SERVICE_DAILY_GENERATION_LIMIT` | `50` | 全体の1日上限 |
| `KOTOE_DAILY_GENERATION_LIMIT`（既存） | `3` | 1ユーザーの1日上限 |

ENV はクラス本体ではなくメソッド内で読む（`Attempts::Generation.daily_limit` と同じ理由。
定数に畳むと起動時の値で固まり spec から差し替えられない）。数値は正の整数でなければ
既定値に落とす（環境変数を空にしただけで全ユーザーの生成が止まるのを防ぐ）。

**起動時チェック**：プロバイダが `openai` なのに `OPENAI_API_KEY` が無ければ起動時に raise する。
`config/initializers/cloudinary.rb` が `CLOUDINARY_URL` について同じことをしている。
設定漏れのままデプロイが green に見える状態を防ぐため。

## 依存の追加

`webmock`（`group :test` のみ）。**本番のメモリには影響しない。**

自前で Net::HTTP を叩く以上、リクエストの組み立て（URL・ヘッダ・ボディ）そのものが我々の
コードであり、そこを検証したい。webmock なら `disable_net_connect!` で「全 spec が外部へ
出ない」安全網も同時に手に入る（`spec/support/cloudinary.rb` が Cloudinary について
用意しているのと同じ性質を、HTTP レベルで得られる）。

## テスト

| 置き場所 | 主に守るもの |
|---|---|
| `spec/models/attempt_spec.rb` | `failure_reason` の許容値と `nil` 許可 |
| `spec/lib/images/prompt_spec.rb` | 接頭辞が付き、描写文がそのまま後ろに入る |
| `spec/lib/images/generator_spec.rb` | プロバイダの選択（env と Rails.env）／Tempfile が yield され、ブロックを抜けたら消えている |
| `spec/lib/images/generators/openai_spec.rb` | リクエストの組み立て（model・size・quality・output_format・output_compression・moderation）／b64 のデコード／**ステータス→例外クラス＋code の対応表**／未知のエラーが `api_error` に倒れること／タイムアウトが `TransientError` になること |
| `spec/lib/attempts/generation_spec.rb` | キルスイッチ／全体上限／既存のケースが壊れていないこと |
| `spec/jobs/generate_image_job_spec.rb` | 成功→published／`PermanentError` は**リトライせず** failed＋code／`TransientError` は2回で failed／`UploadError` はジョブを再実行せずアップロードのみ3回試して failed／**Cloudinary が何度失敗しても生成は1回**／想定外は `internal_error` かつ再送出／**ハンドラの宣言順** |
| `spec/requests/api/attempts_spec.rb` | 503 の2種（`generation_disabled` / `service_generation_limit_reached`）と `resets_at`／`failure_reason` が応答に載ること |

E2E（Playwright）は 8-1 の担当でこの issue では書かない。E2E は `KOTOE_IMAGE_PROVIDER=dummy`
で回る（方針5）。フロント単体テストは CLAUDE.md のテスト戦略どおり MVP では導入しない。

## 本番スモーク（マージ後、手作業）

1. Render に `OPENAI_API_KEY` と `KOTOE_IMAGE_PROVIDER=openai` を設定
2. OpenAI 側で前払いクレジット $20 を購入し、**オートリチャージを off**、予算アラートを
   $5（80% / 95% 通知）に設定
3. 実際に generate → `published` になり、Cloudinary の `kotoe/production/generated` に
   WebP が上がることを確認
4. **`GET /api/health` の `memory.peak` を生成前 / 1回後 / 2回後で記録**。4-2 の 475 MB から
   どれだけ増えたか。危なければ `workers.threads` を下げる
5. **ポリシー違反を意図的に起こし、実際の `error.code` / `error.type` の文字列を採取して
   spec に固定する**（設計時点では推測でしかない箇所）
6. `KOTOE_GENERATION_ENABLED=false` にして 503 が返ることを確認し、`true` に戻す
7. スモークデータの後始末（8-2a から持ち越しているぶんも含めて）

結果は `docs/README.md` の無料枠の節に追記する。

## ドキュメントの更新

- `docs/README.md`
  - 「画像生成 API の選定」を決定内容（gpt-image-2 / low / WebP90）に更新
  - **「生成 API が URL を返すなら、その URL を Cloudinary に取り込ませる」というメモリ削減案は
    成立しない**（b64 のみ）ことを訂正
  - 「Render 無料枠のメモリ実測」に 4-3 の実測を追記
- `docs/deployment.md` … `OPENAI_API_KEY`、前払い $20・オートリチャージ off・アラート $5、
  キルスイッチの使い方
- `docs/screen_and_api_design.md` … `service_generation_limit_reached` / `generation_disabled` と
  503、`failure_reason`
- `docs/issues_backlog.md` … 4-3 のチェックを埋める。7-3 への申し送り
  （ダウンロードURLは `f_png,fl_attachment` 必須）を書き足す
