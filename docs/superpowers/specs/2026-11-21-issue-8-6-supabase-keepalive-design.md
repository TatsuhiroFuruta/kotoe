# issue 8-6 Supabase への乗り換えと 24 時間キープアライブ 設計

- 対象 issue：`docs/issues_backlog.md` 8-6（GitHub #137）
- 依存：8-2b（#30）、8-13（#165、生成した後のメモリ。2026-11-18 完了）
- 作成日：2026-11-21
- 前提：`docs/README.md`「無料枠の制約」「やってはいけないこと：キープアライブ」「24 時間起こし続けた実測」

## なぜやるか

Render の無料 Web は 15 分アイドルで眠り、次に開いた人が約 1 分待たされる。これを消したい。
あわせて、**24 時間すぐ開ける状態で、実際にどの時間帯に使われているかを見たい**（ユーザー、2026-11-21）。
その結果しだいで、後から B（Neon のまま時間帯を絞る）に戻すこともある。戻せることが A を試す前提になっている。

## ゴール・ゴールでないこと・失敗とみなすこと

- ゴール
  - 本番でコールドスタートが起きない（いつ開いても数百ミリ秒で応答する）
  - 月末まで無料枠に収まる見込みを数字で示せる（Render 750h、Supabase の egress 5GB）
  - バックアップが毎日取れている
  - 利用時間帯の分布を、後から B の時間帯を決められる形で見られる
  - B（Neon）へ戻る条件と手順が書いてあり、迷わず戻れる
- ゴールでないこと
  - 有料プランへの移行
  - アプリのコードの変更（DB 固有の記述は無く、`DATABASE_URL` の差し替えで済む。README「DB を Neon 以外に移す場合」）
  - 細かいアクセス解析（GA4 は 8-8）
- 失敗とみなすこと（動いていても）
  - Supabase の一時停止や egress 超過で、月の途中にサイトが止まる
  - メモリが天井に届いて、Render のコンテナが落ちる・入れ替わり続ける
  - 個人情報（`users` のメールアドレスなど）を含むバックアップが、誰でも取れる場所に置かれる
  - 戻すときに Neon のデータや接続先が失われていて戻れない

## 方式

| | 内容 | 評価 |
|---|---|---|
| **A（採用）** | Supabase へ移し、24 時間キープアライブ | 全時間帯でコールドスタートが消え、利用時間帯も偏りなく観測できる。メモリ対策（毎晩の再起動）と、バックアップの仕組みが要る |
| B | Neon のまま、キープアライブを日中（例：10h）に絞る | 乗り換えもバックアップも不要で、毎晩自然にリセットされる。時間帯の外は今と同じ約 1 分待ち。Neon の実測 約 0.255 CU-h/時で 10h/日 ≒ 77 CU-h/月（無料 100） |

ユーザーが A を選んだ（2026-11-21、「戻せるなら A で試したい」「全体の利用時間帯を見たい」）。
進め方は「① スパイクで測ってから本番を移す」と「② いきなり本番を移す」から ① を選んだ（同日）。

却下した案（2026-11-16 のブレスト）：Solid Queue のポーリング間隔を延ばして Neon を眠らせる（Neon は 5 分無問い合わせで初めて止まり、heartbeat 60 秒もある）、
`:async` アダプタ（4-1 のトランザクション保証と再起動時のジョブ消失）、無料 Redis（Render Key Value は再起動でデータ消失、Upstash は 50 万コマンド/月で足りない）。

## スパイクの結果（2026-11-21、ローカルの Rails → Supabase）

Supabase のプロジェクト：Free プラン、`ap-southeast-1`（Singapore。Render・Neon と同じ）、PostgreSQL 17.12、
作成時に Data API・新しいテーブルへの API 権限の自動付与・RLS の自動有効化をすべて無効にした。

| 項目 | 結果 |
|---|---|
| Direct connection（5432） | **つながらない**（IPv6 専用。`Network is unreachable`）。Render からも使えない前提にする |
| Session pooler（5432、`pooler.supabase.com`） | つながる。`db:schema:load` が通った（Kotoe のテーブル 18 ＋ 管理用 2） |
| Transaction pooler（6543） | **（2026-11-22 に、本番では使わないと決めた。下の「1. 接続」）** Solid Queue の 3 プロセスが登録され、PingJob 2 件（即時・5 秒後の予約）が完了、失敗 0。設定の変更なし（プリペアドステートメントも既定のまま） |
| `db:migrate`（Transaction pooler 経由） | 未適用のマイグレーションを 1 本作って流し、適用された。advisory lock の取り残し 0（**他に接続が無い状態での結果。後でワーカーと並べた検証では 6 回中 5 回失敗した。エラーの中身は取り損ねたが、同じ時間帯にワーカーが `relation ... does not exist` を出しており、`search_path` の持ち越しと見ている。下の「1. 接続」**） |
| 何もしないときの egress | 10 分ごとに 403 / 472 / 463 / 481 / 410 / 294 KB。**月 約 1.8 GB（平均）〜 2.1 GB（最大の区間）**。無料枠 5GB の約 4 割 |
| `pg_dump` | 開発コンテナのものが 17.12 で Supabase と一致 |

egress はコンテナの受信バイト数（TLS・TCP の余分を含む）で数えた。Supabase は Shared Pooler Egress として 1 回だけ数え、無料枠 5GB から引く
（<https://supabase.com/docs/guides/platform/manage-your-usage/egress>）。最後の区間が少なかった理由は不明（ワーカーは動き続けていた）。

**注意**：開発の Rails を Supabase に向けて `db:migrate` すると、`schema.rb` に Supabase の拡張（`extensions.*`・`vault.*`）と
`public.` 付きのテーブル名が書き出される。**開発環境から Supabase にマイグレーションを流さない**。本番は
`dump_schema_after_migration = false`（`config/environments/production.rb`）なので起きない。

調べたこと：Render の無料プランのドキュメントにキープアライブを禁止する記述は無い。「外向きの通信が異常に多い無料サービスは停止されうる」
「無料サービスはいつでも再起動されうる」とある（<https://render.com/docs/free>）。ping は外から来る通信なので前者には当たらない見込み。
Neon が使われていない無料プロジェクトを自動で削除する方針は見つからなかった（使われていないブランチはストレージへ退避され、アクセスで戻る）。

## 構成（移した後）

```
GAS ──10 分おき──▶ Render /up（DB に触れない）
                              │ 起き続ける
                              ▼
                        Puma + Solid Queue ──Session pooler(5432)──▶ Supabase（Singapore、Pool Size 30）
                              ▲
GitHub Actions（毎晩）── /api/health を記録 → Deploy Hook で再デプロイ（メモリのリセット）
GitHub Actions（毎日）── Session pooler 経由で pg_dump → 暗号化 → artifact（一時停止の予防も兼ねる）
Neon ──（何もしない。戻り先として残す）
```

### 0. 進め方（PR と切り替えの順番）（Claude の判断）

schedule のワークフローは main に入って初めて動く。切り替えより先に動くと、Neon 構成の Render を毎晩再デプロイしたり、
空の Supabase を「成功」としてバックアップしたりする。GAS のトリガーを先に有効にすると「Neon のままキープアライブ」になる（README で禁止）。

1. **PR 1（`Refs #137`）**：ワークフロー 2 本・手順書（`docs/deployment.md`）・README / CLAUDE.md の更新。
   ワークフローは **リポジトリ変数 `KOTOE_DB` が `supabase` のときだけ動く**ようにする（未設定なら何もせず成功で終わる）。`workflow_dispatch` も付ける。
   README などは「切り替えた後の構成」として書く（マージから切り替えまでの数日のずれは許容する）
2. PR 1 をマージ（Render は再デプロイされるが Neon のまま。ワークフローは `KOTOE_DB` 未設定なので動かない）
3. **切り替え当日**：下の「移行の手順」→ `KOTOE_DB=supabase` を設定 → 2 本を `workflow_dispatch` で 1 回ずつ流して成功を確かめる → GAS のトリガーを有効にする
4. **PR 2（`Closes #137`）**：1 週間の実測（egress・anon・ビルド時間・バックアップの成功）と月の見込みを README と backlog に追記

B に戻すときは `KOTOE_DB` を消せば、再起動とバックアップは止まる。

### 1. 接続

- Render の `DATABASE_URL` を **Supabase の Session pooler（5432）** にする。`database.yml` の設定は変えない（コメントだけ直す）
- **Transaction pooler（6543）は使わない**（2026-11-22 に変更）。1 つの DB 接続を複数のクライアントで使い回すため、接続ごとの設定（`search_path` など）が別のクライアントに持ち越される。8-6 の実装中、開発環境から Supabase にマイグレーションを流した後、`search_path` が `extensions` だけになった接続が残り、Rails から `public` のテーブルが見えなくなった（`relation ... does not exist`。何が変えたかは未確認で、Rails のスキーマの書き出しを疑っている）。マイグレーションの advisory lock も、取得と解放が別の接続に振られうる。Session pooler は 1 クライアントが 1 接続を占有するので、どちらも起きない。代わりに **Pool Size（同時接続の上限）** に当たりうる。計測（ローカルの Rails を Session pooler に接続、Puma の中で Solid Queue）ではアプリの接続は待機中 4 本・負荷の後 10 本。**Pool Size を 15 から 30 に上げた**（DB の `max_connections` は 60。30 にした後、25 本の同時接続を確認）。Session pooler では、ワーカーを動かしたまま `db:migrate` を 6 回流してすべて成功した（ユーザーと合意、2026-11-22）。本番の接続数の見込み・接続プールの上限との比較・あふれたときの見え方・Session pooler の設定リセットの確認は `docs/deployment.md`「接続文字列の使い分け」にまとめた（そちらが正）
- `pg_dump` / `pg_restore` / 手動の `psql` は **Session pooler（5432、`pooler.supabase.com`）** を使う（Direct は IPv6 専用で使えない）
- Supabase の Settings で Data API が無効になっていることを移行前に確かめる（スクリーンショット不要、目視でよい）

### 2. 移行の手順（本番）

止める時間の目安は DB の作業で 5 分前後（予行演習の実測）、Render の切り替えと確認を含めて 20〜30 分の枠を取る（`docs/deployment.md`）。利用の少ない時間帯にユーザーと日時を決めて行う。

実行するのは Claude（`postgres:18` イメージの `pg_dump`/`pg_restore` 18 から。Neon が 18.7 のため。当初は開発コンテナの 17.12 の予定だった）（Claude の判断）。接続文字列は `backend/.env.spike`（git 管理外、権限 600）に
ユーザーが `NEON_DIRECT_URL`（Neon のプールしない接続文字列）を足して受け渡す。値は表示しない。
ダンプの保存先はリポジトリの外の `~/kotoe-migration/`（権限 700）。

1. **Supabase の受け皿を空にする。** スパイクで作ったテーブルを消す（`public` の Kotoe のテーブル 18 個と `ar_internal_metadata`・`schema_migrations` だけ。`public` スキーマ自体は消さない）
2. **生成中が無いことを確かめる。** Neon で `attempts` の `status = generating` が 0 件、Solid Queue の ready・claimed・scheduled が 0 件
3. **書き込みを止める。** Render のダッシュボードでサービスを Suspend する（Resume するまでフロントはエラー表示になる。許容する）
4. **Neon から書き出す。** Neon の**プールしない**接続文字列で `pg_dump -Fc -n public --no-owner --no-privileges`。**予行演習（2026-11-23）で Neon は PostgreSQL 18.7 と判明**したので、`pg_dump` 18 を使う。**19 以上に上がっていたら作業を止めて相談する**（19 → 17 の流し込みは確かめていない）。
   ダンプは**リポジトリの外**（手元）に保存し、戻すときのために残す
5. **Supabase に流し込む。** Session pooler に `pg_restore` 18 で流す。`CREATE SCHEMA public` を除いた一覧（`-L`）と `--exit-on-error` を使う（予行演習で、Supabase 17 に件数の一致まで確かめた。コマンドは `docs/deployment.md`）
6. **件数を比べる。** 全 20 テーブルの件数を Neon と Supabase で比べ、一致を確かめる。シーケンスの現在値も 1 つ（`users`）比べる
7. **切り替える。** Render の `DATABASE_URL` を Supabase の Session pooler に差し替え、Resume する
8. **確かめる。** `/api/health`（DB 接続を含む）、ログイン、一覧・詳細の表示、生成 1 回（即公開まで）、いいね。終わったら生成した挑戦はマイページから削除してよい
9. **Neon はそのまま残す**（削除しない。プロジェクトも接続文字列も変えない）

### 3. キープアライブ

- **GAS（Google Apps Script）** の時間主導型トリガーで、`https://kotoe-api.onrender.com/up` を **10 分おき**に GET する
  （ユーザーが選んだ、2026-11-21。外部サービスのアカウントを増やさず、ユーザーの Google アカウントで済むため。cron-job.org も候補だった）
  - スクリプトは `UrlFetchApp.fetch(url, { muteHttpExceptions: true })` の数行。`docs/deployment.md` に載せる
  - トリガーの「10 分おき」は数分ずれることがあるが、15 分未満なら眠らない。1 回飛ぶと間が 20 分になって一度眠り、次に開いた人が 1 回コールドスタートを踏む。これは許容する
  - 無料アカウントの上限（URL の取得・トリガーの合計実行時間）に 1 日 144 回が収まることを、実装時に Google の公式ページで確かめる
  - 失敗時のメール通知を有効にする
  - `/up` は DB に触れない（`/api/health` は `SELECT 1` する）。Supabase では DB に触れても困らないが、余計な egress を増やさない
  - URL に秘密は含まれないので、外部に置いてよい
  - GitHub Actions の schedule は数十分遅れることがあり、10 分間隔の用途には使わない
- GAS のプロジェクトとトリガーはユーザーが作る（手順は書く）

### 4. 毎晩の再起動（メモリ対策）

8-13 の結論：生成なしでも anon は 24 時間で 443 MB（天井 約 480）まで増え、止まっていない。何日も起こし続けるなら定期的なリセットが要る。
今は 15 分アイドルで眠ることが自然なリセットになっているが、キープアライブでその機会が無くなるので、代わりに足す（Supabase ではなく Render のメモリのため）。

増加の原因は特定していない（README の候補：Solid Queue のポーリング、copy-on-write の解消。2 秒おきの計測リクエストも候補に
挙がっているが、それは 1 回目の 3 時間の記録の話で、24 時間の記録は `/up` 10 分おき＋`/api/health` 30 分おきと、本番のキープアライブに近い条件だった）。
再起動はどれが原因でも効くので、**原因の調査は先にしない**（ユーザーと合意、2026-11-21）。再起動の直前に毎日記録する anon を、
8-13 の 24 時間の記録（起動から約 24 時間ではなく、計測開始の 339 から +104 MB の 443）と比べ、実際の利用の上乗せが毎日どれだけあるかを見る材料にする。

- **GitHub Actions の schedule** で毎晩 **04:00 JST（19:00 UTC）** ごろに実行（数十分遅れても困らない）
  1. `/api/health` を取得し、`memory`（`anon_mb`・`peak_mb` など）をジョブのログに 1 行で出す（毎日の記録になる。値は今も公開エンドポイントで見られるもので、秘密ではない）
  2. Render の **Deploy Hook**（`RENDER_DEPLOY_HOOK_URL`、GitHub Secrets）に POST して再デプロイする
- Deploy Hook は main の最新を再デプロイする。Render は main 追跡なので、本番に出る内容は変わらない
- 再デプロイはビルド（`bin/render-build.sh`：`bundle install` と `db:migrate`）を伴う。**Render の無料のビルド時間の上限に収まるかを実装時に確かめる**
  （1 回のビルド時間 × 30 日 ＋ 通常のデプロイ）。**収まらなければ 2 日に 1 回に減らす**（ユーザーが選んだ、2026-11-21）。
  Render API の restart（ビルドなし）は使わない（API キーがアカウント全体の権限を持ち、公開リポジトリの Secrets に置きたくないため）。
  2 日に 1 回にすると、2 日目のメモリは未計測なので「anon 470 MB 超えで B に戻る」に当たりやすくなる。そのときは B に戻す
  - 数字：Render の Hobby ワークスペースのビルド枠は **月 500 分**（<https://render.com/docs/build-pipeline>）。超えると、支払い方法が無ければその月のビルドがすべて止まる
    （**通常のデプロイもできなくなる**）。1 回 3 分なら毎晩で月 90 分、5 分なら 150 分
  - 切り替え当日に Render の Events で 1 回のビルド時間を記録し、PR 2 で月の見込みを出す
- 再起動の瞬間に生成ジョブが走っていると、やり直しになりうる。04:00 は使われにくい時間として受け入れる

### 5. バックアップ（毎日）

Supabase の無料プランには自動バックアップが無い（<https://supabase.com/docs/guides/platform/backups>）。

- **読み取り専用のロール `kotoe_backup` を作り、それで接続する**（Claude の判断）。`postgres` の接続文字列は公開リポジトリの Secrets に置かない。
  `public` のテーブルとシーケンスへの `SELECT` だけを付ける。作るのは移行手順の 5 の後。Session pooler でのユーザー名は `kotoe_backup.<プロジェクト参照>` の形になる（実装時に接続を確かめる）
- **GitHub Actions の schedule** で毎日 1 回、Session pooler 経由で `pg_dump -Fc -n public --no-owner --no-privileges`
- **必ず暗号化してから** artifact に上げる（`gpg --symmetric`、パスフレーズは GitHub Secrets）。
  **公開リポジトリの artifact は、GitHub にログインした誰でもダウンロードできる**ため、平文では置かない（`users` のメールアドレスなどが入る）
- 保持は 7 日（artifact の retention）。パスフレーズはユーザーがリポジトリの外にも控える（無くすと復元できない）
- このジョブは Supabase への DB アクセスになるので、7 日無活動での一時停止の保険も兼ねる
- 注意：公開リポジトリでは、60 日間コミットが無いと schedule のワークフローが無効化される。README に書いておく
- 復元の手順（`gpg -d` → `pg_restore`）を `docs/deployment.md` に書き、**一度ローカルの空の DB で復元を試す**

### 6. 利用時間帯の見方

コードを足さず、**今ある `created_at` を時間帯（JST）ごとに数える** SQL で見る。

- 対象：`users`（登録）、`attempts`（描写・生成）、`likes`、`favorites`、`posts`
- 閲覧だけの訪問は数えられない（記録が無い）。書き込みのある利用の分布として扱う
- 移行前の Neon にあるデータも、同じ SQL で過去分として見られる
- SQL は `docs/deployment.md` に置き、見るタイミングは下の「見直し」に合わせる

Render のログは保持期間の公式な記載が見つからない（第三者の情報で 7 日）ため、頼らない。

### 7. 見張りと B に戻る条件

| 見るもの | どこで | 頻度 | B に戻る条件 |
|---|---|---|---|
| メモリ（anon） | 毎晩のジョブのログ | 週 1 回まとめて見る | **anon が 470 MB を超えた日がある** |
| egress | Supabase の Usage | 週 1 回 | **月の見込みが 5GB を超える** |
| 一時停止 | Supabase のダッシュボード・サイトの表示 | 起きたら気づく | **1 回でも起きる** |
| Render の稼働時間 | Render の Billing | 月 1 回 | 750h に届きそう（他の無料サービスと合算） |

- **見直し**：移してから 2 週間後と 1 か月後に、上の数字と利用時間帯をまとめ、A を続けるか B に戻すかを決める（ユーザーと）
- **B に戻す手順**：2 の逆（Supabase から書き出し → Neon に流し込み → 件数を比べる → `DATABASE_URL` を Neon のプール接続に戻す）。
  **流し込む前に、Neon で今の main からブランチ（例：`pre-supabase-2026-xx-xx`）を切って移行前のデータを残す**（Claude の判断。無料プランでもブランチは作れる）。
  そのうえで Neon の main の `public` の Kotoe のテーブルを消して流し込む。手元の移行時のダンプ（`~/kotoe-migration/`）は二重の保険
  そのうえで GAS のトリガーを時間帯で絞り（スクリプトで JST の時刻を見て、時間外は何もしない）、毎晩の再起動のワークフローを止める（B では毎晩眠るので不要）。
  バックアップのワークフローも止める（Neon は自前で履歴を持つ）

## 文書の更新

- `docs/README.md`：「無料枠の制約」（連動して眠る仕組みは Supabase では成り立たない）、「やってはいけないこと：キープアライブ」（Neon のときの話として残し、今の構成を書く）、
  「DB を Neon 以外に移す場合」（Supabase の行：RAM は共有、Direct は IPv6 専用、egress の実測）
- `docs/deployment.md`：Neon の手順を Supabase に置き換え、移行・戻し・復元・利用時間帯の SQL を足す
- `CLAUDE.md`：技術スタックの DB（本番は Supabase、Session pooler）。開発から Supabase にマイグレーションを流さない旨
- `docs/issues_backlog.md` 8-6：結果と完了
- `render.yaml`：`DATABASE_URL` のコメントのみ（値は手入力のまま）

## ユーザーが行うこと

- GAS のプロジェクト作成とトリガーの設定（手順は書く）
- GitHub Secrets の登録：`RENDER_DEPLOY_HOOK_URL`、バックアップ用の接続文字列（`kotoe_backup`）、`gpg` のパスフレーズ。リポジトリ変数 `KOTOE_DB`
- `backend/.env.spike` に `NEON_DIRECT_URL` を足す（移行の直前）
- Render のダッシュボードでの Suspend・Resume・環境変数の差し替え（作業日時を一緒に決める）
- 2 週間後・1 か月後の見直し

## 完了条件

- 本番でコールドスタートが起きない（眠るはずの時間を空けてから開き、数百ミリ秒で応答する）
- 1 か月の見込みが無料枠に収まる：Render 730h（他の無料サービスと合わせて 750h 未満）、Supabase egress（1 週間の実測から月に換算）
- バックアップのワークフローが毎日成功し、ローカルで一度復元できた
- 毎晩の再起動が動き、その日の anon がログに残っている
- 上の文書が更新されている
- `backend/.env.spike` を削除した

## 実装者に任せること

- ワークフローのファイル名・ジョブの細かい書き方
- `pg_dump` / `pg_restore` の正確なオプション（上の方針の範囲で）
- 件数比較のスクリプトの形
- 利用時間帯の SQL の形（JST で時間ごと、テーブルごとに出す）
