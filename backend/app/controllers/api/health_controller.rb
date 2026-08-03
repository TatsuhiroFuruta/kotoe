module Api
  class HealthController < ApplicationController
    # 疎通確認用。DB への接続まで含めて生きているかを返す。
    def show
      ActiveRecord::Base.connection.execute("SELECT 1")

      # Render の無料プランは Metrics が見られず、シェルも有料インスタンス限定なので、
      # 512 MB にどれだけ近いかを外から知る手段がここしか無い（issue 4-2 のメモリ実測）。
      # 測れない環境でも source: "unavailable" が返るため、キーは常に存在する。
      render json: { status: "ok", database: "ok", memory: Diagnostics::Memory.call }
    rescue ActiveRecord::ActiveRecordError => e
      Rails.logger.error("Health check failed: #{e.class}")

      render json: { status: "error", database: "error" }, status: :service_unavailable
    end
  end
end
