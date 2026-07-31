# This configuration file will be evaluated by Puma. The top-level methods that
# are invoked here are part of Puma's configuration DSL. For more information
# about methods provided by the DSL, see https://puma.io/puma/Puma/DSL.html.
#
# Puma starts a configurable number of processes (workers) and each process
# serves each request in a thread from an internal thread pool.
#
# You can control the number of workers using ENV["WEB_CONCURRENCY"]. You
# should only set this value when you want to run 2 or more workers. The
# default is already 1. You can set it to `auto` to automatically start a worker
# for each available processor.
#
# The ideal number of threads per worker depends both on how much time the
# application spends waiting for IO operations and on how much you wish to
# prioritize throughput over latency.
#
# As a rule of thumb, increasing the number of threads will increase how much
# traffic a given process can handle (throughput), but due to CRuby's
# Global VM Lock (GVL) it has diminishing returns and will degrade the
# response time (latency) of the application.
#
# The default is set to 3 threads as it's deemed a decent compromise between
# throughput and latency for the average Rails application.
#
# Any libraries that use a connection pool or another resource pool should
# be configured to provide at least as many connections as the number of
# threads. This includes Active Record's `pool` parameter in `database.yml`.
threads_count = ENV.fetch("RAILS_MAX_THREADS", 3)
threads threads_count, threads_count

# Specifies the `port` that Puma will listen on to receive requests; default is 3000.
port ENV.fetch("PORT", 3000)

# Allow puma to be restarted by `bin/rails restart` command.
plugin :tmp_restart

# Specify the PID file. Defaults to tmp/pids/server.pid in development.
# In other environments, only set the PID file if requested.
pidfile ENV["PIDFILE"] if ENV["PIDFILE"]

# ジョブワーカーを Puma プロセス内で動かす（本番のみ）。Render の無料プランでは
# バックグラウンドワーカーが別サービス扱いで有料（$7/月〜）になるため、Web サービス
# 1 つに同居させる。
#
# 副次的な効果として、無料 Web が 15 分アイドルで停止すると fork した supervisor も
# 一緒に死に、ポーリングが止まって Neon がサスペンドする。常駐ワーカーにすると
# この連鎖が切れ、Neon の無料枠（100 CU-hours/月）も維持できなくなる。
#
# ローカルは docker-compose の worker サービスが担当するため有効にしない。
#
# `== "true"` で比較する。Ruby では "" も "false" も truthy なので、存在チェックだと
# SOLID_QUEUE_IN_PUMA=false で無効化しようとした時に有効なままになる。有料ワーカーへ
# 切り出す場面（deployment.md 参照）はまさにこの値を触るときなので、事故りにくくしておく。
plugin :solid_queue if ENV["SOLID_QUEUE_IN_PUMA"] == "true"
