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
| `SOLID_QUEUE_IN_PUMA` | `render.yaml` | `true`。Solid Queue のワーカーを Puma プロセス内で起動する。未設定だとジョブが enqueue されるだけで処理されない |

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
5. あわせて Cloudinary 側で**使用量アラート**を設定する（Settings → Account → Usage alerts）。
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

疎通確認で作ったユーザーが本番 DB に残っている。**未処理**：

| メール | 作成した issue |
|---|---|
| `smoke@kotoe.test` | 8-2a（本番スケルトン疎通） |
| `smoke-3-1@example.com` | 3-1（Cloudinary 疎通） |

**Render の Shell / ワンオフジョブは free プランでは使えない**ため、Neon に直接つないで削除する。
接続文字列は Render の `DATABASE_URL` と同じもの（Neon ダッシュボードでも確認できる）。

```bash
psql "<Neon のプール接続文字列>" \
  -c "DELETE FROM users WHERE email IN ('smoke@kotoe.test', 'smoke-3-1@example.com');"
```

`users` は他テーブルから参照されうるが、これらのユーザーは投稿も挑戦も作っていないため
物理削除して問題ない（通常のユーザーは discard を使うこと）。

Cloudinary 側にも疎通確認で上げた 1x1 の PNG が `kotoe/production/posts/` に残る。
Media Library から削除する。

## 運用上の注意

- **free プランはスリープする**：無操作で約15分後に spin down し、次アクセスのコールドスタートに
  数十秒かかる。スモークや E2E の初回が遅く見える点に留意。
- **Neon はプール接続を使う**：`-pooler` 付きホストの接続文字列を使う（直接接続だと接続数を
  枯渇させる）。マイグレーションは `backend/bin/render-build.sh` のビルドフェーズで走る。
- **ジョブワーカーは Web プロセスに同居する**：Render の無料プランではバックグラウンド
  ワーカーが別サービス扱いで有料になるため、`plugin :solid_queue` で Puma から fork する
  （`SOLID_QUEUE_IN_PUMA=true`）。free のスリープでワーカーごと止まるが、これは Neon の
  オートサスペンドを促す面もあり、無料枠を維持する前提になっている。
  - メモリ 512 MB は **Puma・supervisor・dispatcher・worker・scheduler の 5 プロセス**で
    分け合う。scheduler は `config/recurring.yml` に `production:` のタスク（完了ジョブの
    毎時掃除）があるため fork される。ローカルには `development:` キーが無いので起動せず、
    3 プロセスしか見えない点に注意。実測は 4-2 で画像生成が乗ってから行う。
  - 収まらない場合は `plugin :solid_queue` を外し、`render.yaml` に `type: worker` の
    サービス（$7/月〜）を足して切り出す（アプリのコードは変わらない）。ただし常駐ワーカーは
    Neon のサスペンドも妨げるため、`docs/README.md` の試算を読んでから判断すること。
  - **デプロイ後、Render ダッシュボードの Environment に `SOLID_QUEUE_IN_PUMA` が
    実在することを目視確認する。** このサービスが Blueprint ではなく手動で作られていた
    場合、`render.yaml` の変更は反映されない。未設定でもデプロイもヘルスチェックも成功し、
    ジョブは `solid_queue_jobs` に積まれるだけで永久に処理されず、ログにも何も出ない。
    - **実際に起きた（issue 4-2）。** サービスは 8-2a で作られており、`SOLID_QUEUE_IN_PUMA` を
      `render.yaml` に足したのは 4-1。その差分が本番に届いていなかった。**サービス作成後に
      `render.yaml` へ足した環境変数は、すべて同じ理由で落ちる**と考えること。
  - **Puma は single mode で動かす（`workers 0`）。** cluster mode ではマスタープロセスが
    アプリを読み込まない（リクエストを捌かないため）。`plugin :solid_queue` は**そのマスターから
    fork** するので、子プロセスに Rails が無く `uninitialized constant SolidQueue` で落ちる。
    - **これも実際に起きた（issue 4-2）。** `workers` を書かないと Puma は環境変数
      `WEB_CONCURRENCY` を既定値として読むため、ダッシュボード側の設定だけで cluster mode に
      切り替わる。`config/puma.rb` で `workers 0` を明示して影響を受けないようにした。
    - **この経路はローカルでは踏めない。** ローカルのワーカーは docker-compose の `worker`
      サービス（`bin/jobs`）で、Puma プラグインは本番でしか有効にならない。再現したいときは
      `docker compose exec -e SOLID_QUEUE_IN_PUMA=true -e WEB_CONCURRENCY=2 backend \
      bundle exec puma -C config/puma.rb` のように環境変数を渡して起動する。
    - 有料プランで並列度を上げるときは `workers` を増やすだけでは駄目で、`preload_app!` を
      併せて設定する（マスターにアプリを読ませないと同じ落ち方をする）。
- **ジョブテーブルはアプリと同じ DB にある**：マイグレーションは通常どおり
  `backend/bin/render-build.sh` の `db:migrate` で適用される。追加の DB や環境変数は要らない。
- **範囲外**：カスタムドメイン/DNS（8-2b）、Cloudinary（3-1）、画像生成キー（4-3）。
  スケルトンでは `config.active_storage.service = :local` のまま。これらの本番固有の統合は、
  その機能を実装した回にその都度スモーク確認して積み増す。
