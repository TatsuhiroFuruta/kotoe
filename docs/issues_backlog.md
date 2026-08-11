# Kotoe 実装 issue バックログ

ER図・画面・API設計をもとに、実装を**依存関係の順**にマイルストーン／issue へ分解したもの。

## 使い方（このチャット → Claude Code の分担）
- 各 issue は Claude Code にそのまま渡せる粒度（目的・タスク・完了条件）で書いてある。
- **1 issue = 1 ブランチ = 1 PR** を基本に、上から順（依存順）に進める。
- 実装前に、リポジトリの `CLAUDE.md` に規約を書いておく（Issue 0-2 参照）。
- 🟢=MVP必須 / 🔵=本リリース / ⚪=拡張。まず🟢を上から。

---

## マイルストーン 0：プロジェクト基盤

### 🟢 0-1. Rails APIプロジェクトと Docker 開発環境の作成
- 目的：Rails(API)・PostgreSQL・Next.js が起動する開発環境を用意する。
- 依存：なし（最初）
- タスク：
  - [x] Rails 8 を `--api` で新規作成、Ruby/Rails バージョン固定
  - [x] `docker-compose.yml`（rails / db(postgres) / next）を用意
  - [x] DB 接続を環境変数化（`DATABASE_URL`、本番は Neon のプール接続文字列）
  - [x] `bin/rails s` と Next.js dev が docker compose up で立ち上がる
- 完了条件：`docker compose up` で Rails と Next.js の両方がローカル起動し、Rails のヘルスチェックエンドポイントに疎通できる。

### 🟢 0-2. CLAUDE.md とプロジェクト規約
- 目的：一貫したコードのための規約を明文化する。
- 依存：0-1
- タスク：
  - [x] `CLAUDE.md` に技術構成・ディレクトリ方針・命名規約を記載
  - [x] rubocop（`rubocop-rails-omakase`）導入、文字列はダブルクォート、`db/schema.rb` 等は除外
  - [x] RSpec 導入（`rspec-rails`、FactoryBot）
- 完了条件：`bundle exec rubocop` と `bundle exec rspec` が空でも通る状態。

### 🟢 0-3. Next.js プロジェクト作成（App Router / TS / Tailwind）
- 目的：フロントの土台を作る。
- 依存：0-1
- タスク：
  - [x] Next.js（App Router）+ TypeScript + TailwindCSS 初期化
  - [x] 環境変数 `NEXT_PUBLIC_API_BASE_URL` を用意
  - [x] API 呼び出しの共通クライアント（`src/lib/api.ts`）
  - [x] トップに «疎通確認用» の最小ページ
  - [x] `rack-cors` の最小設定（許可オリジンは `CORS_ALLOWED_ORIGINS`）
    - ブラウザからの fetch は別オリジン（:3001 → :3000）になるため、CORS なしでは完了条件を満たせない。
      本番オリジンの設定と Authorization ヘッダの露出は 2-2 で行う。
- 完了条件：Next.js が起動し、Rails API に fetch して結果を表示できる。

### 🔵 0-4. CI（GitHub Actions：rubocop + rspec + 脆弱性チェック）
- 目的：main へのマージ前に自動チェックを回す。
- 依存：0-2
- タスク：
  - [x] GitHub Actions で rubocop / rspec を実行するワークフロー
  - [x] brakeman（コードの静的解析）と bundler-audit（脆弱な gem の検出）を実行
    - どちらも `rails new` で Gemfile に入っていたが実行されていなかったため、CI に載せた。
    - bundler-audit は脆弱性DBの取得に git が要るため、開発コンテナでは動かない（CI で回す）。
  - [x] main への PR で必須チェックにする（ブランチ保護：直接 push 禁止、CI green 必須、strict）
- 完了条件：PR 作成時に rubocop / rspec / 脆弱性チェックが自動実行され、green でないとマージできない。

### 🔵 0-5. Dependabot（依存の自動更新PR）
- 目的：依存の更新・脆弱性対応を自動化する（0-4 の検査は「見つける」だけで、更新は手動のため）。
- 依存：0-4
- タスク：
  - [x] `.github/dependabot.yml`（`bundler`(backend) / `npm`(frontend) / `github-actions`）
  - [x] 更新頻度とグルーピング（週次、マイナー/パッチはまとめて1本の PR に）
  - [x] Dependabot の PR で CI が回ることを確認（main にマージされて初めて Dependabot が動くため、マージ後に確認する）
- 完了条件：依存に更新・脆弱性があると Dependabot が PR を作り、その PR で CI が green になる。

---

## マイルストーン 1：データモデル

### 🟢 1-1. マイグレーションとモデル（全テーブル）
- 目的：ER図どおりのスキーマとモデル関連を作る。
- 依存：0-2
- タスク：
  - [x] `discard` gem 導入
  - [x] マイグレーション作成：`users` / `posts` / `attempts` / `likes` / `favorites` / `reports`
    - [x] 各テーブル `t.timestamps`（created_at / updated_at）
    - [x] `posts.discarded_at` / `attempts.discarded_at`（論理削除）
    - [x] `attempts`：`description(text)` / `generated_image` / `similarity_score(integer, null許容)` / `status` / FK(post, user)
    - [x] 外部キー制約と index、`likes(user_id, attempt_id)` / `favorites(user_id, post_id)` に複合ユニークindex
  - [x] モデル関連付け（`has_many` / `belongs_to`）、`Discard::Model` を Post/Attempt に
  - [x] バリデーション（必須項目、status の enum、ユニーク性）
  - [x] モデル spec（関連・バリデーション・論理削除の絞り込み）
- 完了条件：`db:migrate` が通り、モデル spec が green。`Attempt.kept` 等で論理削除の絞り込みができる。

---

## マイルストーン 2：認証（devise-jwt）

### 🟢 2-1. devise + devise-jwt による認証API
- 目的：JWT でログイン状態を運ぶ認証を作る。
- 依存：1-1
- タスク：
  - [x] devise / devise-jwt 導入、`jwt_denylist` テーブル作成
  - [x] `POST /api/auth/sign_up` / `sign_in`（JWT発行）/ `DELETE sign_out`（失効）
  - [x] `GET /api/me`（ログイン中ユーザー）
  - [x] request spec（登録→ログイン→me→ログアウトの一連）
- 完了条件：JWT を Authorization ヘッダで送ると認証必須APIにアクセスでき、sign_out 後は弾かれる。

### 🟢 2-2. CORS 設定（JWT 対応）
- 目的：別ドメイン（Vercel↔Render）間で JWT をやり取りできるようにする。
- 依存：2-1
- 前提：`rack-cors` の導入と許可オリジンの環境変数化（`CORS_ALLOWED_ORIGINS`）は **0-3 で実施済み**（ローカルの疎通に必要だったため）。ここでは JWT と本番向けの設定を詰める。
- タスク：
  - [x] Authorization ヘッダの露出設定（`expose: ["Authorization"]`）
  - 許可オリジンの env 化（`CORS_ALLOWED_ORIGINS` / `CORS_ALLOWED_ORIGIN_REGEX`）と production 未設定時の fail-fast は実装済み（0-3・2-2）。**本番 Vercel オリジンの実値投入は 8-2a に委譲**（Vercel URL 確定後に Render の env へ設定するため、ここではチェックしない）。
  - [x] request spec（許可オリジンからの認証API呼び出しで JWT を受け取れる）
- 完了条件：Next.js（別オリジン）から認証APIを叩けて JWT を受け取れる。

---

## マイルストーン 3：お題（Post）API

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

### 🟢 3-2. Post CRUD API
- 目的：お題の投稿・一覧・詳細・削除。
- 依存：2-1, 3-1
- タスク：
  - [x] `GET /api/posts`（ransack 検索 + kaminari ページング）
        → 公開クエリは `?q=&sort=new|popular&page=` の平らな形。ransack の生パラメータは外に出さない
  - [x] `POST /api/posts`（画像＋タイトル、要ログイン）
  - [x] `GET /api/posts/:id`（お題＋挑戦一覧）
        → `sort=likes`（ベスト再現）は **6-1 に委譲**。6-1 は 5-1（いいね API）に依存しており、
        3-2 の時点ではいいねを作る手段が無いため。設計は
        `docs/superpowers/specs/2026-07-29-issue-3-2-post-crud-design.md`
  - [x] `DELETE /api/posts/:id`（自分のお題を論理削除）
  - [x] JSON シリアライザ整備（`app/serializers/` の PORO）、request spec
- 補足：この issue では編集（PATCH）を作らない。**タイトルのみの更新は 3-3 で扱う**（画像の差し替えは
  引き続き不可。既存の挑戦の描写文と比較ビューが成立しなくなるため）。
- 完了条件：一覧・検索・詳細・投稿・削除が spec 込みで動く。論理削除したお題は一覧に出ない。

### 🔵 3-3. お題タイトルの文字数上限と編集
- 目的：タイトルに上限を設け、投稿者が自分のお題のタイトルを直せるようにする。
- 依存：3-2
- **上限と編集を 1 つの issue にまとめてある。** どちらも `Post#title` のバリデーションを触り、
  編集の 422 は上限のエラーコードをそのまま使うため、分けると同じ場所を 2 回変更することになる。
- **画像の差し替えは含めない**。挑戦者は「その画像」を見て描写を書いているため、後から画像を変えると
  既存の挑戦の描写文がすべて意味を失い、比較ビュー（元画像 vs 再現画像）も成立しなくなる。
  画像を変えたい場合は 3-2 の論理削除 ＋ 再投稿で行う（discard なので既存の挑戦は参照が壊れない）。
- 先に決めること：
  1. **上限値**。100 文字程度が目安だが、日本語のお題タイトルとして妥当な長さは製品判断。
     DB 側を `varchar(n)` に狭めるか、モデルのバリデーションだけにするかも決める（既存行があるため後者が無難）。
  2. **挑戦が既に付いているお題のタイトルを変えてよいか**。
     - 案A（推奨）：常に許可する。変えられるのはタイトルだけで、画像＝挑戦の対象そのものは不変なので
       実害が小さい。実装も spec も単純になる。
     - 案B：挑戦が 0 件のときだけ許可し、1 件でもあれば 422 ＋ `post_already_challenged`。
       「夕暮れの交差点」→「猫」のような書き換えで既存の挑戦が別物にぶら下がって見えるのを防げるが、
       誤字を直したいだけのケースまで塞いでしまう。
- タスク：
  - [ ] `validates :title, length: { maximum: N }`
  - [ ] `PATCH /api/posts/:id`（自分のお題のみ、**title だけ**受け付ける。`image` は無視ではなく受け取らない）
  - [ ] 他人のお題・存在しない ID・削除済みは 404（3-2 の `destroy` と同じ `current_user.posts.kept.find` の形）
  - [ ] 応答は 3-2 の `PostSerializer` と同じ形（`{ "post": {...} }`）
  - [ ] request spec（投稿・編集の両方で `too_long` が返る／編集の成功・空タイトルで 422・
        他人のお題で 404・未認証で 401・**画像と既存の挑戦が変わらないこと**）
  - [ ] `docs/screen_and_api_design.md` の API 一覧に追記
  - [ ] フロントの辞書に文言を追加（7-5 と同時でもよい）
- フロント側：マイページ「投稿したお題」タブから編集できる導線が要る（**7-6 に含める**か、別 issue にする）。
  API だけ作っても画面が無いと使えないため、着手時にどちらか決める。
- 完了条件：上限を超えるタイトルが 422 と `too_long` で弾かれる。自分のお題のタイトルを更新でき、
  画像と既存の挑戦は影響を受けない。

### 🔵 3-4. お題一覧の並び替えを支えるインデックス
- 背景：3-2 のコードレビューで指摘。`posts` のインデックスは `discarded_at` と `user_id` のみ。
  既定の新着順は `created_at` にインデックスが無く、人気順は**未削除の全件について相関サブクエリを 2 本
  評価してから LIMIT 12** する。並び替えのキーが計算した別名なので、上位 N 件だけを取る近道が効かない。
- 依存：3-2
- 判断の前提：**MVP の件数では問題にならない**。実データで遅くなってから対応する（早すぎる最適化を避ける）。
  着手の目安は、お題が数千件を超える、または一覧のレスポンスが体感で遅くなったとき。
- タスク（着手時に選ぶ）：
  - [ ] `posts(created_at)` のインデックス（新着順向け。効果が確実で副作用が小さい）
  - [ ] 人気順は計測してから決める。候補は「いいね合計を非正規化カラムで持つ（discard との整合に注意）」
        「マテリアライズドビュー」「人気順だけキャッシュ」。**counter cache は discard を検知できないため不可**
- 完了条件：一覧のレスポンスタイムが目標値に収まる。計測結果を記録する。

---

## マイルストーン 4：挑戦（Attempt）と非同期生成

### 🟢 4-1. 非同期処理の基盤
- 目的：時間のかかる生成をジョブ化する土台。
- 依存：1-1
- タスク：
  - [x] Solid Queue を導入・起動（選定理由は `docs/README.md`。0-1 では `--skip-solid` で外してある）
        → ジョブテーブルは**アプリと同じ DB に同居**させる。本番は Puma プラグイン
        （`SOLID_QUEUE_IN_PUMA`）、ローカルは docker-compose の `worker` サービス。
        判断の根拠は `docs/superpowers/specs/2026-07-31-issue-4-1-solid-queue-design.md`
  - [x] 動作確認用のダミージョブ（`PingJob`）
- 完了条件：ジョブをenqueueしてワーカーが処理する流れがローカルで動く。
- 補足：**本番でのワーカー稼働確認は 4-2 に委譲する**。Render の無料インスタンスはシェルが
  使えず（SSH もダッシュボードのシェルも有料インスタンス限定）、4-1 の時点では本番で
  ジョブを enqueue する手段がないため。

### 🟢 4-2. 描写の保存・生成（画像生成はダミー）
- 目的：2ボタン（保存／生成）と即公開・状態遷移を、生成をスタブにして先に通す。
- 依存：3-2, 4-1
- タスク：
  - [x] `POST /api/posts/:post_id/attempts`（下書き作成 status: draft）
  - [x] `PATCH /api/attempts/:id`（下書き更新）
  - [x] `POST /api/attempts/:id/generate`（生成ジョブ起動、status: generating→published、**生成回数を消費**）
        → **status の更新と enqueue は必ず同じトランザクションで囲む**。ジョブテーブルを
        アプリと同じ DB に置いてあるため、ロールバック時にジョブも消えて孤児ジョブが出ない。
        `enqueue_after_transaction_commit` は `false` のまま変えないこと（理由は
        `docs/superpowers/specs/2026-07-31-issue-4-1-solid-queue-design.md` の
        「トランザクションの一体性」）
  - [x] `GenerateImageJob`：**当面は固定のダミー画像**を返し Cloudinary 保存 → published
  - [x] `GET /api/attempts/:id`（状況ポーリング）
  - [x] `DELETE /api/attempts/:id`（論理削除、**回数は戻さない**）
  - [x] 1日あたり生成回数上限のロジック
  - [x] request spec / job spec
  - [x] **本番でのワーカー稼働確認（4-1 から委譲）**：`generate` を叩いて status が
        `generating` → `published` に変わることを本番URLで確認する。あわせて Render の
        Environment に `SOLID_QUEUE_IN_PUMA` が実在することを目視確認する（未設定でも
        デプロイは成功し、ジョブが積まれるだけで無言で処理されないため）
  - [x] **Render 無料枠のメモリ実測（4-1 から委譲）**：512 MB に Puma＋supervisor＋
        dispatcher＋worker が収まるか。収まらなければ有料ワーカーへの切り出しを検討
        → **結果：収まったが余裕は 37 MB**（起動直後 362 MB → 生成 2 回で 475 MB / 512 MB）。
        実測値と削減の候補は `docs/README.md` の「Render 無料枠のメモリ実測」を参照。
        **4-3 に着手する前に読むこと。**
- 本番確認で見つかった不具合（いずれも本番でしか通らない経路。修正済み）：
  - `SOLID_QUEUE_IN_PUMA` が本番に存在しなかった（サービスは 8-2a 作成、変数の追加は 4-1）
  - Puma が cluster mode でマスターにアプリが載らず、プラグインが fork した先で落ちた（PR #73）
- 完了条件：描写の保存・生成（ダミー）・即公開・削除が動き、生成回数制限が効く。

### 🟢 4-3. 画像生成APIの本接続
- 目的：ダミーを本物の画像生成に差し替える。
- 依存：4-2
- タスク：
  - [x] 画像生成API（**gpt-image-2 / low / 1024×1024 / WebP・圧縮90**）クライアント実装
        （**APIキーはサーバー側のみ**）→ 公式 gem を使わず Net::HTTP。SDK が全エンドポイント
        ぶんを読み込み、余裕 37 MB の本番に載せる価値がないため。判断の根拠は
        `docs/superpowers/specs/2026-08-04-issue-4-3-image-generation-design.md`
  - [x] `GenerateImageJob` をダミー→本APIに差し替え、失敗時 status: failed
        → プロバイダは `KOTOE_IMAGE_PROVIDER` で切替。ローカル・CI・E2E はダミーで回る
        （実APIだと E2E のたびに課金され、生成に最大2分かかって不安定になるため）
  - [x] エラー/リトライ、コスト観点の最小ガード
        → リトライの可否を**例外の型**で表す（`TransientError` は 2 回、`PermanentError` は
        `discard_on`）。生成側を 2 回にとどめたのは、タイムアウトのリトライが同じ1枠に
        二重課金するため。**Cloudinary の失敗はジョブごと再実行せず、アップロードだけを
        3 回試す**（ジョブを再実行すると生成もやり直され 1 枠が 3 倍課金になる。
        「1 枠 ＝ 1 生成」はコストガードの前提）。
        失敗の理由は `attempts.failure_reason` で返す。
        コストガードは「アプリ 50枚/日（503）→ Spend alert $5 → Hard spend limit $20
        → 前払い $20・オートリチャージ off」の4層
  - [x] **実キーでの疎通確認**（マージ前にローカルから実施）：生成 28.9 秒・**WebP 278.6 KB**
        （見積り 0.3 MB とほぼ一致）・Cloudinary 保存まで成功。ポリシー違反のエラー文字列も
        採取済み（`moderation_blocked` / `image_generation_user_error`）
  - [x] **本番スモーク**（2026-08-04）：本番URLでコアループが通り、`kotoe/production/generated`
        に WebP が保存された。**メモリは定常状態で anon 373 / 512 MB（余裕 約139 MB）**。
        あわせて **`used_mb` は余裕の指標にならない**ことが分かった（ページキャッシュが空きを
        埋めるので定常状態では上限付近に張り付く。4-2 の「余裕 37 MB」も同じ測り方だった）。
        `workers.threads` は 3 のまま据え置きで確定。
        キルスイッチは 503 `generation_disabled` を返し、**生成枠を消費しない**ことも確認。
        スモークデータは削除済み
- 完了条件：実際の描写文から画像が生成され published になる。失敗時は failed になり再試行できる。
  → **2026-08-04 に本番で達成。issue 4-3 完了。**
- **設計中に判明した既存ドキュメントの誤り（訂正済み）**：
  - README の「生成 API が URL を返すならそれを Cloudinary に取り込ませる」というメモリ削減案は
    **成立しない**。gpt-image 系は base64 でしか返さない
  - OpenAI の spend limit は**通知（Spend alert）と遮断（`Enforce a hard limit`）の2種類**。
    設計当初は「通知のみ」と誤って書いていた。ただし遮断にも遅延があり、請求そのものを
    止めているのは前払いクレジット＋オートリチャージ off
- **7-3 への申し送り**：生成画像は WebP で保存しているため、**ダウンロードURLには必ず
  `f_png` / `f_jpg` と `fl_attachment` を付ける**。保存URLをそのまま `download` 属性に
  渡すと `.webp` が落ち、macOS の Preview で開けない環境がある。

### 🔵 4-4. 削除済みのお題にぶら下がる挑戦への操作を塞ぐ
- 背景：**`Post#discard` は挑戦にカスケードしない**（`has_many :attempts,
  dependent: :restrict_with_exception` で discard のコールバックは無い）。そのため、お題を
  論理削除しても、その下の挑戦は `attempts.discarded_at` が nil のまま残る。挑戦だけを見て
  絞っている経路では、**読み取り API から辿れないのに書き込みだけ通る**状態になる。
  5-1 のレビューで `LikesController` に同じ穴が見つかり、そちらは
  `joins(:post).merge(Post.kept)` で塞いだ（PR #82）。**同じ穴が `AttemptsController` に残っている。**
- 依存：4-2
- 塞げている経路（比較用）：
  - `POST /api/posts/:post_id/attempts` … `Post.kept.find` なので 404
  - `GET /api/attempts/:id` … 別途 `Post.kept...find(attempt.post_id)` を引くので 404
  - `POST/DELETE /api/attempts/:id/like` … 5-1 で対応済み
  - お題一覧・詳細の挑戦一覧 … `Post.kept` 起点なので出ない
- 残っている経路：`AttemptsController#owned_attempt`（`current_user.attempts.kept.find(params[:id])`）
  を使う **`PATCH` / `POST :generate` / `DELETE`**。お題の状態を見ていない。
- **いちばん困るのは `generate`**。削除済みのお題の下書きから画像生成ジョブを積める。
  - 生成枠は **enqueue 時に消費し、削除しても戻らない**（ドメインの重要ルール）。ユーザーは
    自分の1日の枠を、誰にも見えない結果のために失う。
  - 実費もかかる（gpt-image-2 low）。ただし被害額はコストガードの4層（アプリ 50枚/日 →
    Spend alert → Hard limit → 前払い）で頭打ちになるので、🟢 ではなく 🔵 に置いている。
  - 生成が成功しても、その挑戦は `GET /api/attempts/:id` が 404 になるため**誰も見られない**。
- 先に決めること：
  1. **`DELETE` も塞ぐか**。
     - 案A（推奨）：`PATCH` と `generate` だけ塞ぎ、`DELETE` は許可する。お題が消えたあとに
       自分の下書きを片付ける手段を残せる。いいねの `DELETE` を 422 にしなかったのと同じ考え方。
     - 案B：3つとも塞ぐ。一貫はするが、ユーザーが自分のデータを整理できなくなる。
  2. **ジョブ側でも見るか**。`GenerateImageJob` は `Attempt.kept.generating.find_by(id:)` で
     取り直しており、ここもお題を見ていない。コントローラだけ塞ぐと「enqueue 後・実行前に
     お題が削除された」場合に生成が走る。ジョブ側にも `Post.kept` の条件を足すか、
     その競合は許容するか。
- タスク：
  - [ ] `owned_attempt` に `joins(:post).merge(Post.kept)` を足す（対象アクションは上の判断次第）
  - [ ] （案A なら）`DELETE` 用に、お題の状態を見ないスコープを別に用意する
  - [ ] `GenerateImageJob` の取り直しにも `Post.kept` を足す（判断次第）
  - [ ] request spec / job spec
- 完了条件：削除済みのお題にぶら下がる挑戦から画像生成を起動できない。生成枠も実費も消費しない。

---

## マイルストーン 5：いいね・お気に入り・通報

### 🟢 5-1. 再現いいね API
- 依存：4-2
- タスク：
  - [x] `POST/DELETE /api/attempts/:id/like`（トグル、複合ユニーク）
  - [x] 冪等にする（二重いいね・未いいねの解除はエラーにせず 200 で現状を返す）
  - [x] セルフいいねの禁止（422 `cannot_like_own_attempt`）
  - [x] 挑戦の応答に `liked`（本人がいいね済みか）を追加。一覧は 1 クエリで引き N+1 を避ける
  - [x] request spec / model spec
- 完了条件：いいねのオン/オフができ、二重いいねが防止される。
- 補足：**いいね解除は物理削除**（CLAUDE.md の論理削除ルールの例外。複合ユニークと両立せず、
  行を残すといいねし直せなくなる）。**誰がいいねしたかは公開せず、通知もしない**（5-5 で検討）。
  設計は `docs/superpowers/specs/2026-08-09-issue-5-1-like-api-design.md`

### 🟢 5-2. お気に入り API
- 依存：3-2
- タスク：`POST/DELETE /api/posts/:id/favorite`（トグル）、spec。
- 完了条件：お気に入りのオン/オフができる。

### 🔵 5-3. 通報 API とモデレーション基礎
- 依存：4-2
- タスク：`POST /api/attempts/:id/report`、通報の記録、（可能なら）投稿/生成画像のNSFWチェック。
- 完了条件：通報が記録され、モデレーション用に参照できる。

### 🔵 5-4. 挑戦のお気に入り（本リリースで検討）
- 背景：MVP のお気に入り（5-2）は**お題（Post）専用**。挑戦（Attempt）には既に「再現いいね」（5-1）があるため、MVP では挑戦のお気に入りは持たない。README の「投稿/再現をストック」のうち、再現（挑戦）側をここで扱う。
- 依存：4-2, 5-2
- 前提（先に決めること）：**「いいね」と「お気に入り」の役割分担**を定義する（例：いいね＝公開の投票／お気に入り＝自分だけのブックマーク）。役割が被るなら実装しない判断もあり。
- 実装方針：**`attempt_favorites` を別テーブルで追加**（favorites(post) と分離し、外部キー整合を保つ）。favorites をポリモーフィック化する案は、FK 制約を張れずこのプロジェクトの整合方針と合わないため不採用。
- タスク：`POST/DELETE /api/attempts/:id/favorite`（トグル、複合ユニーク `attempt_favorites(user_id, attempt_id)`）、マイページの「お気に入り」タブに挑戦を追加、spec。
- 完了条件：挑戦のお気に入りのオン/オフができ、マイページで一覧できる。

### 🔵 5-5. いいねの可視化と通知（本リリースで検討）
- 背景：MVP のいいねは合計数（`likes_count`）と自分の状態（`liked`）だけを返し、
  **誰がいいねしたかは公開しない・通知もしない**（設計判断は
  `docs/superpowers/specs/2026-08-09-issue-5-1-like-api-design.md`）。
  挑戦者は自分の再現に誰が反応したかを知る手段が無い。ここでそれを扱う。
- 依存：5-1
- 前提（先に決めること）：**いいねした人を公開してよいか**。これが No なら通知も不要になるため、
  先にこの製品判断を行う。
  - 公開する利点：反応が見えて挑戦の動機になる。挑戦者と描写者の交流が生まれる。
  - 公開しない利点：いいねが「再現度への投票」として機能する（忖度が入らない）。
    押した側が名前を出さずに済む。ランキング（6-1 / 6-2）の質に直結する。
  - 折衷案：通知だけ行い、一覧は公開しない（挑戦者本人にのみ「誰が」を見せる）。
- タスク：
  - [ ] `GET /api/attempts/:id/likes`（いいねしたユーザー一覧、kaminari）※公開する判断の場合
  - [ ] 通知の記録（新しいいいねを挑戦者に伝える）とその既読管理
  - [ ] 通知の配信手段（画面内のベルアイコンのみか、メールも出すか）
- 完了条件：決めた公開範囲に沿って、いいねの反応を挑戦者が確認できる。
- 補足：データは残っている。`likes` は解除時に物理削除するが、消えるのは「解除されたいいね」だけで、
  生きているいいねの `user_id` と `created_at` は保持される。後から一覧も通知も組み立てられる。

---

## マイルストーン 6：ランキング・マイページ

### 🟢 6-1. お題ごとのベスト再現
- 依存：5-1
- タスク：`GET /api/posts/:id?sort=likes` で挑戦を再現度（いいね）順に返す（上位3件を強調表示できるように）。
- 完了条件：お題詳細でベスト再現を取得できる。

### 🔵 6-2. 全体ランキング API
- 依存：5-1
- タスク：`GET /api/rankings`（ユーザー/挑戦、いいね数順、kaminari）。
- 完了条件：全体ランキングをページング付きで取得できる。

### 🟢 6-3. マイページ API
- 依存：4-2, 5-2
- タスク：`GET /api/me/posts` / `me/attempts`(published) / `me/drafts`(draft) / `me/favorites`。
- 完了条件：マイページ4タブぶんのデータを取得できる。

---

## マイルストーン 7：フロントエンド（Next.js）

### 🟢 7-1. APIクライアントと認証プラミング
- 依存：2-2, 0-3
- タスク：fetch ラッパ、JWT の保存/付与、ログイン状態管理、認証ガード。
- 完了条件：ログイン→JWT保持→認証必須APIの呼び出しが通る。

### 🟢 7-2. 共通レイアウト＋認証画面（/login, /signup）
- 依存：7-1
- タスク：グローバルナビ/フッター、ログイン・新規登録フォーム。
- 完了条件：登録・ログイン・ログアウトが画面から一通りできる。

### 🟢 7-3. お題一覧・検索（/posts）＋お題詳細（/posts/[id]）
- 依存：7-1, 3-2, 6-1
- タスク：一覧・検索・ページング、詳細（元画像＋ベスト再現＋描写入力の2ボタン＋挑戦一覧）、生成中/空/失敗の状態。
- 完了条件：お題を探し、描写して生成（即公開）し、結果が表示されるコアループが動く。

### 🟢 7-4. 挑戦詳細・比較ビュー（/attempts/[id]）
- 依存：7-1, 5-1
- タスク：元画像 vs 再現画像の比較、いいね、（あれば）スコア、共有/通報導線。
- 完了条件：比較ビューが表示され、いいねできる。

### 🟢 7-5. お題投稿（/posts/new）
- 依存：7-1, 3-2
- タスク：画像アップロード（プレビュー）＋タイトル＋投稿、エラー状態。
- 完了条件：画面からお題を投稿できる。

### 🟢 7-6. マイページ（/mypage）
- 依存：7-1, 6-3
- タスク：プロフィール＋統計、タブ（投稿/挑戦/下書き/お気に入り）、空状態。
- 完了条件：4タブが表示され、下書きから生成に進める。

### 🔵 7-7. ランキング（/rankings）／トップ（/）
- 依存：7-1, 6-2
- タスク：ランキング画面、トップ（ヒーロー＋遊び方＋新着/人気）。
- 完了条件：ランキングとトップが表示される。

---

## マイルストーン 8：仕上げ・デプロイ

### 🟢 8-1. Playwright E2E テスト
- 目的：フロントとバックの「つなぎ目」（CORS / JWT / ポーリング）を通しで守る。MVP を「本番で動く」状態にするための必須テスト。
- 依存：7-3, 7-4
- タスク：
  - [ ] Playwright 導入（frontend/ 配下）
  - [ ] E2E①：認証フロー（登録→ログイン→未認証ガード→ログアウト）
  - [ ] E2E②：コアループ（ログイン→お題閲覧→描写→生成(ダミー可)→即公開→比較→いいね）
- 完了条件：2本の E2E がローカル（可能なら CI）で green。プレビュー／本番スケルトン（8-2a）に対しても回せると、つなぎ目を継続的に守れる。

### 🟢 8-2a. 本番環境スケルトン＋疎通スモーク（早期）
- 目的：本番のつなぎ目（Vercel↔Render の CORS/JWT・Neon プール接続・env vars）を、差分が小さいうちに一度固める。後段の一括デプロイで原因が特定しづらくなるのを防ぐ。
- 依存：2-2（認証・CORS が通っていること）
- タスク：
  - [x] Rails を Render、Next.js を Vercel、DB を Neon に**最小構成**でデプロイ
  - [x] 疎通スモーク：health ＋ 認証1本（sign_in → JWT → 認証必須API）が本番URLで通る
  - [x] Vercel プレビューの向き先を本番バックエンド（スケルトン）にして、以降 PR ごとに継続検証
- 完了条件：本番URLで health と認証が通り、CORS/JWT・Neon プール接続が確認できる。
- 補足：本番固有の統合（Cloudinary=3-1、画像生成キー=4-3）は、その機能を実装した回にその都度スモーク確認して積み増す（フル継続"本番"デプロイはしない）。

### 🟢 8-2b. 本番デプロイ・最終疎通
- 目的：全機能を本番へ昇格し、MVP を「本番で動く」状態にする。
- 依存：コアループ完成（7-3 まで）、8-1、8-2a
- タスク：全機能の本番反映、Cloudinary・画像生成キー等の本番疎通、カスタムドメイン/DNS、最終確認。
- 完了条件：本番URLでコアループが動作し、E2E が green。

### 🔵 8-3. SNSシェア・OGP
- タスク：挑戦/お題の共有、OGP画像。
- 完了条件：SNSでシェアするとカードが表示される。

### ⚪ 8-4. 拡張
- CLIP による自動類似度スコア（similarity_score を実値化、ランキングを再現度順に切替）
- 「人間 vs AI 対決」モード

---

## 進行順のまとめ（MVPの背骨）
`0-1 → 0-2 → 0-3 → 1-1 → 2-1 → 2-2 → 8-2a → 3-1 → 3-2 → 4-1 → 4-2 →（4-3）→ 5-1 → 5-2 → 6-1 → 6-3 → 7-1 → 7-2 → 7-3 →（7-4〜7-6）→ 8-1 → 8-2b`
この背骨が通れば「お題を投稿し、描写で挑戦し、再現画像が出て、いいね・ランキングが付く」コア体験が動く。**MVP の定義は「本番で動く（デプロイ済み）＋ コアループの E2E が green」**まで含む（8-1・8-2a/8-2b は 🟢）。つなぎ目は 2-2 直後の早期スケルトン（8-2a）で先に固め、以降は Vercel プレビューで継続検証する。
