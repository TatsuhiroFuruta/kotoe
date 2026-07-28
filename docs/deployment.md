# デプロイ手順（本番：Render / Vercel / Neon）

本番は **Render（Rails・ネイティブ Ruby）/ Vercel（Next.js）/ Neon（Postgres）** で動かす。
この文書は issue 8-2a で立ち上げる**本番スケルトン**の手順。以降のマイルストーンでも
環境変数の追加や再デプロイの参照先として使う。

- ダッシュボード操作はアカウント所有者（あなた）が行う。
- backend のコード変更は不要（`config/environments/production.rb` は Render と整合済み）。
- Rails のデプロイ設定はリポジトリ直下の `render.yaml`（＝設定の正）を参照。

## 環境変数

### Render（Rails）

| 変数 | 出所 | 値 / 備考 |
|---|---|---|
| `RAILS_ENV` | `render.yaml` | `production` |
| `TZ` | `render.yaml` | `Asia/Tokyo`（**必須**。生成回数の日次上限の日付境界がずれるため） |
| `RAILS_MAX_THREADS` | `render.yaml` | `3`（puma スレッド数） |
| `JWT_SECRET_KEY` | Render 自動生成（`generateValue`） | devise-jwt の署名鍵。サービス再作成で値が変わり既存トークンは無効化される |
| `RAILS_MASTER_KEY` | **手入力** | `backend/config/master.key` の中身（credentials 復号鍵） |
| `DATABASE_URL` | **手入力** | Neon の**プール接続文字列**（`-pooler` 付きホスト） |
| `CORS_ALLOWED_ORIGINS` | **手入力** | Vercel 本番URL（完全一致、カンマ区切り可） |
| `CORS_ALLOWED_ORIGIN_REGEX` | **手入力** | Vercel プレビュー用。**チーム slug を必ず含める**（`\A \z` は実装側が付けるので書かない） |
| `CLOUDINARY_URL` | **手入力** | Cloudinary の API Environment variable。api_secret を含むためサーバー専用。未設定だと boot で raise する |

- `sync: false` の項目は秘密/環境依存のためリポジトリに置かず、ダッシュボードで手入力する。
- 許可オリジン（`CORS_ALLOWED_ORIGINS` / `CORS_ALLOWED_ORIGIN_REGEX`）が両方未設定のまま
  production を起動すると、boot 時に raise して気づけるようにしてある。

### Cloudinary（画像の保存先）

1. Cloudinary のダッシュボードにログインし、Settings → **API Keys** を開く
2. 使う API キーの **role にアセットの作成（create）権限があること**を確認する。
   `Media Library User` では**アップロードが 403 で拒否される**
   （`Request forbidden due to missing permissions (actions=["create"])`）。
   無料プランでは実質 `Admin` 以上が必要
3. `cloudinary://<api_key>:<api_secret>@<cloud_name>` の形に組み立てる
   （Dashboard トップの **API Environment variable** は既定キーの値なので、
   別のキーを使う場合はそちらを見ないこと）
4. Render の kotoe-api → Environment に `CLOUDINARY_URL` として貼る
4. あわせて Cloudinary 側で**使用量アラート**を設定する（Settings → Account → Usage alerts）。
   画像の配信URLに含まれる cloud_name は公開値で、第三者が任意サイズの変換URLを
   作れてしまうため、変換クレジットの異常消費に気づけるようにしておく

ローカルと本番は同じ Cloudinary アカウントを使い、保存先を `kotoe/development/` と
`kotoe/production/` のフォルダで分けている（`Images::Uploader` がパスに `Rails.env` を含める）。

`CLOUDINARY_URL` が未設定のまま本番を起動すると、`config/initializers/cloudinary.rb`
が起動時に例外を出して落ちる。設定漏れに気づかないままデプロイが green に見える
状態を防ぐため、意図的にそうしてある。

### Vercel（Next.js）

| 設定 | 値 |
|---|---|
| Root Directory | `frontend` |
| `NEXT_PUBLIC_API_BASE_URL` | Render の URL（例：`https://kotoe-api.onrender.com`） |

## デプロイ順序

Render は production で許可オリジン未設定だと boot で raise する。一方 `CORS_ALLOWED_ORIGINS`
（完全一致）には Vercel の本番URLが要り、Vercel のブラウザスモークには Render の URL が要る。
この相互依存を次の順序で解く。

1. **Neon** — プロジェクト/DB を作成し、**プール接続文字列**（`-pooler` ホスト）をコピーする。
2. **Render** — Web Service を作成する（`render.yaml` の Blueprint、またはダッシュボードで手動）。
   環境変数に `DATABASE_URL`（Neon プール文字列）、`RAILS_MASTER_KEY`（`backend/config/master.key`
   の中身）、`TZ`=`Asia/Tokyo` を設定。CORS はまず `CORS_ALLOWED_ORIGIN_REGEX`（Vercel プレビューの
   slug パターン＝アカウントから既知）**だけ**入れて boot を通す。デプロイ後、下の curl で疎通確認。
3. **Vercel** — Project を作成（Root Directory=`frontend`）。`NEXT_PUBLIC_API_BASE_URL`=Render の URL
   を設定してデプロイ → 本番URLを確定する。
4. **Render** — `CORS_ALLOWED_ORIGINS`=Vercel 本番URL を追加保存する（Render が再起動する）。
5. **ブラウザ（別オリジンの CORS/JWT 実機確認）** — 8-2a では一時ページ `/smoke` で
   health→sign_up→sign_in→me を実行し、別オリジンの JS から `Authorization` ヘッダを
   読めることを確認済み（**この `/smoke` ページは検証後に削除済み**）。以降の別オリジン
   実機確認は、7-1 のログインUIが載って以降に Vercel プレビューURLで行う。

## curl スモーク（サーバ側疎通・CORS 不要）

`$API` を Render の URL に置き換えて実行する（スモークユーザーは `name` 必須。
未作成なら手順2で作成される）。

```bash
API="https://kotoe-api.onrender.com"   # ← Render の URL

# 1. health（Neon 接続まで含めて確認）
curl -s "$API/api/health"
# 期待: {"status":"ok","database":"ok"}

# 2. スモークユーザー作成（既に存在すれば 422。name 必須）
curl -s -o /dev/null -w "sign_up=%{http_code}\n" -X POST "$API/api/auth/sign_up" \
  -H "Content-Type: application/json" \
  -d '{"user":{"email":"smoke@kotoe.test","name":"smoke","password":"smoke-password-1234"}}'

# 3. sign_in → Authorization ヘッダが載ることを確認
curl -si -X POST "$API/api/auth/sign_in" \
  -H "Content-Type: application/json" \
  -d '{"user":{"email":"smoke@kotoe.test","password":"smoke-password-1234"}}' \
  | grep -i "^authorization:"
# 期待: authorization: Bearer eyJ...
```

> 注意：curl は CORS を強制しない。別オリジンの CORS/JWT 実機確認（JS から `Authorization`
> ヘッダを読めるか）は、8-2a では一時ページ `/smoke` で確認済み（削除済み）。以降は 7-1 の
> 実UI＋Vercel プレビューで担保する。

## Vercel プレビューの継続検証

- プレビューURLは `CORS_ALLOWED_ORIGIN_REGEX`（チーム slug を含む）でカバーされる。
- プレビューの `NEXT_PUBLIC_API_BASE_URL` は本番バックエンド（スケルトン）を指す。
- 以降は PR ごとに発行されるプレビューで、Vercel↔Render のつなぎ目（CORS/JWT/ポーリング）を
  継続的に検証する。**半完成機能を毎回本番へ出す運用（フル継続"本番"デプロイ）はしない**。

## スモークユーザーの cleanup

スモークで作った固定ユーザーは本番 DB に1件残る。Render の Shell（またはワンオフジョブ）で削除する。

```bash
bin/rails runner "User.where(email: 'smoke@kotoe.test').destroy_all"
```

## 運用上の注意

- **free プランはスリープする**：無操作で約15分後に spin down し、次アクセスのコールドスタートに
  数十秒かかる。スモークや E2E の初回が遅く見える点に留意。
- **Neon はプール接続を使う**：`-pooler` 付きホストの接続文字列を使う（直接接続だと接続数を
  枯渇させる）。マイグレーションは `backend/bin/render-build.sh` のビルドフェーズで走る。
- **範囲外**：カスタムドメイン/DNS（8-2b）、Cloudinary（3-1）、画像生成キー（4-3）。
  スケルトンでは `config.active_storage.service = :local` のまま。これらの本番固有の統合は、
  その機能を実装した回にその都度スモーク確認して積み増す。
