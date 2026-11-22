# デプロイ手順（本番：Render / Vercel / Supabase）

本番は **Render（Rails・ネイティブ Ruby）/ Vercel（Next.js）/ Supabase（Postgres）** で動かす。
8-2a〜8-2b は Neon で立ち上げ、issue 8-6 で Supabase に移した（下の「Supabase と 24 時間キープアライブ」）。
下の「デプロイ順序」は 8-2a 当時の Neon での手順として残している。
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
| `DATABASE_URL` | **手入力** | Supabase の **Session pooler**（ポート 5432、`pooler.supabase.com`）。8-6 より前は Neon のプール接続文字列（`-pooler` 付きホスト） |
| `CORS_ALLOWED_ORIGINS` | **手入力** | Vercel 本番URL（完全一致、カンマ区切り可） |
| `CORS_ALLOWED_ORIGIN_REGEX` | **手入力** | Vercel プレビュー用。**チーム slug を必ず含める**（`\A \z` は実装側が付けるので書かない） |
| `CLOUDINARY_URL` | **手入力** | Cloudinary の API Environment variable。api_secret を含むためサーバー専用。未設定だと boot で raise する |
| `SOLID_QUEUE_IN_PUMA` | `render.yaml` | `true`。Solid Queue のワーカーを Puma プロセス内で起動する。未設定だとジョブが enqueue されるだけで処理されない |
| `OPENAI_API_KEY` | **手入力** | 画像生成 API のキー。**サーバー専用**。`KOTOE_IMAGE_PROVIDER=openai` のとき未設定だと boot で raise する |
| `KOTOE_IMAGE_PROVIDER` | **手入力** | `openai`。未設定でも production の既定は `openai` だが、明示しておく |
| `KOTOE_GENERATION_ENABLED` | 任意 | 既定 `true`。`false` / `0` / `off` で生成を全停止（キルスイッチ） |
| `KOTOE_SERVICE_DAILY_GENERATION_LIMIT` | 任意 | 既定 `50`。サービス全体の1日の生成枚数 |

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

### OpenAI（画像生成）

1. platform.openai.com で `kotoe` プロジェクトを作り、その中で API キーを発行して、
   Render の kotoe-api → Environment に `OPENAI_API_KEY` として貼る
2. **前払いクレジットを $20 購入し、オートリチャージを off にする**
3. **Spend alerts を $5** に設定する（通知のみ）
4. **Monthly spend limit を $20 にし、`Enforce a hard limit` を ON** にする

**⚠️ OpenAI の spend limit には性質の違う2つがある**（[公式ガイド](https://developers.openai.com/api/docs/guides/spend-limits)）。

| | 挙動 |
|---|---|
| **Spend alert** | 通知のみ。「API traffic continues」＝トラフィックは流れ続ける |
| **Hard spend limit** | **止まる。** `429` ＋ `organization_spend_limit_exceeded` / `project_spend_limit_exceeded` |

`Enforce a hard limit` を ON にしなければ**通知どまり**で、キーは動き続け課金も積み上がる。
ON にしても **遮断は即時ではない**（"Enforcement is not instantaneous, so recorded spend can
slightly exceed the configured amount"）。

コストガードは4層で、**穏やかなガードが先に効くように値を決めてある**。

| 層 | 値 | 効いたときに起きること |
|---|---|---|
| アプリ側の1日上限 | 50 枚/日 | `generate` が **503 で即座に断られる**。ジョブは積まれず、**生成枠も消費されない** |
| Spend alert | $5 | メール通知のみ。遮断しない |
| Hard spend limit | $20（`Enforce` ON） | 429 → attempt が **failed**。枠は戻らない。遅延で少し超えうる |
| 前払いクレジット | $20・オートリチャージ off | 残高切れ → 429 → **failed**。枠は戻らない |

**上の2つ（アプリの上限とアラート）が先に効くように値を並べるのが要点。** アプリの月額最悪値は
50枚/日 × 30日 × 約$0.011 ＝ **$16.5** なので、hard limit と前払いをそれより**上**の $20 に置く。
下に置くと、アプリ側の穏やかなガード（枠を消費しない 503）に達する前に 429 が返り、
**生成枠だけ失う乱暴なほうの失敗が先に起きる**。

**請求を止めているのは hard limit ではなく「前払い＋オートリチャージ off」**である。
カードから自動補充される経路が無いので、残高を使い切れば止まるしかない。hard limit は
その手前に置く安全装置で、遅延ぶんの取りこぼしを残高が受け止める関係になっている。

**月をまたぐと効く順序が変わる。** hard limit は毎月リセットされるが、**前払いクレジットは
リセットされず減っていくだけ**。数ヶ月経つと残高のほうが先に尽きるので、止まったときは
「上限に当たった」より先に「残高切れ」を疑う。どちらも `failure_reason: api_error` になる。

前払いクレジットは組織単位の 1 つの財布で、**プロジェクトを分けても残高は共有される**。
プロジェクトを分ける意味は財布を分けることではなく、「そのプロジェクトがいくらまで使ってよいか」を
hard limit で仕切ることにある。

`OPENAI_API_KEY` が未設定のまま `KOTOE_IMAGE_PROVIDER=openai` で起動すると、
`config/initializers/openai.rb` が起動時に例外を出して落ちる（Cloudinary と同じ方針）。

**生成を緊急停止したいとき**は `KOTOE_GENERATION_ENABLED=false` を設定する。
デプロイは不要で、環境変数の変更による再起動だけで効く。新規の起動を断る（503）だけでなく、
**すでにキューに積まれたジョブも実行の直前に見て止める**（`failure_reason: generation_disabled`）。
enqueue 時しか見ないと、止めたのに残っていたぶんが走り切って課金されるため。

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

# 1. health（DB 接続まで含めて確認）
curl -s "$API/api/health"
# 期待: {"status":"ok","database":"ok","memory":{...}}

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
  - **slug は途中で切らず、最後まで書くこと。** 7-1 のプレビュー確認時、値が
    `https://kotoe-[a-z0-9-]+-tatsuhiro\.vercel\.app` になっており、**プレビューを 1 つも
    許可していなかった**。実際の URL は `kotoe-<hash>-tatsuhiro-furutas-projects.vercel.app`
    で、末尾が `-tatsuhiro.vercel.app` にならないため一致しない。本番オリジンは
    `CORS_ALLOWED_ORIGINS`（完全一致）側で通っていたので、**本番だけ動いていて
    プレビューが全滅していることに気づけなかった**。
  - `[a-z0-9-]+` はデプロイハッシュ形式（`kotoe-<hash>-<slug>`）とブランチ形式
    （`kotoe-git-<branch>-<slug>`）の両方を吸収する。`\A` `\z` は
    `lib/cors/allowed_origins.rb` が付けるので書かない。
  - **値を変えたら再デプロイ（再起動）が要る。** 設定は起動時にしか読まれない。
  - 確認は curl でオリジンを詐称して行う。`access-control-allow-origin` が返れば許可：
    ```bash
    curl -s -D - -o /dev/null https://kotoe-api.onrender.com/api/health \
      -H "Origin: <プレビューURL>" | grep -i access-control-allow-origin
    ```
- プレビューの `NEXT_PUBLIC_API_BASE_URL` は本番バックエンド（スケルトン）を指す。
- 以降は PR ごとに発行されるプレビューで、Vercel↔Render のつなぎ目（CORS/JWT/ポーリング）を
  継続的に検証する。**半完成機能を毎回本番へ出す運用（フル継続"本番"デプロイ）はしない**。

## スモークユーザーの cleanup

疎通確認で作ったユーザーが本番 DB に残っている。**残すことにした**（2026-11-15、8-2b）。
試験的に使ってもらう中で、一覧などに出て紛らわしいと分かったら見直す。

| メール | 作成した issue |
|---|---|
| `smoke@kotoe.test` | 8-2a（本番スケルトン疎通） |
| `smoke-3-1@example.com` | 3-1（Cloudinary 疎通） |
| `kotoe-8-2b-202611151629@example.com` | 8-2b（コアループの確認）。お題・挑戦を持つ（どちらも論理削除済み） |

消すときの手順は下のとおり。**対象は `smoke@kotoe.test`・`smoke-3-1@example.com` の 2 件だけ**。
8-2b のアカウントは物理削除しない（CLAUDE.md の原則。投稿・挑戦が参照しているので、外部キーで失敗もする）。
`User` には論理削除がまだ無いので、そのまま残す。
**Render の Shell / ワンオフジョブは free プランでは使えない**ため、DB に直接つないで削除する。
接続文字列は Supabase の **Session pooler**（ポート 5432、`pooler.supabase.com`。Connect ボタンから取れる）。

```bash
psql "<Supabase の Session pooler の接続文字列>" \
  -c "DELETE FROM users WHERE email IN ('smoke@kotoe.test', 'smoke-3-1@example.com');"
```

`users` は posts・attempts・likes・favorites・reports から参照される。消す前に、この 2 件がどれからも参照されていないことを
`SELECT` で確かめる（参照があると外部キーで失敗する）。この 2 件のユーザーは投稿も挑戦も作っていないため
物理削除して問題ない（通常のユーザーは物理削除しない。`User` の論理削除は未実装）。

Cloudinary 側にも疎通確認で上げた 1x1 の PNG が `kotoe/production/posts/` に残っている（これも残している）。
8-2b の確認で使ったお題の画像と生成画像の 2 枚も、`kotoe/production/` 配下に残している（お題・挑戦は論理削除済み）。
消すときは Media Library から削除する。

## Supabase と 24 時間キープアライブ（issue 8-6）

設計：`docs/superpowers/specs/2026-11-21-issue-8-6-supabase-keepalive-design.md`

```
GAS ──10 分おき──▶ Render /up（DB に触れない）
                     │ 起き続ける
                     ▼
               Puma + Solid Queue ──Session pooler(5432)──▶ Supabase（Singapore、Pool Size 30）
                     ▲
GitHub Actions（04:00 JST）── /api/health を記録 → Deploy Hook で再デプロイ（メモリのリセット）
GitHub Actions（03:00 JST）── Session pooler で pg_dump → gpg で暗号化 → artifact（7 日）
Neon ──（何もしない。B に戻すときの受け皿として残す）
```

### 接続文字列の使い分け

| 用途 | 種類 | ホスト / ポート |
|---|---|---|
| Render の `DATABASE_URL`、`pg_dump` / `pg_restore` / 手動の `psql` | Session pooler | `aws-1-ap-southeast-1.pooler.supabase.com:5432` |
| （使わない） | Transaction pooler | `aws-1-ap-southeast-1.pooler.supabase.com:6543`。下の理由 |
| （使わない） | Direct connection | `db.<参照>.supabase.co:5432`。IPv6 専用で、Render からも手元からもつながらない |

**Transaction pooler（6543）は使わない**（2026-11-22 に変更）。1 つの DB 接続を複数のクライアントで使い回すため、接続ごとの設定（`search_path` など）が別のクライアントに持ち越される。8-6 の実装中、開発環境から Supabase にマイグレーションを流した後、`search_path` が `extensions` だけになった接続が残り、Rails から `public` のテーブルが見えなくなった（`relation ... does not exist`。何が変えたかは未確認で、Rails のスキーマの書き出しを疑っている）。マイグレーションの advisory lock も、取得と解放が別の接続に振られうる。Session pooler は 1 クライアントが 1 接続を占有するので、どちらも起きない。代わりに **Pool Size（同時接続の上限）** に当たりうる。数字は次のとおりで、**Pool Size は 15 から 30 に上げた**（2026-11-22。DB の `max_connections` は 60。30 にした後、25 本の同時接続を確認）。

| | 1 インスタンス | 再デプロイ中（新旧が重なる） |
|---|---|---|
| 計測（ローカルの Rails、Puma の中で Solid Queue、scheduler 無しの 4 プロセス） | 待機中 4 本、負荷の後 10 本 | ― |
| 本番の見込み（scheduler を足す） | 約 5〜11 本 | 約 10〜22 本 |
| 接続プールの上限（5 プロセス × `RAILS_MAX_THREADS`+2 = 5） | 25 本 | 50 本 |

30 は**見込みに合わせた値で、上限には足りない**。04:00 の再デプロイでは古い方はほぼ待機中なので受け入れた。ただし Render は main を追っているので、**マージのたびに時刻を問わず再デプロイされる**。生成が走っている時間帯のマージでは、あふれうる（マージは空いている時間に行うのが無難）。ビルドの `db:migrate` は新しいインスタンスが起動する前に終わるので、重なるのは古い方とだけ。Pool Size はロール・DB・モードの組ごとに数えられる（<https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI>）ので、バックアップ（`kotoe_backup`）は別枠の見込み（未計測）。ただし、どのロールの分も DB 本体の `max_connections` 60 を分け合い、Supabase 自身の機能（認証など）もそこから使う。手動の `psql` を `postgres` でつなぐと 1 本使う。

**あふれたときの見え方は確かめていない。** 再デプロイの後に DB の接続に関わるエラーや、新しいインスタンスの起動の失敗が出たら、まず Pool Size を疑う。対処は Pool Size を上げる（`max_connections` 60 のうち、Supabase 自身の機能の分を残す）。`RAILS_MAX_THREADS` は下げない（接続プールは `RAILS_MAX_THREADS`+2 で、Solid Queue のワーカーは `config/queue.yml` の `threads: 3` にポーリングとハートビートを足した 5 本を要る。`backend/config/database.yml` のコメント）。

Session pooler は、クライアントが切断すると接続の設定をリセットしてから次のクライアントに渡す（2026-11-22 に確認：同じ DB 接続が使い回される中で、`SET search_path TO extensions` をして切断した後、15 回つなぎ直してすべて既定値に戻っていた）。Session pooler では、ワーカーを動かしたまま `db:migrate` を 6 回流してすべて成功した。

ユーザー名は `postgres.<プロジェクト参照>` の形（プーラー経由のため）。Supabase のプロジェクトは
Data API・新しいテーブルへの API 権限の自動付与・RLS の自動有効化をすべて無効にして作った。
**Data API は必ず無効のままにする**（Kotoe のテーブルは RLS が無く、有効にすると公開鍵で読み書きされうる）。

### GitHub の Secrets と変数

Settings → Secrets and variables → Actions。

| 名前 | 種類 | 中身 | 使うワークフロー |
|---|---|---|---|
| `KOTOE_DB` | 変数（Variables） | `supabase`。**未設定のあいだ、下の 2 本は何もしない（skipped）** | 両方 |
| `RENDER_DEPLOY_HOOK_URL` | Secret | Render の `kotoe-api` → Settings → Deploy Hook の URL。知っていれば誰でもデプロイを起こせる | `nightly-restart.yml` |
| `SUPABASE_BACKUP_URL` | Secret | `kotoe_backup` の Session pooler の接続文字列 | `db-backup.yml` |
| `BACKUP_PASSPHRASE` | Secret | バックアップの暗号化のパスフレーズ。**`openssl rand -base64 32` などで作り、人が考えた文字列にしない**（artifact はログインした誰でも取れ、手元で総当たりできるので、強さだけが守り）。**リポジトリの外（パスワードマネージャーなど）にも控える。無くすと復元できない** | `db-backup.yml` |

公開リポジトリでは、**60 日間コミットが無いと schedule のワークフローが無効化される**。開発が止まる時期は、
Actions の画面で 2 本が有効なままかを確かめる。

### バックアップ用の読み取り専用ロール `kotoe_backup`

公開リポジトリの Secrets に `postgres` の接続文字列を置かないため、読むことしかできないロールで接続する。
Session pooler に `postgres` で接続して流す（パスワードは `openssl rand -hex 24` などで作る）。

```sql
CREATE ROLE kotoe_backup LOGIN PASSWORD '<パスワード>';
GRANT USAGE ON SCHEMA public TO kotoe_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO kotoe_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO kotoe_backup;
-- postgres がこの後に作るテーブル・シーケンスにも SELECT を付ける
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO kotoe_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO kotoe_backup;
```

接続文字列のユーザー名は `kotoe_backup.<プロジェクト参照>`。`select count(*) from users` が返り、
`insert into users default values` が `permission denied` になることを確かめる。
移行で Kotoe のテーブルを作り直したら、上の `GRANT SELECT ON ALL ...` の 2 行を流し直す
（`ALTER DEFAULT PRIVILEGES` が効くのは `postgres` が作ったものだけなので、念のため）。

### Neon から Supabase への移行（2026-xx-xx 実施）

**切り替え当日より前に、予行演習として手順 4〜7 を一度通す**（Neon はそのまま使いながら Supabase に流し、件数を比べる。当日は手順 5 でまた空にする）。
Supabase への流し込みは、8-6 の実装時に開発の DB のダンプで確かめた（スーパーユーザーではない `postgres` で `--exit-on-error` が exit 0、20 テーブルとシーケンスの件数が一致、その後 `kotoe_backup` のバックアップも通った）。Neon のダンプで通すのは予行演習が初めてになる。

止める時間の目安は数分。`pg_dump` / `pg_restore` は **PostgreSQL 17 のクライアント**（`postgres:17` イメージ、
または開発コンテナ）で流す。接続文字列は `backend/.env.spike`（git 管理外）に置き、表示しない。

1. **Neon のサーバーバージョンが 17 以下か確かめる**（`select version()`）。18 以上なら 17 の `pg_dump` では書き出せない
2. **生成中が無いことを確かめる**（Neon）：
   ```sql
   select count(*) from attempts where status = 'generating';
   select (select count(*) from solid_queue_ready_executions)
        + (select count(*) from solid_queue_claimed_executions)
        + (select count(*) from solid_queue_scheduled_executions);
   ```
   どちらも 0 になるまで待つ
3. **Render のダッシュボードで `kotoe-api` を Suspend する**（フロントは数分エラー表示になる）。
   **Suspend の後に、手順 2 の SQL をもう一度流す**（確かめてから Suspend までの間に生成が始まりうる）。1 件目が 0 でなければ、その挑戦は途中で止まっているので
   `update attempts set status = 'failed' where status = 'generating';` で失敗にする（キューの側が 0 でなければ、その件数を記録しておく）
4. **Neon から書き出す**（Neon の**プールしない**接続文字列。ダンプはリポジトリの外の `~/kotoe-migration/`、権限 700）：
   ```bash
   pg_dump -Fc -n public --no-owner --no-privileges -f ~/kotoe-migration/neon-<日付>.dump "$NEON_DIRECT_URL"
   ```
5. **Supabase の受け皿を空にする**（Session pooler。`public` スキーマ自体は消さない）：
   ```sql
   DROP TABLE IF EXISTS attempts, favorites, jwt_denylist, likes, posts, reports, users,
     solid_queue_blocked_executions, solid_queue_claimed_executions, solid_queue_failed_executions,
     solid_queue_jobs, solid_queue_pauses, solid_queue_processes, solid_queue_ready_executions,
     solid_queue_recurring_executions, solid_queue_recurring_tasks, solid_queue_scheduled_executions,
     solid_queue_semaphores, ar_internal_metadata, schema_migrations CASCADE;
   ```
6. **Supabase に流し込む**。`-n public` のダンプは `CREATE SCHEMA public` を含み、既に `public` がある DB では
   その 1 行がエラーになる。一覧からその行を除いて復元すると、本当のエラーだけで止まる：
   ```bash
   pg_restore -l ~/kotoe-migration/neon-<日付>.dump | grep -v " SCHEMA - public " > ~/kotoe-migration/restore.list
   pg_restore --no-owner --no-privileges --exit-on-error -L ~/kotoe-migration/restore.list -d "$SUPABASE_SESSION_URL" ~/kotoe-migration/neon-<日付>.dump
   ```
   続けて `kotoe_backup` の `GRANT SELECT ON ALL ...` の 2 行を流し直す
7. **件数を比べる**。Kotoe のテーブルは 18（＋ `ar_internal_metadata`・`schema_migrations` で 20）。
   次の SQL を Neon と Supabase の両方に流して結果をファイルに保存し、`diff` で全部一致することを確かめる（最後の行はシーケンス）：
   ```sql
   SELECT 'ar_internal_metadata' AS tbl, count(*) FROM ar_internal_metadata
   UNION ALL SELECT 'attempts' AS tbl, count(*) FROM attempts
   UNION ALL SELECT 'favorites' AS tbl, count(*) FROM favorites
   UNION ALL SELECT 'jwt_denylist' AS tbl, count(*) FROM jwt_denylist
   UNION ALL SELECT 'likes' AS tbl, count(*) FROM likes
   UNION ALL SELECT 'posts' AS tbl, count(*) FROM posts
   UNION ALL SELECT 'reports' AS tbl, count(*) FROM reports
   UNION ALL SELECT 'schema_migrations' AS tbl, count(*) FROM schema_migrations
   UNION ALL SELECT 'solid_queue_blocked_executions' AS tbl, count(*) FROM solid_queue_blocked_executions
   UNION ALL SELECT 'solid_queue_claimed_executions' AS tbl, count(*) FROM solid_queue_claimed_executions
   UNION ALL SELECT 'solid_queue_failed_executions' AS tbl, count(*) FROM solid_queue_failed_executions
   UNION ALL SELECT 'solid_queue_jobs' AS tbl, count(*) FROM solid_queue_jobs
   UNION ALL SELECT 'solid_queue_pauses' AS tbl, count(*) FROM solid_queue_pauses
   UNION ALL SELECT 'solid_queue_processes' AS tbl, count(*) FROM solid_queue_processes
   UNION ALL SELECT 'solid_queue_ready_executions' AS tbl, count(*) FROM solid_queue_ready_executions
   UNION ALL SELECT 'solid_queue_recurring_executions' AS tbl, count(*) FROM solid_queue_recurring_executions
   UNION ALL SELECT 'solid_queue_recurring_tasks' AS tbl, count(*) FROM solid_queue_recurring_tasks
   UNION ALL SELECT 'solid_queue_scheduled_executions' AS tbl, count(*) FROM solid_queue_scheduled_executions
   UNION ALL SELECT 'solid_queue_semaphores' AS tbl, count(*) FROM solid_queue_semaphores
   UNION ALL SELECT 'users' AS tbl, count(*) FROM users
   UNION ALL SELECT 'users_id_seq', last_value FROM users_id_seq
   ORDER BY 1;
   ```
8. **Render の `DATABASE_URL` を Supabase の Session pooler に差し替えて Resume する**
9. **確かめる**：`/api/health` が `"database":"ok"`、ログイン、一覧・詳細、生成 1 回（即公開まで）、いいね
10. **`KOTOE_DB=supabase` を設定し、2 本のワークフローを Actions の画面から手動実行（Run workflow）する**。
    バックアップの artifact ができ、再起動のログに `memory=` の行が出て、Render の Events に再デプロイが出ること。
    **そのビルドにかかった時間を記録する**（Hobby のビルド枠は月 500 分。毎晩なら 30 回分）
11. **最後に GAS のトリガーを有効にする**（下）。**先に有効にしない**（Neon のまま起こし続けると、月の途中で Neon の無料枠が尽きる）
12. Neon は消さない（B に戻すときの受け皿）

### キープアライブ（GAS）

1. <https://script.google.com> で新しいプロジェクトを作る（例：`kotoe-keepalive`）
2. 次を貼って保存する：
   ```javascript
   // Render の無料 Web は 15 分アクセスが無いと眠る。10 分おきに /up（DB に触れない）を叩いて起こしておく（issue 8-6）
   function keepAlive() {
     UrlFetchApp.fetch("https://kotoe-api.onrender.com/up", { muteHttpExceptions: true });
   }
   ```
3. 関数 `keepAlive` を一度手で実行し、外部への接続の許可を承認する
4. 左の「トリガー」→ 追加：関数 `keepAlive`、イベントのソース「時間主導型」、タイプ「分ベースのタイマー」、間隔「10 分おき」。
   エラー通知は「毎日通知を受け取る」など
5. 無料（gmail.com）アカウントの上限：トリガーの合計実行時間 90 分/日、URL の取得 2 万回/日
   （<https://developers.google.com/apps-script/guides/services/quotas>、2026-11-22 確認）。10 分おきは 1 日 144 回・1 回 1 秒前後で収まる

トリガーの「10 分おき」は数分ずれることがある。1 回飛ぶと間が 20 分になって一度眠り、次に開いた人が 1 回コールドスタートを踏む（許容）。

### 毎晩の再起動とバックアップ

- **再起動**（`.github/workflows/nightly-restart.yml`、04:00 JST）：Render のメモリ（anon）のリセットのため。Supabase のためではない。
  キープアライブで眠らなくなると、15 分アイドルで眠ることによる自然なリセットが無くなる。
  ログの `memory=` の行が、その日の再起動直前の値（**anon が 470 MB を超えたら B に戻す**）。
  ビルド枠（月 500 分）に収まらなければ、cron を `0 19 */2 * *`（2 日に 1 回）にする。Render API の restart は使わない
- **バックアップ**（`.github/workflows/db-backup.yml`、03:00 JST）：`kotoe_backup` で `pg_dump` → `users` が 1 行以上入っていることを確認（0 行なら失敗）→
  `gpg` で暗号化 → artifact（7 日）。**公開リポジトリの artifact はログインした誰でも取れるので、平文では置かない**。
  毎日 DB に触れるので、Supabase の「7 日間無活動で一時停止」の保険も兼ねる

### バックアップからの復元

1. Actions → `DB backup` の実行 → artifact をダウンロードして展開（`kotoe-<日付>.dump.gpg`）
2. 復号：`gpg --batch --pinentry-mode loopback --passphrase-fd 0 -d -o kotoe.dump kotoe-<日付>.dump.gpg`（パスフレーズを標準入力で渡す）
3. 流し込む：上の移行の手順 5・6 と同じ（受け皿を空にして、`CREATE SCHEMA public` を除いた一覧で `pg_restore`）。
   **新しく作った空の DB でも `-L` は要る**（`public` スキーマは最初からあり、`CREATE SCHEMA public` が衝突して止まる。8-6 の実装時に確認）

8-6 の実装時に、`postgres:17` で「書き出し → 中身の確認 → 暗号化 → 復号 → 空のローカル DB に復元」まで通し、20 テーブルと件数が戻ることを確かめた。
Supabase への流し込みは上の移行の注記のとおり、開発の DB のダンプで確かめた。

### 見張りと B に戻る条件

| 見るもの | どこで | 頻度 | B に戻る条件 |
|---|---|---|---|
| メモリ（anon） | `Nightly restart` のログの `memory=` | 週 1 回 | anon が 470 MB を超えた日がある |
| egress | Supabase の Usage（Shared Pooler Egress を含む合計） | 週 1 回 | 月の見込みが 5GB を超える（スパイクの見込みは何もしなくて月 約 1.8〜2.1 GB。毎日のバックアップも egress に数えられるが、開発の DB（挑戦 118 件）のダンプが約 80 KB なので、月 30 回でも数 MB） |
| 取り残された生成 | `select id, updated_at from attempts where status = 'generating' and updated_at < now() - interval '10 minutes'` | 週 1 回 | （戻る条件ではない）毎晩の再デプロイで生成が途中で止まると残りうる。見つけたら `failed` にする |
| 一時停止 | Supabase のダッシュボード・サイトの表示 | 起きたら気づく | 1 回でも起きる |
| Render の稼働時間・ビルド時間 | Render の Billing | 月 1 回 | 750h / 500 分に届きそう |

### B（Neon・時間帯を絞る）に戻す

1. 上の移行の手順 2・3 と同じく、生成中が無いことを確かめて Render を Suspend する
2. **Neon でブランチを切り、移行前のデータを残す**（例：`pre-supabase-<日付>`）
3. Supabase（Session pooler）から `pg_dump`（移行の手順 4 と同じオプション）
4. Neon の main の Kotoe のテーブルを消し（移行の手順 5 の `DROP TABLE`）、`CREATE SCHEMA public` を除いた一覧で流し込む（Neon への流し込みは未確認。戻すと決めたら、先に Neon のブランチで予行演習する）
5. 件数を比べ、Render の `DATABASE_URL` を Neon のプール接続文字列に戻して Resume する
6. GitHub の変数 `KOTOE_DB` を消す（再起動とバックアップが止まる。B は毎晩眠るので再起動は要らず、Neon は自前で履歴を持つ）
7. GAS のスクリプトで時間外は何もしないようにする（例：9〜19 時。Neon の実測 約 0.255 CU-h/時で 10h/日 ≒ 77 CU-h/月、無料 100）：
   ```javascript
   function keepAlive() {
     const hour = Number(Utilities.formatDate(new Date(), "Asia/Tokyo", "H"));
     if (hour < 9 || hour >= 19) return;
     UrlFetchApp.fetch("https://kotoe-api.onrender.com/up", { muteHttpExceptions: true });
   }
   ```
8. `docs/README.md` の「無料枠の制約」と CLAUDE.md の技術スタックを Neon に戻す

### 利用時間帯を見る

書き込みのある利用（登録・お題・描写・いいね・お気に入り）の時刻を、JST の時ごとに数える。
**閲覧だけの訪問は数えられない**（記録が無い）。論理削除済みの行も利用の記録として数える。
期間は `since` の 1 か所で変える。Neon（移行前の分）にも Supabase にも同じ SQL を流せる。

```sql
WITH since AS (SELECT timestamp '2000-01-01' AS t),  -- created_at は UTC で入っている
events AS (
  SELECT 'users' AS tbl, created_at FROM users
  UNION ALL SELECT 'posts', created_at FROM posts
  UNION ALL SELECT 'attempts', created_at FROM attempts
  UNION ALL SELECT 'likes', created_at FROM likes
  UNION ALL SELECT 'favorites', created_at FROM favorites
)
SELECT
  to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo', 'HH24') AS hour_jst,
  count(*) FILTER (WHERE tbl = 'users')     AS users,
  count(*) FILTER (WHERE tbl = 'posts')     AS posts,
  count(*) FILTER (WHERE tbl = 'attempts')  AS attempts,
  count(*) FILTER (WHERE tbl = 'likes')     AS likes,
  count(*) FILTER (WHERE tbl = 'favorites') AS favorites,
  count(*) AS total
FROM events, since
WHERE created_at >= since.t
GROUP BY 1
ORDER BY 1;
```

## 運用上の注意

- **free プランはスリープする**：無操作で約15分後に spin down し、次アクセスのコールドスタートに
  数十秒かかる。8-6 からは GAS のキープアライブで眠らせていない（下の「Supabase と 24 時間キープアライブ」）。
- **DB はプーラー経由で接続する**：Rails は Supabase の Session pooler（5432、Pool Size 30）。Direct connection は
  IPv6 専用で Render からもローカルからもつながらない。マイグレーションは `backend/bin/render-build.sh` の
  ビルドフェーズで走り、Session pooler 経由で通ることを確認済み（8-6）。上の「接続文字列の使い分け」の理由も読むこと。
  **開発環境から Supabase に `db:migrate` を流さない**（`schema.rb` に Supabase の拡張と `public.` 付きの
  テーブル名が書き出される。流してしまったら `git restore backend/db/schema.rb`）。
- **ジョブワーカーは Web プロセスに同居する**：Render の無料プランではバックグラウンド
  ワーカーが別サービス扱いで有料になるため、`plugin :solid_queue` で Puma から fork する
  （`SOLID_QUEUE_IN_PUMA=true`）。Neon のころは、free のスリープでワーカーごと止まることが Neon の
  オートサスペンドを促し、無料枠を維持する前提になっていた（Supabase は計算時間の上限が無く、この前提は要らない）。
  - メモリ 512 MB は **Puma・supervisor・dispatcher・worker・scheduler の 5 プロセス**で
    分け合う。scheduler は `config/recurring.yml` に `production:` のタスク（完了ジョブの
    毎時掃除）があるため fork される。ローカルには `development:` キーが無いので起動せず、
    3 プロセスしか見えない点に注意。
  - **測り方**：`GET /api/health` が `memory` を返す（`Diagnostics::Memory`）。無料プランは
    Application Metrics が表示されず、シェルも有料インスタンス限定なので、これが唯一の手段。
    - `used_mb` は**測ったその瞬間**の値で、生成ジョブのピークは取りこぼす。
      `peak_mb`（カーネルが記録している**コンテナ起動時からの最大値**）と併せて見ること。
      ジョブを流した後に落ち着いた値だけを見て「余裕がある」と判断しない。
    `source` は取得元（`cgroup_v2` / `cgroup_v1` / `proc_rss` / `unavailable`）で、
    **`proc_rss` のときの `used_mb` は fork したプロセスの共有ページを二重に数えるため過大**に
    出る。上限との比較には使えない。Render は `cgroup_v2` で読める。
    - **`memory` キーは必ず返る。** 測れない環境でも `{"source":"unavailable"}` になる。
      キーごと省くと「この機能がまだ無い古いビルドが動いている」ときと応答が同じになり、
      外から見分けがつかない（下の訂正のとおり、実際にこれを取り違えた）。
      **`memory` キーが無い応答が返ったら、それはデプロイがまだ反映されていない証拠**。
    - なお `proc_rss` へのフォールバックは、**本番で値が出なかった原因を cgroup v2 が読めない
      せいだと誤って断定して**追加したもの（PR #75）。実際の原因はデプロイの反映待ちで、
      再測定せずに結論を出したのが誤り。コード自体は保険として残してある。
  - **実測結果（4-2）**：起動直後 362 MB → 生成 2 回で 475 MB（93%）。**余裕は 37 MB**。
    数値と削減の候補は `docs/README.md` の「Render 無料枠のメモリ実測」を参照。
    **4-3 で本物の画像生成 API を載せる前に必ず読むこと。**
  - 収まらない場合は `plugin :solid_queue` を外し、`render.yaml` に `type: worker` の
    サービス（$7/月〜）を足して切り出す（アプリのコードは変わらない）。ただし常駐ワーカーは
    Neon のサスペンドも妨げる（DB が Neon のとき。8-6 からの Supabase では問題にならない）ため、`docs/README.md` の試算を読んでから判断すること。
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
- **範囲外**：カスタムドメイン/DNS（8-12）、Cloudinary（3-1）、画像生成キー（4-3）。
  スケルトンでは `config.active_storage.service = :local` のまま。これらの本番固有の統合は、
  その機能を実装した回にその都度スモーク確認して積み増す。
