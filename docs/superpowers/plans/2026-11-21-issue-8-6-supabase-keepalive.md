# issue 8-6 Supabase への乗り換えと 24 時間キープアライブ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本番の DB を Neon から Supabase に移し、GAS で 24 時間キープアライブしてコールドスタートを消す。メモリ対策の毎晩の再起動と、毎日の暗号化バックアップを GitHub Actions で回す。

**Architecture:** アプリのコードは変えない（`DATABASE_URL` の差し替えだけ）。足すのは GitHub Actions のワークフロー 2 本（再起動・バックアップ）と手順書・文書。ワークフローはリポジトリ変数 `KOTOE_DB=supabase` のときだけ動き、PR 1 のマージと本番の切り替えを切り離す。切り替え・1 週間の観察・PR 2 は、ユーザーと一緒に行うタスクとして最後に置く。

**Tech Stack:** GitHub Actions、PostgreSQL 17（`pg_dump` / `pg_restore`）、gpg、Supabase（Supavisor）、Render Deploy Hook、Google Apps Script

**Spec:** `docs/superpowers/specs/2026-11-21-issue-8-6-supabase-keepalive-design.md`

## Global Constraints

- 本番の `DATABASE_URL` は Supabase の **Session pooler（5432、Pool Size 30）**（2026-11-22 に Transaction pooler から変更。設計書の「1. 接続」）。`pg_dump` / `pg_restore` / `psql` は **Session pooler（5432、`pooler.supabase.com`）**。Direct connection は使わない（IPv6 専用）
- `backend/config/database.yml` の設定などアプリのコードは変えない（`database.yml` はコメントだけ直す）
- **開発環境から Supabase に `db:migrate` を流さない**（`schema.rb` に Supabase の拡張と `public.` 付きの名前が書き出される）。もし流して `schema.rb` が変わったら `git restore backend/db/schema.rb`
- ワークフローは **`vars.KOTOE_DB == 'supabase'` のときだけジョブを実行**する。`workflow_dispatch` も付ける
- 再起動：毎晩 **04:00 JST（cron `0 19 * * *`）**。ビルド枠（月 500 分）に収まらなければ **2 日に 1 回（`0 19 */2 * *`）**。Render API の restart は使わない
- バックアップ：毎日、`kotoe_backup`（読み取り専用）で接続、**gpg で暗号化してから** artifact、**保持 7 日**。平文のダンプを artifact・ログに出さない
- キープアライブ：GAS の時間主導型トリガーで `https://kotoe-api.onrender.com/up` を **10 分おき**
- 秘密（接続文字列・Deploy Hook の URL・パスフレーズ）は会話・リポジトリ・ログに出さない。env ファイルの中身は表示せず、キー名と値の有無だけを見る
- コミットは `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` で止める（`Claude-Session:` を書かない）。PR 1 は `Refs #137`、PR 2 は `Closes #137`
- 文書は日本語。CLAUDE.md の規約（rubocop・rspec をコミット前に通す）に従う

## Review Focus

1. **バックアップが「成功」なのに中身が空**：切り替えで Supabase のテーブルを作り直すと `kotoe_backup` への `GRANT` が消え、`pg_dump` が権限エラーにならずに空に近いダンプを作ることがある → ワークフローはダンプに `users` のデータが含まれることを確かめ、無ければ失敗する（Task 2）
2. **Render が落ちていて `/api/health` が取れない夜**：記録のために再起動まで止まると、メモリのリセットという本来の目的が果たせない → health の失敗は記録して続行し、Deploy Hook の失敗だけをジョブの失敗にする（Task 1）
3. **`KOTOE_DB` 未設定のままマージ・手動実行**：Neon 構成の Render を再デプロイしたり、空の Supabase をダンプしたりしない → ジョブが skipped になることを確かめる（Task 1・2）
4. **移行中に生成が走っている**：`generating` の挑戦や実行待ちのジョブを残したまま移すと、宙に浮く → 切り替えの前に 0 件を確かめ、0 件でなければ待つ（Task 6）
5. **Neon のサーバーが PostgreSQL 18 以上**：開発コンテナの `pg_dump` 17.12 では書き出せない → 切り替えの前にサーバーのバージョンを確かめる（Task 6）

---

### Task 1: 毎晩の再起動のワークフロー

**Files:**
- Create: `.github/workflows/nightly-restart.yml`

**Interfaces:**
- Consumes: Secret `RENDER_DEPLOY_HOOK_URL`、変数 `KOTOE_DB`、`GET https://kotoe-api.onrender.com/api/health`（`{"status","database","memory":{"anon_mb","file_mb","used_mb","peak_mb",...}}`）
- Produces: ジョブのログに `memory={...}` の 1 行（Task 7 で読む）

- [ ] **Step 1: ワークフローを書く**

  - `on: schedule: - cron: "0 19 * * *"`（04:00 JST）と `workflow_dispatch`
  - ジョブに `if: vars.KOTOE_DB == 'supabase'`
  - ステップ 1：`curl -sS --max-time 120 https://kotoe-api.onrender.com/api/health` の `.memory` を `jq -c` で `memory=...` として 1 行出す。**失敗しても続行**（`continue-on-error` か `|| echo "memory=unavailable"`）
  - ステップ 2：`curl -fsS -X POST "$RENDER_DEPLOY_HOOK_URL"`（`env:` で Secret を渡す。URL を `run:` に直書きしない）。失敗したらジョブを失敗にする
  - 冒頭のコメントに：目的（Render のメモリのリセット。Supabase のためではない）、2 日に 1 回へ減らすときの cron、公開リポジトリは 60 日コミットが無いと schedule が無効化されること

- [ ] **Step 2: 静的検査**

  Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest .github/workflows/nightly-restart.yml`
  Expected: 出力なし（exit 0）

- [ ] **Step 3: health の整形をローカルで確かめる**

  Run: ワークフローのステップ 1 と同じコマンドを、URL を `http://localhost:3000/api/health` にして実行
  Expected: `memory={"anon_mb":...}` の 1 行（開発環境は cgroup が違い値が null でもよい。形が 1 行の JSON であること）。
  URL を `http://localhost:9/api/health` にすると `memory=unavailable` が出て exit 0

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/nightly-restart.yml
git commit -m "ci: 毎晩 Render を再デプロイしてメモリをリセットするワークフローを足す（KOTOE_DB=supabase のときだけ）"
```

### Task 2: 毎日のバックアップのワークフローと、復元の通し確認

**Files:**
- Create: `.github/workflows/db-backup.yml`

**Interfaces:**
- Consumes: Secret `SUPABASE_BACKUP_URL`（`kotoe_backup` の Session pooler 接続文字列）、Secret `BACKUP_PASSPHRASE`、変数 `KOTOE_DB`
- Produces: artifact `kotoe-db-<YYYYMMDD>`（中身 `kotoe-<YYYYMMDD>.dump.gpg`、保持 7 日）。`kotoe_backup` ロールを作る SQL（Task 4 で `docs/deployment.md` に載せる。Task 6 で本番に流す）

- [ ] **Step 1: スパイクの Supabase に `kotoe_backup` を作る**

  Session pooler（`backend/.env.spike` の `SPIKE_SESSION_URL`）に `postgres:latest` の `psql` で流す。SQL：
  `CREATE ROLE kotoe_backup LOGIN PASSWORD '<生成した値>'`、`GRANT USAGE ON SCHEMA public`、
  `GRANT SELECT ON ALL TABLES IN SCHEMA public`、`GRANT SELECT ON ALL SEQUENCES IN SCHEMA public`、
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES / SEQUENCES TO kotoe_backup`。
  パスワードは `openssl rand -hex 24` で作り、`backend/.env.spike` に `SPIKE_BACKUP_URL`（ユーザー名 `kotoe_backup.<プロジェクト参照>`、Session pooler）として書く。表示しない

- [ ] **Step 2: `kotoe_backup` で接続でき、書き込めないことを確かめる**

  Run: `SPIKE_BACKUP_URL` で `select count(*) from users;` と `insert into users default values;`
  Expected: 1 つ目は件数が返る。2 つ目は `permission denied for table users`

- [ ] **Step 3: ワークフローを書く**

  - `on: schedule: - cron: "0 18 * * *"`（03:00 JST。再起動の前）と `workflow_dispatch`
  - ジョブに `if: vars.KOTOE_DB == 'supabase'`
  - **`pg_dump` のメジャーは 17 以上**（Supabase が 17.12）。ランナーへの入れ方は任せる（PGDG の `postgresql-client-17` か `postgres:17` コンテナ）。最初に `pg_dump --version` を出す
  - `pg_dump -Fc -n public --no-owner --no-privileges -f kotoe.dump "$SUPABASE_BACKUP_URL"`
  - **中身の確認**：`pg_restore -l kotoe.dump` に `TABLE DATA public users` が無ければ失敗（Review Focus 1）
  - `gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 --symmetric --cipher-algo AES256 -o kotoe-<日付>.dump.gpg kotoe.dump`（パスフレーズは標準入力から。引数に置かない）→ 平文の `kotoe.dump` を消す
  - `actions/upload-artifact@v4`（ci.yml と同じ版）で `kotoe-<日付>.dump.gpg` だけを上げる。`retention-days: 7`、`if-no-files-found: error`
  - 冒頭のコメントに：暗号化する理由（公開リポジトリの artifact はログインした誰でも取れる）、Supabase の一時停止（7 日無活動）の保険を兼ねること、60 日の無効化

- [ ] **Step 4: 静的検査**

  Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest .github/workflows/db-backup.yml`
  Expected: 出力なし

- [ ] **Step 5: ワークフローと同じコマンドで、ローカルで書き出し → 暗号化 → 復号 → 復元を通す**

  `postgres:17` コンテナで、`SPIKE_BACKUP_URL` から `pg_dump`、テスト用パスフレーズで `gpg` 暗号化・復号、
  使い捨ての `postgres:17` コンテナ（空の DB）に `pg_restore --no-owner --no-privileges`。
  事前にスパイクの Supabase に PingJob を 1 件流しておくと、データの行があることを見られる（`solid_queue_jobs`）
  Expected: 復元先で Kotoe の 17 テーブルがあり、`solid_queue_jobs` の件数が Supabase と一致。`pg_restore -l` の確認が `users` で通る

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/db-backup.yml
git commit -m "ci: Supabase を毎日 pg_dump し、暗号化して artifact に 7 日残すワークフローを足す（KOTOE_DB=supabase のときだけ）"
```

### Task 3: 利用時間帯の SQL

**Files:**
- Modify: `docs/deployment.md`（新しい節「利用時間帯を見る」。Task 4 の手順書と同じファイル）

**Interfaces:**
- Produces: SQL 1 本（Task 7 の見直しで使う）

- [ ] **Step 1: SQL を書く**

  `users`・`attempts`・`likes`・`favorites`・`posts` の `created_at` を JST の時（00〜23）ごとに数え、`テーブル × 時` の件数を出す。
  `created_at` は UTC で入っている（`timestamp without time zone`）ので `created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo'`。
  対象期間を引数でなく `WHERE created_at >= ...` の 1 か所で変えられる形。論理削除済み（`discarded_at`）も含める（利用の記録として）。
  閲覧だけの訪問は数えられないことを節の冒頭に書く

- [ ] **Step 2: 開発の DB で動かす**

  Run: `docker compose exec db psql -U postgres kotoe_development -f -`（SQL を標準入力で）
  Expected: エラーなく、テーブルと時ごとの件数が出る。開発データの件数の合計が `select count(*)` と一致

- [ ] **Step 3: Commit**（Task 4 とまとめてもよい）

### Task 4: 手順書と文書の更新

**Files:**
- Modify: `docs/deployment.md`（題・環境変数の表・デプロイ順序・curl スモーク・運用上の注意の Neon の記述を Supabase に。新しい節：Supabase の作り方、`kotoe_backup` の SQL、移行の手順、B に戻す手順、バックアップからの復元、GAS のスクリプトとトリガー、GitHub の Secrets・変数）
- Modify: `docs/README.md`（「無料枠の制約」「やってはいけないこと：キープアライブ」「DB を Neon 以外に移す場合」「技術スタック」の DB）
- Modify: `CLAUDE.md`（技術スタックの DB、開発から Supabase にマイグレーションを流さない旨）
- Modify: `docs/issues_backlog.md`（8-6：スパイクの結果、方式の決定、PR 1 の内容。完了の印は PR 2）
- Modify: `render.yaml`（`DATABASE_URL` のコメントのみ）

**Interfaces:**
- Consumes: Task 1・2 のファイル名・Secret 名・cron、Task 3 の SQL、spec の「スパイクの結果」「移行の手順」「見張りと B に戻る条件」

- [ ] **Step 1: `docs/deployment.md` を書く**

  移行の手順は spec の 2 の 9 ステップをそのまま、コマンド付きで。加える点：
  - 受け皿を空にする SQL は Kotoe のテーブル 17 個＋`ar_internal_metadata`・`schema_migrations` を名前で列挙して `DROP TABLE ... CASCADE`（`public` スキーマは消さない）
  - 流し込んだ後に `kotoe_backup` への `GRANT` をやり直す（テーブルを作り直すと消える）
  - 件数比較は 19 テーブル全部、Neon と Supabase の両方で `select count(*)` を並べて出す形
  - B に戻す手順の先頭に「Neon でブランチ `pre-supabase-<日付>` を切る」
  - GAS：スクリプト（`UrlFetchApp.fetch("https://kotoe-api.onrender.com/up", { muteHttpExceptions: true })`）、時間主導型・10 分おき、失敗通知、B に戻すときの時間帯の絞り方（JST の時刻を見て時間外は return）
  - GAS の無料の上限（URL の取得・トリガーの合計実行時間）を Google の公式ページで確かめ、数字と URL を載せる（1 日 144 回が収まること）
  - 復元：artifact をダウンロード → `gpg -d` → `pg_restore --no-owner --no-privileges`
  - バックアップのパスフレーズはリポジトリの外にも控えること

- [ ] **Step 2: README・CLAUDE.md・backlog・render.yaml を更新する**

  README の「やってはいけないこと：キープアライブ」は消さず、「Neon の場合」として残し、今の構成（Supabase＋GAS＋毎晩の再起動）を書く。
  スパイクの数字（egress 月 約 1.8〜2.1 GB、Direct は IPv6 専用）を「DB を Neon 以外に移す場合」の Supabase の行に入れる。
  公開リポジトリで 60 日コミットが無いと schedule が無効化されることを運用の注意に書く

- [ ] **Step 3: 文書の中の Neon の残りを確かめる**

  Run: `grep -rn "Neon" docs/deployment.md CLAUDE.md render.yaml`
  Expected: 残っているのは「移行前」「B に戻す」「Neon の場合」の文脈だけ

- [ ] **Step 4: Commit**

```bash
git add docs/deployment.md docs/README.md CLAUDE.md docs/issues_backlog.md render.yaml
git commit -m "docs: 8-6 の本番を Supabase＋24 時間キープアライブにする手順と文書を書く"
```

### Task 5: PR 1 を出す

- [ ] **Step 1: 規約の検査**

  Run: `docker compose exec backend bundle exec rubocop` と `docker compose exec backend bundle exec rspec`
  Expected: どちらも green（アプリのコードは変えていない）。`git status` に `backend/db/schema.rb` が無いこと

- [ ] **Step 2: 独立レビュー**

  `/code-review high` を差分にかけ、指摘を直したら、直した差分にもう一度かける

- [ ] **Step 3: プッシュして PR を作る**

  本文：`Refs #137`、スパイクの結果、`KOTOE_DB` 未設定のうちはワークフローが動かないこと、マージ後にユーザーが行うこと（Task 6）。
  末尾は `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。CI が green になること。
  **マージしても本番は Neon のまま**（`backend/config/database.yml` のコメントを変えているので、Render の再デプロイが 1 回走る。動きは変わらない）

### Task 6: 本番の切り替え（ユーザーと一緒に、PR 1 のマージ後）

日時をユーザーと決める。`docs/deployment.md` の手順どおりに進め、各ステップの結果をその場で報告する。

- [ ] **Step 1: 事前の確認**
  - ユーザーが `backend/.env.spike` に `NEON_DIRECT_URL` を足す → キー名と値の有無だけ確かめる
  - Neon のサーバーバージョンを確かめる（Review Focus 5）。**予行演習（2026-11-23）で 18.7 と判明**し、`pg_dump`/`pg_restore` 18 で Supabase（17）に流し込めることを確かめた。19 以上なら作業を止めて相談
  - Supabase の Settings で Data API が無効（ユーザーが目視）
  - Task 3 の SQL を Neon に流し、移行前の利用時間帯を記録する（Task 7 の比較の基準）
  - ユーザーが Render の Deploy Hook の URL を Secret `RENDER_DEPLOY_HOOK_URL` に、パスフレーズを `BACKUP_PASSPHRASE` に登録し、パスフレーズを手元にも控える
- [ ] **Step 1b: 当日より前に予行演習**：Neon を使ったまま、`docs/deployment.md` の移行の手順 4〜7 を Supabase に流して件数が一致することを確かめる（Supabase は当日の手順 5 でまた空にする）
- [ ] **Step 2: Neon に `generating` が 0、Solid Queue の ready・claimed・scheduled が 0**（Review Focus 4）。0 でなければ待つ。**Suspend の後にもう一度確かめ、`generating` が残っていれば `failed` にする**
- [ ] **Step 3: ユーザーが Render を Suspend**
- [ ] **Step 4: 受け皿を空にする → `pg_dump`（Neon）→ `~/kotoe-migration/`（権限 700）→ `pg_restore`（Supabase）→ `kotoe_backup` に GRANT し直す**
- [ ] **Step 5: 19 テーブルの件数とシーケンス（`users`）が一致**
- [ ] **Step 6: ユーザーが Render の `DATABASE_URL` を Supabase の Session pooler に差し替えて Resume**
- [ ] **Step 7: 本番の確認**：`/api/health` が `{"status":"ok","database":"ok",...}`、ログイン、一覧・詳細、生成 1 回（即公開まで）、いいね
- [ ] **Step 8: ユーザーが Secret `SUPABASE_BACKUP_URL`（`kotoe_backup`）と変数 `KOTOE_DB=supabase` を登録**
- [ ] **Step 9: 2 本を `workflow_dispatch` で流す**：バックアップが成功し artifact ができる。再起動のログに `memory=` の行があり、Render の Events に再デプロイが出る。**そのビルドにかかった時間と、バックアップの artifact の大きさを記録**（月 500 分と egress の見込みに使う）
- [ ] **Step 10: ユーザーが GAS のスクリプトとトリガーを作る**
- [ ] **Step 11: コールドスタートが無いことを確かめる**：20 分以上アクセスしないで置き、`/up` と `/api/health` が数百ミリ秒で返る

### Task 7: 1 週間の観察と PR 2

- [ ] **Step 1: 1 週間後に集める**：毎晩のログの `memory=`（7 日分の anon）、Supabase の Usage の egress、Render の Billing の稼働時間とビルド時間、バックアップの成否 7 回、GAS の失敗通知の有無
- [ ] **Step 2: 判定**：B に戻る条件（anon 470 MB 超え、egress の月の見込み 5GB 超え、一時停止）に当たっていないか。ビルド時間の月の見込みが 500 分を超えるなら cron を 2 日に 1 回に変える
- [ ] **Step 3: 新しいブランチで README・backlog に結果を書き、`backend/.env.spike` を削除し、`/code-review high` → PR 2（`Closes #137`）**
- [ ] **Step 4: 2 週間後・1 か月後の見直しの日付を backlog に書く**（利用時間帯の SQL もそこで回す）
