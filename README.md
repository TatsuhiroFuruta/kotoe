# Kotoe（言絵）

画像を言葉だけで描写し、その言葉から AI が画像を再現して再現度を競う Web アプリ。

設計ドキュメントは [`docs/`](./docs) を参照。

## 構成

| | 技術 | 開発 | 本番 |
|---|---|---|---|
| フロントエンド | Next.js (App Router) / TypeScript / TailwindCSS | `frontend/` | Vercel |
| バックエンド | Ruby on Rails 8（API モード） | `backend/` | Render |
| データベース | PostgreSQL | db コンテナ | Neon |

## ローカル開発環境の起動

前提：Docker Desktop が動いていること。

```bash
# 1. 設定ファイルを用意する（.env.development は git 管理外）
cp .env.example .env.development
cp frontend/.env.example frontend/.env.development

# 2. コンテナを起動する
docker compose up --build
```

開発用データベース（`kotoe_development`）は postgres コンテナが初回起動時に
自動で作成するため、`rails db:create` は不要。

起動後：

| URL | 内容 |
|---|---|
| http://localhost:3001 | Next.js |
| http://localhost:3000/api/health | Rails のヘルスチェック（DB 接続も確認する） |

## よく使うコマンド

```bash
docker compose exec backend bin/rails db:migrate
docker compose exec backend bundle exec rspec
docker compose exec backend bundle exec rubocop
docker compose exec frontend npm run lint
```

## 暗号化クレデンシャルの差分表示（任意・clone ごとに一度）

`config/credentials.yml.enc` は暗号化されているため、そのままでは `git diff` が
暗号文になる。以下を一度実行すると、復号された内容で差分が表示される。

```bash
docker compose exec backend bin/rails credentials:diff --enroll
```

## 環境変数

秘密情報（API キー等）は `.env.development` にのみ置き、**コミットしない**。
本番では Render / Vercel のダッシュボードで設定する。必要な変数は `.env.example` と
`frontend/.env.example` を参照。
