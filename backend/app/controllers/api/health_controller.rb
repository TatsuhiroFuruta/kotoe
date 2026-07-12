module Api
  class HealthController < ApplicationController
    # 疎通確認用。DB への接続まで含めて生きているかを返す。
    def show
      ActiveRecord::Base.connection.execute("SELECT 1")

      render json: { status: "ok", database: "ok" }
    rescue ActiveRecord::ActiveRecordError => e
      Rails.logger.error("Health check failed: #{e.class}")

      render json: { status: "error", database: "error" }, status: :service_unavailable
    end
  end
end
