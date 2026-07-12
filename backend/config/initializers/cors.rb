# フロント（ローカルは localhost:3001、本番は Vercel）は Rails と別オリジンのため、
# ブラウザからの API 呼び出しには CORS の許可が要る。
#
# 許可オリジンは環境変数 CORS_ALLOWED_ORIGINS（カンマ区切り）で渡す。
# ワイルドカード（"*"）は使わない。認証情報つきのリクエストを受けるため。
#
# 本番オリジンの設定と、JWT を運ぶ Authorization ヘッダの露出は issue 2-2 で詰める。
allowed_origins = ENV.fetch("CORS_ALLOWED_ORIGINS", "").split(",").map(&:strip).reject(&:empty?)

Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins allowed_origins

    resource "*",
      headers: :any,
      methods: [ :get, :post, :put, :patch, :delete, :options, :head ]
  end
end
