# issue 4-1 設計：非同期処理の基盤（Solid Queue）

作成日：2026-07-31 / 対象 issue：`docs/issues_backlog.md` 4-1

## 目的

画像生成をジョブ化するための土台を用意する。この issue で作るのは**基盤と疎通確認まで**で、
`GenerateImageJob` そのものは 4-2 で書く。

Solid Queue を採用する理由は `docs/README.md` の「非同期処理の選定」に記載済み。要点は
**Render の無料プランではバックグラウンドワーカーが別サービス扱いで有料になる**ため、
Puma プロセス内で動かせる Solid Queue なら Web サービス 1 つで完結すること。
2026-07-31 時点で再確認したところ、この前提は変わっていない（後述）。

## 決定事項

| 項目 | 決定 |
|---|---|
| ジョブテーブルの置き場所 | **アプリと同じデータベースに同居** |
| 本番のワーカー起動 | **Puma プラグイン**（`plugin :solid_queue`）で Web プロセスから fork |
| ローカルのワーカー起動 | docker-compose に **`worker` サービス**を追加し `bin/jobs` を走らせる |
| worker の polling_interval | **1 秒**（既定 0.1 秒から緩める） |
| キュー | `"*"` の 1 本のみ。細分化しない |

### なぜ同居させるか（別 DB にしない理由）

Rails 8 の既定は `db/queue_schema.rb` ＋ `connects_to` による別データベース構成だが、Kotoe では採らない。

1. **Neon では分離の利益が出ない。** 同一ブランチ内の 2 つのデータベースは同じコンピュート
   エンドポイントに乗る。`docs/README.md` に書いたオートサスペンドの懸念も、接続数も、
   ストレージ枠も、分けたところで一切改善しない。本当に分けるには別ブランチか別プロジェクトが
   必要で、それは有料プランの話になる。
2. **ジョブ量が分離の閾値から 3〜4 桁遠い。** solid_queue のテーブルは insert/delete が激しく、
   量が増えると autovacuum の負荷がアプリ側に波及する。これが本来の分離動機だが、境目は
   おおむね秒間数百ジョブ。Kotoe の生成ジョブは 1 ユーザーあたりの日次上限で頭打ちになるため、
   DAU 1,000 人 × 1 日 10 回でも秒間 0.12 件にしかならない。
3. **後から分けるのが安い。** ジョブはクラス名で参照されるだけで、アプリのテーブルから
   solid_queue への外部キーは存在しない。移行はキューが空の瞬間（生成ジョブは最長 60 秒なので
   enqueue を止めて 1〜2 分待てば空になる）に、`database.yml` へ `queue:` を足し、
   `connects_to` を設定し、新 DB に schema を流し、旧テーブルを drop するだけで済む。
   アプリのコードは変わらない。

同居のコストは Solid Queue のポーリングクエリ（定常で毎秒 10 本強）だが、これは
`polling_interval` を緩めることで調整する話であり、DB を分けても減らない。

将来の選択肢を残すために必要なのは「solid_queue のテーブルを独立したマイグレーションで作る」
「アプリのテーブルから solid_queue へ外部キーを張らない」の 2 点だけで、どちらも自然にそうなる。

### なぜ本番を in-Puma にするか

Render の無料インスタンスタイプが使えるのは Web Service / Static Site / Postgres / Key Value の
4 つだけで、**Background Worker は対象外**（最低 $7/月・Starter）。

さらに重要なのは、常駐ワーカーを立てると **Neon の無料枠も維持できなくなる**こと。
現状は「Render 無料 Web が 15 分アイドルでコンテナごと停止 → fork された supervisor も死ぬ →
ポーリングが止まる → Neon がサスペンド」という連鎖で無料に収まっている。常駐ワーカーは
この連鎖の起点を消すため、Neon を 24 時間起こし続ける。1 か月 730 時間 × 最小 0.25 CU ＝
182.5 CU-hours で、無料枠 100 CU-hours を月の 55% 地点で使い切る。

つまり「ワーカーだけ $7 で分離」は実質 $13〜26/月のコミットになる。in-Puma を選ぶ理由は
「Render が無料だから」だけでなく、**全プロセスが一緒に寝ることで Neon も無料に収まるから**でもある。

なお、この退路は塞がらない。512 MB に収まらないと判明した場合、`plugin :solid_queue` を外して
`render.yaml` に `type: worker` を足すだけで切り出せる（アプリのコードは変わらない）。

### なぜローカルだけ別サービスにするか

4-2 / 4-3 で `GenerateImageJob` を繰り返し書き換えることになるが、Solid Queue は開発環境でも
ジョブのコードを自動リロードしない。別サービスなら `docker compose restart worker` で数秒、
Rails サーバーを落とさずに回せる。ジョブのログがリクエストログと混ざらない利点もある。

代償は `plugin :solid_queue` の行がローカルで一度も実行されないこと。設定ミスがあっても
本番デプロイまで気づけないが、失敗は明白（ジョブが処理されない）で一度きりのリスクであり、
4-2 の本番確認で捕まえられる。

## 変更するファイル

### backend/

| ファイル | 変更 |
|---|---|
| `Gemfile` / `Gemfile.lock` | `gem "solid_queue"` を追加 |
| `db/migrate/XXXX_create_solid_queue_tables.rb` | 新規。`solid_queue:install` が生成する `db/queue_schema.rb` の内容を通常のマイグレーションへ移す |
| `db/queue_schema.rb` | 生成後に**削除**（単一 DB 構成のため不要） |
| `db/schema.rb` | 自動更新（`solid_queue_*` が載る） |
| `config/queue.yml` | 新規（後述） |
| `config/recurring.yml` | 新規・空。MVP では cron 用途なし |
| `config/environments/development.rb` | `config.active_job.queue_adapter = :solid_queue` |
| `config/environments/production.rb` | 同上。`config.solid_queue.connects_to` は**入れない** |
| `config/environments/test.rb` | `config.active_job.queue_adapter = :test` |
| `config/puma.rb` | `plugin :solid_queue if ENV["SOLID_QUEUE_IN_PUMA"]` |
| `bin/jobs` | 新規（生成物） |
| `app/jobs/ping_job.rb` | 新規 |
| `spec/jobs/ping_job_spec.rb` | 新規 |

### ルート

| ファイル | 変更 |
|---|---|
| `docker-compose.yml` | `worker` サービスを追加 |
| `render.yaml` | `SOLID_QUEUE_IN_PUMA: "true"` を追加 |
| `docs/deployment.md` | 環境変数と、ワーカーが Web プロセス内で動くことを追記 |
| `docs/README.md` | Neon のサスペンド懸念メモを実数値で更新 |
| `docs/issues_backlog.md` | 4-1 のチェックボックスと、本番確認を 4-2 へ委譲する旨 |

## 設定

### config/queue.yml

```yaml
default: &default
  dispatchers:
    - polling_interval: 1
      batch_size: 500
  workers:
    - queues: "*"
      threads: 3
      processes: 1
      polling_interval: 1

development:
  <<: *default

test:
  <<: *default

production:
  <<: *default
```

- **`polling_interval: 1`（worker）** … 既定は 0.1 秒。画像生成は 10〜60 秒かかるジョブなので
  取得が 1 秒遅れても体感に出ず、Neon へのクエリが 1/10 になる。
- **`processes: 1`** … Render 無料枠の 512 MB を意識。スレッドはプロセス内でメモリを共有するため、
  メモリに効くのはプロセス数。
- **`queues: "*"`** … MVP で動くジョブは実質「画像生成」1 種類。キュー名の細分化は必要になってから。
- `test:` セクションは実際には読まれない（テスト環境の ActiveJob アダプタは `:test` で、
  `queue.yml` を読むのは supervisor / `bin/jobs` だけ）。将来テスト環境でワーカーを起こしたく
  なったときのために置いておく。

### docker-compose.yml の worker サービス

`backend` と同じビルド（`./backend` / `Dockerfile.dev`）・同じボリューム
（`./backend:/app` と `bundle`）を使い、`command` だけ `bundle exec bin/jobs` に差し替える。

`env_file` は backend と同じ **2 本**を指定する：ルートの `.env.development`（DB 接続・CORS）と
`backend/.env.development`（Rails 専用の秘密）。ワーカーは DB へ接続し、4-2 以降は Cloudinary と
画像生成 API のキーも使うため、backend と同じ秘密の到達範囲が要る。

`depends_on` は `db`（`condition: service_healthy`）。`RAILS_ENV: development` と
`TZ: Asia/Tokyo` も backend に揃える（日付境界がずれると 4-2 の日次上限がずれるため）。
ポートは公開しない。

## ダミージョブ

`app/jobs/ping_job.rb`。引数のメッセージをログに出すだけで、副作用を持たない。

**API から叩く導線は作らない。** 公開 API に「任意にジョブを積める口」を開けることになるため。
enqueue は `bin/rails runner` / console からのみ行う。

4-2 以降も「キューが生きているか」を確かめるプローブとして残す。

## テスト

テスト環境の ActiveJob アダプタは `:test`（spec が実際のキューを触らないようにする）。その上で
spec を 2 本書く。

1. **`PingJob#perform` がメッセージをログに出すこと。**
2. **`:solid_queue` アダプタで `perform_later` すると `SolidQueue::Job` が 1 件増えること。**
   この spec 内でのみアダプタを差し替える。同居構成を選んだ以上、「アプリと同じ DB に
   solid_queue のテーブルが正しく作られている」ことは自動テストで守る価値がある。

ワーカープロセスが実際にジョブを取得して実行する部分は、プロセスをまたぐため spec では扱わず、
下記の手動確認と 4-2 の本番確認でカバーする。

## 動作確認

```bash
docker compose up
docker compose exec -e RAILS_ENV=test backend bin/rails db:prepare   # 新マイグレーションを test DB へ
docker compose exec backend bin/rails runner 'PingJob.perform_later("hello")'
docker compose logs worker                                          # [PingJob] hello が出る
docker compose exec backend bin/rails runner 'puts SolidQueue::Job.count'
```

コミット前に `bundle exec rubocop` と `bundle exec rspec` を通す。

## 本番での確認は 4-2 に持ち越す

**Render の無料インスタンスはシェルが使えない**（SSH もダッシュボードのシェルも有料インスタンス限定）。
そのため 4-1 の時点では、本番で `PingJob` を enqueue する手段がない。

この issue では**本番設定を書くところまで**を完了とし、ワーカーが本番で実際に動いていることの
確認は 4-2 へ委譲する。4-2 で `POST /api/attempts/:id/generate` ができれば、HTTP 経由で
enqueue → status が `generating` → `published` に変わることを確認でき、それがそのまま
ワーカー稼働の証明になる。4-2 の完了条件にこの確認を足す。

あわせて、Render 無料枠の 512 MB に Puma ＋ supervisor ＋ dispatcher ＋ worker が収まるかも
4-2 / 8-2 系で実測する（4-2 で画像バイト列がメモリに乗るとさらに厳しくなるため）。
収まらない場合の対処は上記「なぜ本番を in-Puma にするか」に記載。

## この issue でやらないこと

- `GenerateImageJob`（4-2）
- 生成回数の日次上限（4-2）
- リトライ・失敗時の status 遷移（4-3）
- recurring tasks（cron 相当）
- キュー名の細分化・優先度

## 完了条件

- `docker compose up` で `worker` サービスが起動し、`PingJob.perform_later` したジョブを処理する
- `rubocop` / `rspec` が green
- 本番向けの設定（`plugin :solid_queue` と `SOLID_QUEUE_IN_PUMA`）が入っている
  ※本番での実動作確認は 4-2

## 参照

- [Solid Queue](https://github.com/rails/solid_queue)
- [Render: Deploy for Free](https://render.com/docs/free) / [Background Workers](https://render.com/docs/background-workers) / [SSH and Shell Access](https://render.com/docs/ssh)
- [Neon: plans](https://neon.com/docs/introduction/plans) / [pricing](https://neon.com/pricing)
