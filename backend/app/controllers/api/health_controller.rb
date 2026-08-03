module Api
  class HealthController < ApplicationController
    # 疎通確認用。DB への接続まで含めて生きているかを返す。
    def show
      ActiveRecord::Base.connection.execute("SELECT 1")

      render json: { status: "ok", database: "ok" }.merge(memory_payload)
    rescue ActiveRecord::ActiveRecordError => e
      Rails.logger.error("Health check failed: #{e.class}")

      render json: { status: "error", database: "error" }, status: :service_unavailable
    end

    private

    # Render の無料プランは Metrics が見られず、シェルも有料インスタンス限定なので、
    # 512 MB にどれだけ近いかを外から知る手段がここしか無い（issue 4-2 のメモリ実測）。
    # cgroup を読めない環境ではキーごと省く。
    def memory_payload
      memory = Diagnostics::Memory.call

      memory ? { memory: memory } : {}
    end
  end
end
