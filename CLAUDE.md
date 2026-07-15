# CLAUDE.md — Kotoe（言絵）

このファイルは Claude Code 用のプロジェクト規約。実装前に必ず参照すること。

## プロジェクト概要
Kotoe は「画像を言葉だけで描写し、その言葉から AI が画像を再現して再現度を競う」Webアプリ。
詳細な設計は `docs/` を参照：
- `docs/README.md` … 全体像・データモデル・非同期フロー・技術選定
- `docs/screen_and_api_design.md` … 画面 / Next.js ルート / Rails API エンドポイント一覧
- `docs/issues_backlog.md` … 実装マイルストーンと issue（**依存順**）
- `docs/kotoe_planning_doc.md` … 企画書（背景・想定ユーザー）
- `docs/design_briefs.md` … 画面デザインの依頼文

## リポジトリ構成（分離構成）
```
kotoe/
├── CLAUDE.md          ← このファイル（規約）
├── docs/              ← 設計ドキュメント
├── backend/           ← Ruby on Rails (API モード)
├── frontend/          ← Next.js (App Router)
└── docker-compose.yml
```

## 技術スタック
- バックエンド：Ruby on Rails 8（API モード）
- フロントエンド：Next.js（App Router）+ TypeScript + TailwindCSS
- DB：PostgreSQL（本番は Neon、プール接続文字列を使用）
- 認証：devise + devise-jwt（Rails が JWT を発行・検証。フロントは Authorization ヘッダで送信）
- 画像保存：Cloudinary
- 論理削除：discard
- 検索：ransack ／ ページネーション：kaminari
- 非同期：Solid Queue（導入は issue 4-1。選定理由は `docs/README.md` 参照）
- 画像生成：外部API（OpenAI GPT Image など）※実装は後段、まずはダミーで通す

## 開発の進め方
- 実装は `docs/issues_backlog.md` の**依存順**（末尾「MVPの背骨」）に従う。
- **1 issue = 1 ブランチ = 1 PR**。ブランチは main から切る。勝手に main へ直接コミットしない。
- コミット前に **`bundle exec rubocop` と `bundle exec rspec` を通す**。
- 破壊的な操作（DBリセット、force push 等）や、依存追加・設計変更は、実行前に理由を説明して確認を取る。
- 不明点は勝手に仕様を決めず、質問する。

## 動作確認・デプロイの進め方
原則：**機能追加のたびに本番デプロイして確認しない**。確認は下の段階で行う。本番は早期に一度スケルトンを立て（8-2a）、以降の本番反映はマイルストーンの区切りで行う。

- **① issue を実装するたび**：ローカル（`docker compose up`）でブラウザから動作確認 ＋ 該当する RSpec / E2E を回す。本番には出さない。
- **② PR を出すたび**：CI（GitHub Actions）で rubocop / rspec が回る。Vercel の**プレビューURL**（PRごとに自動発行）でフロントの見た目・動作を確認する。
- **③ マイルストーンが一区切りしたら**：本番（Render + Vercel + Neon）へ反映する。
- **MVP の定義**：ローカルで動くだけでなく、**本番で動く（デプロイ済み）＋ コアループの E2E が green** までを MVP とする（8-1・8-2a/8-2b は 🟢）。
- **早期スケルトン（8-2a）**：認証・CORS（2-2）が通った直後に、最小構成（health＋認証1本）の本番環境を一度立て、Vercel↔Render の CORS/JWT・Neon プール接続を**差分が小さいうちに**固定する。後段の一括デプロイで原因特定が難しくなるのを防ぐ。以降は Vercel の**プレビューURL**を本番バックエンドに向けて継続検証する。**フル継続"本番"デプロイ（半完成機能を毎回本番へ出す）は行わない**。
- 本番環境に依存する部分（Vercel↔Render の CORS/JWT、Neon への本番DB接続、画像生成APIの本番キー、カスタムドメインのDNS）は、その統合を実装した回に**最小の疎通確認**をその都度足していく（ローカルでは再現しきれないため）。

## コーディング規約

### Rails（backend/）
- rubocop は `rubocop-rails-omakase` をベースに使用。**文字列はダブルクォート**（spec ファイルも含めプロジェクト全体で統一）。
- 自動生成ファイル（`db/schema.rb` など）は rubocop の対象外にする。
- Fat Model / Skinny Controller。複雑なロジックはモデルまたは PORO のサービスオブジェクトに寄せる。
- 論理削除は必ず `discard` を使う（`discarded_at`）。**物理削除しない**（他テーブルからの参照が壊れるため）。通常のクエリは `kept` スコープで未削除を対象にする。
- N+1 に注意（`includes` を使う）。
- テストは RSpec：
  - model spec（関連・バリデーション・スコープ）、request spec（APIの入出力）、job spec（非同期）を用途に応じて。
  - 置き場所は `spec/models` / `spec/requests` / `spec/jobs`、ファクトリは `spec/factories`、共通ヘルパは `spec/support`（`rails_helper` が自動で読み込む）。
  - private メソッドは public メソッド経由でテストする。
  - FactoryBot を使う（`FactoryBot.create` ではなく `create` で呼べるよう設定済み）。
  - 関連・バリデーションの宣言は shoulda-matchers で1行で書く（`belong_to` / `have_many(...).dependent(...)` / `validate_presence_of` 等）。enum・スコープ・discard・複合ユニークなどの**振る舞い**は通常の `expect` で書く。

### Next.js（frontend/）
- App Router + TypeScript。`any` を避け、API レスポンスに型を付ける。
- API 呼び出しは共通クライアント（fetch ラッパ）経由に集約する。個別コンポーネントで直接 fetch を散らさない。
- サーバー状態とクライアント状態を混同しない。フォームやトグルはローカル状態で扱う。
- TailwindCSS のユーティリティで組む。デザインの意図は `docs/design_briefs.md` を参照。

## テスト戦略
方針：**ロジックが集中するレイヤーに投資する**。ビジネスロジックは Rails 側にあるため RSpec が主戦場。フロントとバックの「つなぎ目」（CORS / JWT / ポーリング）は E2E で守る。

- **RSpec（主戦場）**：model spec（関連・バリデーション・スコープ・回数制限やソフトデリートのロジック）、request spec（API入出力）、job spec（生成ジョブ）を厚く書く。
- **Playwright（E2E）**：少数精鋭。対象は①コアループ（ログイン→お題閲覧→描写→生成→即公開→比較→いいね）と②認証フロー（登録・ログイン・ログアウト・未認証時のガード）。網羅よりつなぎ目の担保を優先する。
- **フロント単体テスト**：**MVP では導入しない**（フロントは表示と配線が中心で、単体テストが独自に守れる領域が薄いため）。ただし、UIから切り出せる純粋なロジック（例：生成ステータスのポーリング処理のカスタムフック、ユーティリティ関数）が生まれたら、**その部分にだけ Vitest** を後付けする。**Jest は採用しない**。React Testing Library でのコンポーネント結合テストも E2E と役割が被るため見送り。
- 例外的にテストを追加したくなった場合は、上記方針との整合を確認してから提案すること。

## メッセージ・エラー・i18n の責務
原則：**ルールの判定はバック、見せ方（文言・トースト・翻訳）はフロント**。文言をフロント/バックで二重に持たない。

- **フラッシュメッセージ（"投稿しました" 等の成功通知）**：フロントの責務。API 構成なので **Rails の `flash` は使わない**（flash は HTML を描画するモノリス用）。UIイベントへの反応としてフロントがトーストを出す。
- **バリデーション／業務ルールのエラー**（必須項目、生成回数上限、不適切画像など）：判定は**バック（Rails のモデル/サービス）**。ルールの正はバックが持ち、フロントで再実装しない。バックは**エラーコード**（例：`generation_limit_reached`）＋補助情報を JSON で返す。
- **通信・UI操作のエラー**（ネットワーク不通、5xx、送信前のクライアントバリデーション）：フロントの責務。フロントが文言を持つ。
- **i18n**：**フロントに集約**する。バックは表示用の文言ではなく**エラーコードを返し**、フロント側の辞書で翻訳・表示する（将来の多言語化もフロントで完結できる）。当面 Kotoe は日本語単言語だが、この方針で文言管理を一本化しておく。

## ドメインの重要ルール（必守）
- **描写の2ボタン**：「保存」＝下書き（status: draft）を作成/更新。「画像を生成」＝生成ジョブ起動。
- **Attempt の status**：`draft → generating → published(=即公開) → (failed)`。生成が成功したら**即公開**（結果を見てから公開を選ぶ導線は作らない）。
- **生成回数**：生成はジョブ enqueue 時に1日の上限を消費する。**削除しても回数は戻さない**（無限リトライ防止とコスト対策）。
- **セキュリティ**：画像生成API・Cloudinary 等の**キーは必ずサーバー（Rails）側のみ**に置く。フロントに出さない。個人情報・秘密情報をログやURLパラメータに出さない。
- **認証**：Vercel↔Render は別ドメイン。cookie 共有ではなく JWT を Authorization ヘッダで運ぶ。CORS の許可オリジンは環境変数化。
- **モデレーション**：投稿・生成画像は公開UGC。通報の記録を残す（ここでもソフトデリート）。

## よく使うコマンド（想定）
```bash
docker compose up            # 開発環境の起動
docker compose exec backend bin/rails db:migrate
# テスト用DB（kotoe_test）の作成・更新。初回と、マイグレーション追加後に実行する。
docker compose exec -e RAILS_ENV=test backend bin/rails db:prepare
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec rubocop
docker compose exec frontend npm run dev
```

## やらないこと
- main への直接コミット / 無断の force push。
- 物理削除の実装（必ず discard）。
- APIキーや秘密情報をフロント・リポジトリ・ログに含めること。
- 1つの PR に複数 issue を詰め込むこと。
