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
  - [ ] Dependabot の PR で CI が回ることを確認（main にマージされて初めて Dependabot が動くため、マージ後に確認する）
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
  - [ ] devise / devise-jwt 導入、`jwt_denylist` テーブル作成
  - [ ] `POST /api/auth/sign_up` / `sign_in`（JWT発行）/ `DELETE sign_out`（失効）
  - [ ] `GET /api/me`（ログイン中ユーザー）
  - [ ] request spec（登録→ログイン→me→ログアウトの一連）
- 完了条件：JWT を Authorization ヘッダで送ると認証必須APIにアクセスでき、sign_out 後は弾かれる。

### 🟢 2-2. CORS 設定（JWT 対応）
- 目的：別ドメイン（Vercel↔Render）間で JWT をやり取りできるようにする。
- 依存：2-1
- 前提：`rack-cors` の導入と許可オリジンの環境変数化（`CORS_ALLOWED_ORIGINS`）は **0-3 で実施済み**（ローカルの疎通に必要だったため）。ここでは JWT と本番向けの設定を詰める。
- タスク：
  - [ ] Authorization ヘッダの露出設定（`expose: ["Authorization"]`）
  - [ ] 本番（Vercel）のオリジンを許可オリジンに追加
  - [ ] request spec（許可オリジンからの認証API呼び出しで JWT を受け取れる）
- 完了条件：Next.js（別オリジン）から認証APIを叩けて JWT を受け取れる。

---

## マイルストーン 3：お題（Post）API

### 🟢 3-1. Cloudinary 画像アップロード基盤
- 目的：画像の保存先を用意する。
- 依存：1-1
- タスク：
  - [ ] Cloudinary gem 設定（`CLOUDINARY_URL` 環境変数）
  - [ ] 画像アップロードの仕組み（direct or サーバー経由）を決めて実装
- 完了条件：画像をアップロードして URL/public_id を保存・取得できる。

### 🟢 3-2. Post CRUD API
- 目的：お題の投稿・一覧・詳細・削除。
- 依存：2-1, 3-1
- タスク：
  - [ ] `GET /api/posts`（ransack 検索 + kaminari ページング）
  - [ ] `POST /api/posts`（画像＋タイトル、要ログイン）
  - [ ] `GET /api/posts/:id`（お題＋挑戦一覧、`sort=likes` 対応＝ベスト再現）
  - [ ] `DELETE /api/posts/:id`（自分のお題を論理削除）
  - [ ] JSON シリアライザ整備、request spec
- 完了条件：一覧・検索・詳細・投稿・削除が spec 込みで動く。論理削除したお題は一覧に出ない。

---

## マイルストーン 4：挑戦（Attempt）と非同期生成

### 🟢 4-1. 非同期処理の基盤
- 目的：時間のかかる生成をジョブ化する土台。
- 依存：1-1
- タスク：
  - [ ] Solid Queue を導入・起動（選定理由は `docs/README.md`。0-1 では `--skip-solid` で外してある）
  - [ ] 動作確認用のダミージョブ
- 完了条件：ジョブをenqueueしてワーカーが処理する流れが動く。

### 🟢 4-2. 描写の保存・生成（画像生成はダミー）
- 目的：2ボタン（保存／生成）と即公開・状態遷移を、生成をスタブにして先に通す。
- 依存：3-2, 4-1
- タスク：
  - [ ] `POST /api/posts/:post_id/attempts`（下書き作成 status: draft）
  - [ ] `PATCH /api/attempts/:id`（下書き更新）
  - [ ] `POST /api/attempts/:id/generate`（生成ジョブ起動、status: generating→published、**生成回数を消費**）
  - [ ] `GenerateImageJob`：**当面は固定のダミー画像**を返し Cloudinary 保存 → published
  - [ ] `GET /api/attempts/:id`（状況ポーリング）
  - [ ] `DELETE /api/attempts/:id`（論理削除、**回数は戻さない**）
  - [ ] 1日あたり生成回数上限のロジック
  - [ ] request spec / job spec
- 完了条件：描写の保存・生成（ダミー）・即公開・削除が動き、生成回数制限が効く。

### 🟢 4-3. 画像生成APIの本接続
- 目的：ダミーを本物の画像生成に差し替える。
- 依存：4-2
- タスク：
  - [ ] 画像生成API（OpenAI GPT Image など）クライアント実装（**APIキーはサーバー側のみ**）
  - [ ] `GenerateImageJob` をダミー→本APIに差し替え、失敗時 status: failed
  - [ ] エラー/リトライ、コスト観点の最小ガード
- 完了条件：実際の描写文から画像が生成され published になる。失敗時は failed になり再試行できる。

---

## マイルストーン 5：いいね・お気に入り・通報

### 🟢 5-1. 再現いいね API
- 依存：4-2
- タスク：`POST/DELETE /api/attempts/:id/like`（トグル、複合ユニーク）、spec。
- 完了条件：いいねのオン/オフができ、二重いいねが防止される。

### 🟢 5-2. お気に入り API
- 依存：3-2
- タスク：`POST/DELETE /api/posts/:id/favorite`（トグル）、spec。
- 完了条件：お気に入りのオン/オフができる。

### 🔵 5-3. 通報 API とモデレーション基礎
- 依存：4-2
- タスク：`POST /api/attempts/:id/report`、通報の記録、（可能なら）投稿/生成画像のNSFWチェック。
- 完了条件：通報が記録され、モデレーション用に参照できる。

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

### 🔵 8-1. Playwright E2E テスト
- 目的：フロントとバックの「つなぎ目」（CORS / JWT / ポーリング）を通しで守る。
- 依存：7-3, 7-4
- タスク：
  - [ ] Playwright 導入（frontend/ 配下）
  - [ ] E2E①：認証フロー（登録→ログイン→未認証ガード→ログアウト）
  - [ ] E2E②：コアループ（ログイン→お題閲覧→描写→生成(ダミー可)→即公開→比較→いいね）
- 完了条件：2本の E2E がローカル（可能なら CI）で green。

### 🔵 8-2. デプロイ（Render + Vercel + Neon）
- 着手タイミング：最初にやる必要はない。**MVP のコアループがローカルで動いてから**でよい（日々の確認はローカル＋テスト＋PRプレビューで行う）。
- タスク：Rails を Render、Next.js を Vercel、DB を Neon へ。環境変数・CORS・本番URLの設定。カスタムドメイン。
- 完了条件：本番URLでアプリが動作する。デプロイ直後に CORS/JWT・本番DB接続・画像生成APIキーの最小疎通を確認する。

### 🔵 8-3. SNSシェア・OGP
- タスク：挑戦/お題の共有、OGP画像。
- 完了条件：SNSでシェアするとカードが表示される。

### ⚪ 8-4. 拡張
- CLIP による自動類似度スコア（similarity_score を実値化、ランキングを再現度順に切替）
- 「人間 vs AI 対決」モード

---

## 進行順のまとめ（MVPの背骨）
`0-1 → 0-2 → 0-3 → 1-1 → 2-1 → 2-2 → 3-1 → 3-2 → 4-1 → 4-2 →（4-3）→ 5-1 → 5-2 → 6-1 → 6-3 → 7-1 → 7-2 → 7-3 →（7-4〜7-6）`
この背骨が通れば「お題を投稿し、描写で挑戦し、再現画像が出て、いいね・ランキングが付く」コア体験が動く。
