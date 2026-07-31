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
