# issue 4-1 非同期処理の基盤（Solid Queue）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Solid Queue を導入し、ジョブを enqueue するとワーカーが処理する流れをローカルで動かし、本番（Render 無料枠）向けの設定を入れる。

**Architecture:** ジョブテーブルはアプリと同じデータベースに同居させる（`db/migrate` に通常のマイグレーションとして追加し `schema.rb` に載せる）。本番のワーカーは Puma プラグインで Web プロセスから fork し、ローカルは docker-compose の `worker` サービスで `bin/jobs` を走らせる。この issue で作るのは基盤と疎通確認用のダミージョブまでで、`GenerateImageJob` は 4-2 で書く。

**Tech Stack:** Ruby 3.4.10 / Rails 8.1.3.1（API モード）/ PostgreSQL 16 / Solid Queue / RSpec / Docker Compose / Render（本番）

**設計ドキュメント:** `docs/superpowers/specs/2026-07-31-issue-4-1-solid-queue-design.md`

## Global Constraints

- 作業ブランチは `feature/issue-4-1`（main から作成済み）。**main へ直接コミットしない**。
- **文字列はダブルクォート**。spec ファイルも含めプロジェクト全体で統一（`.rubocop.yml` の `Style/StringLiterals`）。
- コメント・コミットメッセージ・spec の `describe` / `it` は**日本語**で書く（既存コードに合わせる）。
- コミット前に `bundle exec rubocop` と `bundle exec rspec` を通す。
- コマンドは**すべて docker compose 経由**で実行する（ホストに Ruby 3.4.10 は入っていない）。
- `config.solid_queue.connects_to` は**設定しない**。これが単一データベース構成のスイッチ。
- 論理削除は `discard`、物理削除しない（この issue では該当なし）。
- `bundle exec rubocop` の対象外：`db/schema.rb` / `db/migrate/**/*` / `bin/**/*`。
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を付ける。

## File Structure

| ファイル | 責務 |
|---|---|
| `backend/app/jobs/ping_job.rb` | 疎通確認用ダミージョブ。ログを出すだけで副作用を持たない |
| `backend/spec/jobs/ping_job_spec.rb` | PingJob の振る舞い（ログ出力・キュー名） |
| `backend/spec/jobs/solid_queue_spec.rb` | 「ジョブテーブルがアプリと同じ DB に同居している」という構成上の前提を守る |
| `backend/db/migrate/*_create_solid_queue_tables.rb` | solid_queue の全テーブル。生成物 `db/queue_schema.rb` を通常のマイグレーションへ移したもの |
| `backend/config/queue.yml` | ワーカー / ディスパッチャの構成（生成物のまま） |
| `backend/config/recurring.yml` | 完了ジョブの定期掃除（生成物のまま） |
| `backend/config/environments/{development,test,production}.rb` | ActiveJob アダプタの切り替え |
| `backend/config/puma.rb` | 本番のみワーカーを Puma 内で起動 |
| `backend/bin/jobs` | ワーカーの起動スクリプト（生成物） |
| `docker-compose.yml` | ローカルの `worker` サービス |
| `render.yaml` | 本番の `SOLID_QUEUE_IN_PUMA` |

---

### Task 1: ダミージョブ `PingJob` とテスト環境の ActiveJob アダプタ

Solid Queue を入れる前に、ジョブそのものを先に作る。ここではまだ gem を足さない。

**Files:**
- Create: `backend/app/jobs/ping_job.rb`
- Create: `backend/spec/jobs/ping_job_spec.rb`
- Modify: `backend/config/environments/test.rb`（`config.action_mailer.delivery_method = :test` の直後）

**Interfaces:**
- Consumes: `ApplicationJob`（`backend/app/jobs/application_job.rb`、既存）
- Produces: `PingJob.perform_now(message = "pong")` / `PingJob.perform_later(message = "pong")` — `Rails.logger.info("[PingJob] #{message}")` を 1 回呼ぶ。キュー名は `"default"`。Task 2 の spec がこのクラスを使う。

- [ ] **Step 1: テスト環境の ActiveJob アダプタを `:test` にする**

`backend/config/environments/test.rb` の `config.action_mailer.delivery_method = :test` の行の**直後**に、空行を挟んで以下を追加する。

```ruby
  # ActiveJob の既定アダプタは :async で、spec 内の perform_later が別スレッドで実際に
  # 走ってしまう。テストでは :test アダプタ（enqueue を記録するだけで実行しない）を使い、
  # have_enqueued_job で検証する。Solid Queue の実キューを触る spec は
  # spec/jobs/solid_queue_spec.rb だけで、そこだけアダプタを差し替える。
  config.active_job.queue_adapter = :test
```

- [ ] **Step 2: 失敗するテストを書く**

`backend/spec/jobs/ping_job_spec.rb` を新規作成する。

```ruby
require "rails_helper"

RSpec.describe PingJob do
  describe "#perform" do
    it "受け取ったメッセージをログに出す" do
      allow(Rails.logger).to receive(:info)

      described_class.perform_now("hello")

      expect(Rails.logger).to have_received(:info).with("[PingJob] hello")
    end

    it "引数を省略すると pong を出す" do
      allow(Rails.logger).to receive(:info)

      described_class.perform_now

      expect(Rails.logger).to have_received(:info).with("[PingJob] pong")
    end
  end

  describe "キュー" do
    it "default キューに積まれる" do
      expect { described_class.perform_later("hi") }
        .to have_enqueued_job(described_class).on_queue("default")
    end
  end
end
```

- [ ] **Step 3: テストが失敗することを確認する**

```bash
docker compose exec backend bundle exec rspec spec/jobs/ping_job_spec.rb
```

期待：`NameError: uninitialized constant PingJob` で 3 件とも失敗する。

- [ ] **Step 4: `PingJob` を実装する**

`backend/app/jobs/ping_job.rb` を新規作成する。

```ruby
# Solid Queue の疎通確認用。キューが生きているかを、アプリの状態を一切変えずに確かめる。
#
# API から叩く導線は作らない。公開 API に「任意のジョブを積める口」を開けることになるため。
# enqueue は bin/rails runner か console から行う:
#   docker compose exec backend bin/rails runner 'PingJob.perform_later("hello")'
#
# 4-2 以降も、ワーカーが生きているかを確かめるプローブとして残す。
class PingJob < ApplicationJob
  queue_as :default

  def perform(message = "pong")
    Rails.logger.info("[PingJob] #{message}")
  end
end
```

- [ ] **Step 5: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/jobs/ping_job_spec.rb
```

期待：3 examples, 0 failures。

**`app/jobs/` は既存ディレクトリだが、もし `uninitialized constant PingJob` が rspec では消えたのに
`rails runner` 側で残る場合は `docker compose restart backend` する**（Rails は新規ファイルを
autoload できるが、起動中のプロセスが古い eager load 結果を持つことがある）。

- [ ] **Step 6: rubocop と全 spec を通す**

```bash
docker compose exec backend bundle exec rubocop
docker compose exec backend bundle exec rspec
```

期待：どちらも green。

- [ ] **Step 7: コミット**

```bash
git add backend/app/jobs/ping_job.rb backend/spec/jobs/ping_job_spec.rb backend/config/environments/test.rb
git commit -F - <<'EOF'
feat: 疎通確認用の PingJob を追加する

Solid Queue の導入前に、ジョブそのものを先に作る。ログを出すだけで副作用を
持たず、API から叩く導線も作らない（公開 API に任意のジョブを積める口を
開けないため）。

あわせてテスト環境の ActiveJob アダプタを :test に固定した。既定の :async は
spec 内の perform_later を別スレッドで実際に走らせてしまう。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Solid Queue の導入と単一データベース構成のマイグレーション

**Files:**
- Create: `backend/spec/jobs/solid_queue_spec.rb`
- Create: `backend/db/migrate/<timestamp>_create_solid_queue_tables.rb`
- Create: `backend/config/queue.yml`（生成物）
- Create: `backend/config/recurring.yml`（生成物）
- Create: `backend/bin/jobs`（生成物）
- Modify: `backend/Gemfile` / `backend/Gemfile.lock`
- Modify: `backend/config/environments/production.rb`（ジェネレータが書き換える）
- Modify: `backend/db/schema.rb`（自動更新）
- Delete: `backend/db/queue_schema.rb`（生成物。単一 DB 構成では不要）

**Interfaces:**
- Consumes: `PingJob`（Task 1）
- Produces: `SolidQueue::Job`（ActiveRecord モデル。`class_name` / `queue_name` / `finished_at` を持つ）。テーブルはアプリと同じ接続（`primary`）で読める。Task 3 の疎通確認がこれを使う。

- [ ] **Step 1: 失敗するテストを書く**

`backend/spec/jobs/solid_queue_spec.rb` を新規作成する。

```ruby
require "rails_helper"

# Solid Queue のテーブルをアプリと同じデータベースに同居させている
# （docs/superpowers/specs/2026-07-31-issue-4-1-solid-queue-design.md）。
# 同居しているからこそ、この spec は transactional fixtures のロールバックに乗る。
# 別 DB へ移す・マイグレーションを取りこぼす、といった形で前提が崩れたらここで落ちる。
RSpec.describe "Solid Queue" do
  around do |example|
    original = ActiveJob::Base.queue_adapter
    ActiveJob::Base.queue_adapter = :solid_queue
    example.run
    ActiveJob::Base.queue_adapter = original
  end

  it "perform_later でジョブ行が作られる" do
    expect { PingJob.perform_later("hello") }.to change(SolidQueue::Job, :count).by(1)

    job = SolidQueue::Job.last
    expect(job.class_name).to eq("PingJob")
    expect(job.queue_name).to eq("default")
  end

  it "ジョブテーブルがアプリと同じ接続で読める" do
    expect(SolidQueue::Job.connection_db_config.name)
      .to eq(ApplicationRecord.connection_db_config.name)
  end
end
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
docker compose exec backend bundle exec rspec spec/jobs/solid_queue_spec.rb
```

期待：`NameError: uninitialized constant SolidQueue` で 2 件とも失敗する。

- [ ] **Step 3: gem を追加する**

`backend/Gemfile` の `gem "ransack"` のブロックの後、`group :development, :test do` の**前**に追加する。

```ruby
# 非同期処理。画像生成（4-2 以降）をジョブ化する。ジョブの保存先は Postgres で、
# Redis のような追加インフラが要らない。Render の無料プランではバックグラウンド
# ワーカーが別サービス扱いで有料になるため、本番は Puma プラグインとして Web
# プロセス内で動かす（config/puma.rb）。選定理由は docs/README.md 参照。
gem "solid_queue"
```

```bash
docker compose exec backend bundle install
```

- [ ] **Step 4: インストーラを走らせる**

```bash
docker compose exec backend bin/rails solid_queue:install
```

このジェネレータが行うことは以下の 2 つ（`lib/generators/solid_queue/install/install_generator.rb`）。

1. `config/queue.yml` / `config/recurring.yml` / `db/queue_schema.rb` / `bin/jobs` を作る
2. `config/environments/production.rb` の `# config.active_job.queue_adapter = :resque` の行を、
   `config.active_job.queue_adapter = :solid_queue` と
   `config.solid_queue.connects_to = { database: { writing: :queue } }` の 2 行に置き換える

`config/queue.yml` と `config/recurring.yml` は**生成物のまま変更しない**。特に
`recurring.yml` の `clear_solid_queue_finished_jobs`（完了ジョブを毎時掃除する）は
消さないこと。消すと `solid_queue_jobs` が溜まり続け、Neon のストレージ 0.5 GB を
アプリのデータと食い合う。

- [ ] **Step 5: `connects_to` の行を削除する**

`backend/config/environments/production.rb` から、ジェネレータが足した

```ruby
  config.solid_queue.connects_to = { database: { writing: :queue } }
```

の 1 行を**削除する**。これが単一データベース構成のスイッチで、消し忘れると
`queue` という接続先が見つからず本番が boot しない。

残る行は以下の形になる（前後のコメント行はジェネレータが残したまま）。

```ruby
  # Replace the default in-process and non-durable queuing backend for Active Job.
  config.active_job.queue_adapter = :solid_queue
```

- [ ] **Step 6: `db/queue_schema.rb` を通常のマイグレーションへ移す**

まずタイムスタンプ付きのファイル名を決める。

```bash
docker compose exec backend bin/rails generate migration CreateSolidQueueTables
```

生成された `backend/db/migrate/<timestamp>_create_solid_queue_tables.rb` を開き、中身を
以下で**丸ごと置き換える**。本体（`create_table` 〜 `add_foreign_key`）は
`backend/db/queue_schema.rb` の中身をそのまま使う。下記は 2026-07-31 時点の生成内容なので、
**手元の `db/queue_schema.rb` と差異があれば手元の生成物を優先すること**。

```ruby
# Solid Queue のテーブル。Rails 8 の既定は `queue` という別データベースだが、Kotoe では
# アプリと同じデータベースに同居させる。Neon では別 DB にしても同じコンピュート
# エンドポイントを共有するため分離の利益が出ないため。
# 判断の根拠は docs/superpowers/specs/2026-07-31-issue-4-1-solid-queue-design.md 参照。
#
# 中身は `bin/rails solid_queue:install` が生成する db/queue_schema.rb をそのまま移したもの。
# `force: :cascade` も含めて原文どおりにしてある（転記ミスを避けるため）。これらのテーブルは
# Solid Queue の専有で、アプリのテーブルから参照されることはない。
class CreateSolidQueueTables < ActiveRecord::Migration[8.1]
  def change
    create_table "solid_queue_blocked_executions", force: :cascade do |t|
      t.bigint "job_id", null: false
      t.string "queue_name", null: false
      t.integer "priority", default: 0, null: false
      t.string "concurrency_key", null: false
      t.datetime "expires_at", null: false
      t.datetime "created_at", null: false
      t.index [ "concurrency_key", "priority", "job_id" ], name: "index_solid_queue_blocked_executions_for_release"
      t.index [ "expires_at", "concurrency_key" ], name: "index_solid_queue_blocked_executions_for_maintenance"
      t.index [ "job_id" ], name: "index_solid_queue_blocked_executions_on_job_id", unique: true
    end

    create_table "solid_queue_claimed_executions", force: :cascade do |t|
      t.bigint "job_id", null: false
      t.bigint "process_id"
      t.datetime "created_at", null: false
      t.index [ "job_id" ], name: "index_solid_queue_claimed_executions_on_job_id", unique: true
      t.index [ "process_id", "job_id" ], name: "index_solid_queue_claimed_executions_on_process_id_and_job_id"
    end

    create_table "solid_queue_failed_executions", force: :cascade do |t|
      t.bigint "job_id", null: false
      t.text "error"
      t.datetime "created_at", null: false
      t.index [ "job_id" ], name: "index_solid_queue_failed_executions_on_job_id", unique: true
    end

    create_table "solid_queue_jobs", force: :cascade do |t|
      t.string "queue_name", null: false
      t.string "class_name", null: false
      t.text "arguments"
      t.integer "priority", default: 0, null: false
      t.string "active_job_id"
      t.datetime "scheduled_at"
      t.datetime "finished_at"
      t.string "concurrency_key"
      t.datetime "created_at", null: false
      t.datetime "updated_at", null: false
      t.index [ "active_job_id" ], name: "index_solid_queue_jobs_on_active_job_id"
      t.index [ "class_name" ], name: "index_solid_queue_jobs_on_class_name"
      t.index [ "finished_at" ], name: "index_solid_queue_jobs_on_finished_at"
      t.index [ "queue_name", "finished_at" ], name: "index_solid_queue_jobs_for_filtering"
      t.index [ "scheduled_at", "finished_at" ], name: "index_solid_queue_jobs_for_alerting"
    end

    create_table "solid_queue_pauses", force: :cascade do |t|
      t.string "queue_name", null: false
      t.datetime "created_at", null: false
      t.index [ "queue_name" ], name: "index_solid_queue_pauses_on_queue_name", unique: true
    end

    create_table "solid_queue_processes", force: :cascade do |t|
      t.string "kind", null: false
      t.datetime "last_heartbeat_at", null: false
      t.bigint "supervisor_id"
      t.integer "pid", null: false
      t.string "hostname"
      t.text "metadata"
      t.datetime "created_at", null: false
      t.string "name", null: false
      t.index [ "last_heartbeat_at" ], name: "index_solid_queue_processes_on_last_heartbeat_at"
      t.index [ "name", "supervisor_id" ], name: "index_solid_queue_processes_on_name_and_supervisor_id", unique: true
      t.index [ "supervisor_id" ], name: "index_solid_queue_processes_on_supervisor_id"
    end

    create_table "solid_queue_ready_executions", force: :cascade do |t|
      t.bigint "job_id", null: false
      t.string "queue_name", null: false
      t.integer "priority", default: 0, null: false
      t.datetime "created_at", null: false
      t.index [ "job_id" ], name: "index_solid_queue_ready_executions_on_job_id", unique: true
      t.index [ "priority", "job_id" ], name: "index_solid_queue_poll_all"
      t.index [ "queue_name", "priority", "job_id" ], name: "index_solid_queue_poll_by_queue"
    end

    create_table "solid_queue_recurring_executions", force: :cascade do |t|
      t.bigint "job_id", null: false
      t.string "task_key", null: false
      t.datetime "run_at", null: false
      t.datetime "created_at", null: false
      t.index [ "job_id" ], name: "index_solid_queue_recurring_executions_on_job_id", unique: true
      t.index [ "task_key", "run_at" ], name: "index_solid_queue_recurring_executions_on_task_key_and_run_at", unique: true
    end

    create_table "solid_queue_recurring_tasks", force: :cascade do |t|
      t.string "key", null: false
      t.string "schedule", null: false
      t.string "command", limit: 2048
      t.string "class_name"
      t.text "arguments"
      t.string "queue_name"
      t.integer "priority", default: 0
      t.boolean "static", default: true, null: false
      t.text "description"
      t.datetime "created_at", null: false
      t.datetime "updated_at", null: false
      t.index [ "key" ], name: "index_solid_queue_recurring_tasks_on_key", unique: true
      t.index [ "static" ], name: "index_solid_queue_recurring_tasks_on_static"
    end

    create_table "solid_queue_scheduled_executions", force: :cascade do |t|
      t.bigint "job_id", null: false
      t.string "queue_name", null: false
      t.integer "priority", default: 0, null: false
      t.datetime "scheduled_at", null: false
      t.datetime "created_at", null: false
      t.index [ "job_id" ], name: "index_solid_queue_scheduled_executions_on_job_id", unique: true
      t.index [ "scheduled_at", "priority", "job_id" ], name: "index_solid_queue_dispatch_all"
    end

    create_table "solid_queue_semaphores", force: :cascade do |t|
      t.string "key", null: false
      t.integer "value", default: 1, null: false
      t.datetime "expires_at", null: false
      t.datetime "created_at", null: false
      t.datetime "updated_at", null: false
      t.index [ "expires_at" ], name: "index_solid_queue_semaphores_on_expires_at"
      t.index [ "key", "value" ], name: "index_solid_queue_semaphores_on_key_and_value"
      t.index [ "key" ], name: "index_solid_queue_semaphores_on_key", unique: true
    end

    add_foreign_key "solid_queue_blocked_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
    add_foreign_key "solid_queue_claimed_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
    add_foreign_key "solid_queue_failed_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
    add_foreign_key "solid_queue_ready_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
    add_foreign_key "solid_queue_recurring_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
    add_foreign_key "solid_queue_scheduled_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  end
end
```

続けて生成物を削除する。

```bash
rm backend/db/queue_schema.rb
```

- [ ] **Step 7: マイグレーションを適用する**

```bash
docker compose exec backend bin/rails db:migrate
docker compose exec -e RAILS_ENV=test backend bin/rails db:prepare
```

期待：`db/schema.rb` の `version:` が新しいタイムスタンプになり、`solid_queue_*` の
12 テーブルが追加される。

- [ ] **Step 8: テストが通ることを確認する**

```bash
docker compose exec backend bundle exec rspec spec/jobs/solid_queue_spec.rb
```

期待：2 examples, 0 failures。

失敗する場合の切り分け：

- `uninitialized constant SolidQueue` → `docker compose restart backend` して gem を読み込み直す
- `PG::UndefinedTable` → Step 7 の `db:prepare` が test DB に効いていない
- `SolidQueue::Job.count` が増えない → `around` のアダプタ差し替えが効いていない。
  `spec/jobs/` は `infer_spec_type_from_file_location!` により `type: :job` になるが、
  rspec-rails の `JobExampleGroup` は `ActiveJob::TestHelper` を include しないので
  アダプタは上書きされないはず。`ActiveJob::Base.queue_adapter` を spec 内で
  `puts` して実際の値を確かめる
- `connection_db_config.name` が一致しない → Step 5 の `connects_to` の削除漏れ

- [ ] **Step 9: rubocop と全 spec を通す**

```bash
docker compose exec backend bundle exec rubocop
docker compose exec backend bundle exec rspec
```

期待：どちらも green。`db/migrate/**/*` と `bin/**/*` は rubocop の対象外なので、
移したマイグレーションと `bin/jobs` は指摘されない。

- [ ] **Step 10: コミット**

`-A` は `db/queue_schema.rb` の**削除**をステージするために要る（`git add <path>` だけだと
新規・変更しか拾わない環境がある）。

```bash
git add -A backend/db
git add backend/Gemfile backend/Gemfile.lock backend/config/queue.yml backend/config/recurring.yml \
        backend/bin/jobs backend/config/environments/production.rb \
        backend/spec/jobs/solid_queue_spec.rb
git status --short   # backend/db/queue_schema.rb が D で載っていることを確認
git commit -F - <<'EOF'
feat: Solid Queue を導入する（アプリと同じDBに同居）

Rails 8 の既定は queue という別データベースだが、Neon では別 DB にしても
同じコンピュートエンドポイントを共有するため分離の利益が出ない。
db/queue_schema.rb を通常のマイグレーションへ移し、connects_to を外した。

config/queue.yml と config/recurring.yml は生成物のまま使う。recurring.yml の
完了ジョブ掃除は消さない（消すと solid_queue_jobs が溜まり続ける）。

同居構成が崩れたら落ちるよう、spec/jobs/solid_queue_spec.rb で
「ジョブ行が作られること」と「アプリと同じ接続で読めること」を検証する。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: ローカルのワーカーサービスと疎通確認

ここで初めて「enqueue したジョブをワーカーが処理する」流れが通る。

**Files:**
- Modify: `docker-compose.yml`（`frontend` サービスの後、`volumes:` の前）
- Modify: `backend/config/environments/development.rb`（`config.active_job.verbose_enqueue_logs = true` の直後）

**Interfaces:**
- Consumes: `PingJob`（Task 1）、`SolidQueue::Job`（Task 2）、`backend/bin/jobs`（Task 2）
- Produces: `docker compose logs worker` に `[PingJob] <message>` が出る状態

- [ ] **Step 1: 開発環境の ActiveJob アダプタを Solid Queue にする**

`backend/config/environments/development.rb` の `config.active_job.verbose_enqueue_logs = true`
の行の**直後**に、空行を挟んで以下を追加する。

```ruby
  # ジョブは Solid Queue（保存先は Postgres）で処理する。ワーカーは docker-compose の
  # worker サービス（bin/jobs）が担当する。本番は Puma プラグインで Web プロセス内に
  # 同居させる（config/puma.rb）ため、起動方法だけが本番と異なる。
  config.active_job.queue_adapter = :solid_queue
```

- [ ] **Step 2: `worker` サービスを追加する**

`docker-compose.yml` の `frontend` サービスの定義の後、末尾の `volumes:` の**前**に追加する。

```yaml
  # ジョブワーカー（Solid Queue）。本番（Render 無料枠）は Puma プラグインで Web プロセス内に
  # 同居させるが、ローカルは別サービスに分ける。ジョブのログがリクエストログと混ざらず、
  # ジョブを書き換えたときに Rails サーバーを落とさず再起動できるため。
  #
  # Solid Queue は開発環境でもジョブのコードを自動リロードしない。app/jobs 配下を編集したら
  # `docker compose restart worker` すること。
  worker:
    build:
      context: ./backend
      dockerfile: Dockerfile.dev
    env_file:
      # backend と同じ 2 本。ワーカーは DB へ接続し、4-2 以降は Cloudinary と
      # 画像生成 API のキーも使うため、backend と同じ秘密の到達範囲が要る。
      - .env.development
      - backend/.env.development
    environment:
      RAILS_ENV: development
      # backend と揃える。ずれると 4-2 の生成回数の日次上限の日付境界がずれる。
      TZ: Asia/Tokyo
    volumes:
      - ./backend:/app
      - bundle:/usr/local/bundle
    depends_on:
      db:
        condition: service_healthy
    # HTTP を受けないのでポートは公開しない。
    command: bundle exec bin/jobs
```

- [ ] **Step 3: ワーカーを起動する**

```bash
docker compose up -d --build worker
docker compose logs worker
```

期待：`SolidQueue-<version> Started supervisor` のような起動ログが出て、
プロセスが落ちずに残る。`docker compose ps` で `worker` が `Up` であること。

落ちる場合の切り分け：`PG::ConnectionBad` なら `env_file` の指定漏れ、
`uninitialized constant SolidQueue` なら `bundle` ボリュームが古い
（`docker compose exec worker bundle install`）。

- [ ] **Step 4: ジョブを enqueue して処理されることを確認する**

```bash
docker compose restart backend   # development.rb の変更を反映
docker compose exec backend bin/rails runner 'PingJob.perform_later("hello")'
docker compose logs --tail 20 worker
```

期待：`worker` のログに `[PingJob] hello` と、`Performed PingJob ... in Xms` が出る。
polling_interval が 1 秒なので、最大 1 秒ほど待つ。

- [ ] **Step 5: ジョブ行が完了状態になることを確認する**

```bash
docker compose exec backend bin/rails runner \
  'j = SolidQueue::Job.last; puts "#{j.class_name} finished_at=#{j.finished_at.inspect}"'
```

期待：`PingJob finished_at=<時刻>`（`nil` ではない）。

- [ ] **Step 6: rubocop と全 spec を通す**

```bash
docker compose exec backend bundle exec rubocop
docker compose exec backend bundle exec rspec
```

期待：どちらも green。

- [ ] **Step 7: コミット**

```bash
git add docker-compose.yml backend/config/environments/development.rb
git commit -F - <<'EOF'
feat: ローカルにジョブワーカーのサービスを追加する

開発環境の ActiveJob アダプタを Solid Queue にし、docker-compose に bin/jobs を
走らせる worker サービスを足した。

本番は Puma プラグインで Web プロセスに同居させるが、ローカルは分ける。
4-2/4-3 で GenerateImageJob を繰り返し書き換えることになり、Solid Queue は
開発環境でもジョブのコードを自動リロードしないため、Rails サーバーを落とさず
worker だけ再起動できる形にしておく。

疎通確認: PingJob.perform_later("hello") → worker のログに [PingJob] hello。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: 本番設定（Puma プラグイン）とドキュメント更新

**Files:**
- Modify: `backend/config/puma.rb`（末尾）
- Modify: `render.yaml`（`envVars` の末尾）
- Modify: `docs/deployment.md`（環境変数の表、運用上の注意）
- Modify: `docs/README.md`（Solid Queue の懸念メモ）
- Modify: `docs/issues_backlog.md`（4-1 のチェック、4-2 への委譲）

**Interfaces:**
- Consumes: `backend/config/queue.yml`（Task 2）
- Produces: 本番で `SOLID_QUEUE_IN_PUMA=true` のとき Puma が supervisor を fork する状態

- [ ] **Step 1: Puma プラグインを有効にする**

`backend/config/puma.rb` の**末尾**に追加する。

```ruby
# ジョブワーカーを Puma プロセス内で動かす（本番のみ）。Render の無料プランでは
# バックグラウンドワーカーが別サービス扱いで有料（$7/月〜）になるため、Web サービス
# 1 つに同居させる。
#
# 副次的な効果として、無料 Web が 15 分アイドルで停止すると fork した supervisor も
# 一緒に死に、ポーリングが止まって Neon がサスペンドする。常駐ワーカーにすると
# この連鎖が切れ、Neon の無料枠（100 CU-hours/月）も維持できなくなる。
#
# ローカルは docker-compose の worker サービスが担当するため有効にしない。
plugin :solid_queue if ENV["SOLID_QUEUE_IN_PUMA"]
```

- [ ] **Step 2: Render の環境変数を追加する**

`render.yaml` の `envVars` の**末尾**（`CLOUDINARY_URL` の行の後）に追加する。

```yaml
      - { key: SOLID_QUEUE_IN_PUMA, value: "true" }
```

- [ ] **Step 3: `docs/deployment.md` を更新する**

Render の環境変数の表（`CLOUDINARY_URL` の行の後）に 1 行足す。

```markdown
| `SOLID_QUEUE_IN_PUMA` | `render.yaml` | `true`。Solid Queue のワーカーを Puma プロセス内で起動する。未設定だとジョブが enqueue されるだけで処理されない |
```

「運用上の注意」の最後に以下を足す。

```markdown
- **ジョブワーカーは Web プロセスに同居する**：Render の無料プランではバックグラウンド
  ワーカーが別サービス扱いで有料になるため、`plugin :solid_queue` で Puma から fork する
  （`SOLID_QUEUE_IN_PUMA=true`）。free のスリープでワーカーごと止まるが、これは Neon の
  オートサスペンドを促す面もあり、無料枠を維持する前提になっている。メモリは 512 MB を
  Puma・supervisor・dispatcher・worker で分け合うため、4-2 で画像生成が乗ってから実測する。
  収まらない場合は `plugin :solid_queue` を外し、`render.yaml` に `type: worker` の
  サービス（$7/月〜）を足して切り出す（アプリのコードは変わらない）。
- **ジョブテーブルはアプリと同じ DB にある**：マイグレーションは通常どおり
  `bin/render-build.sh` の `db:migrate` で適用される。追加の DB や環境変数は要らない。
```

- [ ] **Step 4: `docs/README.md` の懸念メモを実数値で更新する**

`### 非同期処理の選定：Solid Queue（決定済み）` の節の末尾にある `> ⚠️ 懸念：` で始まる
引用ブロック（1 段落）を、以下で置き換える。

```markdown
> ⚠️ 懸念と実測（issue 4-1 で調査）：Solid Queue はポーリング型（worker は 1 秒間隔）なので、
> ワーカーが生きている間 Neon にクエリを投げ続け、Neon のオートサスペンドを妨げる。
> Neon の無料枠は 100 CU-hours/月で、最小 0.25 CU で連続稼働すると 1 か月 730 時間 ＝
> 182.5 CU-hours となり、**月の 55% 地点で枠を使い切る**。
> これが成立しているのは、Render の無料 Web が 15 分アイドルでコンテナごと停止し、
> fork された supervisor も一緒に死んでポーリングが止まるため。
> **つまり「ワーカーだけ有料の Background Worker（$7/月〜）に分離する」判断は、この連鎖を
> 切って Neon の課金も誘発する**（Launch プランで $0.106/CU-hour ＝ 約 $19/月）。
> 実運用での消費は 8-2b 以降に実測する。
```

- [ ] **Step 5: `docs/issues_backlog.md` の 4-1 を更新する**

`### 🟢 4-1. 非同期処理の基盤` のタスクと完了条件を以下で置き換える。

```markdown
- タスク：
  - [x] Solid Queue を導入・起動（選定理由は `docs/README.md`。0-1 では `--skip-solid` で外してある）
        → ジョブテーブルは**アプリと同じ DB に同居**させる。本番は Puma プラグイン、
        ローカルは docker-compose の `worker` サービス。判断の根拠は
        `docs/superpowers/specs/2026-07-31-issue-4-1-solid-queue-design.md`
  - [x] 動作確認用のダミージョブ（`PingJob`）
- 完了条件：ジョブをenqueueしてワーカーが処理する流れがローカルで動く。
- 補足：**本番でのワーカー稼働確認は 4-2 に委譲する**。Render の無料インスタンスはシェルが
  使えず（SSH もダッシュボードのシェルも有料インスタンス限定）、4-1 の時点では本番で
  ジョブを enqueue する手段がないため。
```

続けて 4-2 のタスクリストの末尾に 2 行足す。

```markdown
  - [ ] **本番でのワーカー稼働確認（4-1 から委譲）**：`generate` を叩いて status が
        `generating` → `published` に変わることを本番URLで確認する
  - [ ] **Render 無料枠のメモリ実測（4-1 から委譲）**：512 MB に Puma＋supervisor＋
        dispatcher＋worker が収まるか。収まらなければ有料ワーカーへの切り出しを検討
```

- [ ] **Step 6: rubocop と全 spec を通す**

```bash
docker compose exec backend bundle exec rubocop
docker compose exec backend bundle exec rspec
```

期待：どちらも green。`bin/**/*` は rubocop の対象外だが `config/puma.rb` は対象なので、
Step 1 の追記が指摘されないことを確認する。

- [ ] **Step 7: Puma プラグインがローカルで壊れていないことを確認する**

`SOLID_QUEUE_IN_PUMA` を付けずに backend が今までどおり起動することを確認する
（本番の経路そのものはローカルでは踏まない。設計ドキュメントの「なぜローカルだけ
別サービスにするか」参照）。

```bash
docker compose restart backend
docker compose logs --tail 20 backend
curl -s http://localhost:3000/up
```

期待：Puma が起動し、`/up` が 200 を返す。

- [ ] **Step 8: コミット**

```bash
git add backend/config/puma.rb render.yaml docs/deployment.md docs/README.md docs/issues_backlog.md
git commit -F - <<'EOF'
feat: 本番のジョブワーカーを Puma プロセス内で起動する

Render の無料プランではバックグラウンドワーカーが別サービス扱いで有料になる
ため、plugin :solid_queue で Web サービス 1 つに同居させる
（SOLID_QUEUE_IN_PUMA=true）。

あわせてドキュメントを更新した。README の Neon サスペンド懸念には実数値を
入れ、常駐ワーカーへの分離が Neon の課金も誘発することを明記した。

本番でのワーカー稼働確認とメモリ実測は 4-2 へ委譲する。Render の無料
インスタンスはシェルが使えず、4-1 の時点では本番でジョブを enqueue する
手段がないため。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## 最終確認

- [ ] `docker compose exec backend bundle exec rubocop` が green
- [ ] `docker compose exec backend bundle exec rspec` が green
- [ ] `docker compose exec backend bin/rails runner 'PingJob.perform_later("final check")'` が
      `docker compose logs worker` に `[PingJob] final check` として現れる
- [ ] `git log --oneline` に 4 つのコミット（Task 1〜4）が並んでいる
- [ ] `backend/db/queue_schema.rb` が存在しない
- [ ] `backend/config/environments/production.rb` に `connects_to` が無い
- [ ] `backend/config/recurring.yml` の `clear_solid_queue_finished_jobs` が残っている

## PR

- ベース：`main`、ヘッド：`feature/issue-4-1`
- タイトル：`feat: 非同期処理の基盤（issue 4-1）`
- 本文に含めること：同居構成を選んだ理由、本番確認を 4-2 へ委譲する理由、
  ローカルと本番でワーカーの起動方法が異なること、`docker compose up` に
  `worker` が増えるので**レビュー後に各自 `docker compose up -d --build` が必要**なこと
