# フロント（ローカルは localhost:3001、本番は Vercel）は Rails と別オリジンのため、
# ブラウザからの API 呼び出しには CORS の許可が要る。
#
# 許可するオリジンの判定は lib/cors/allowed_origins.rb に置いてある。
# rack-cors は起動時に一度しか設定を読まないが、origins にブロックを渡すと
# リクエストごとに評価されるため、判定をテスト可能な形に保てる。
#
# 許可オリジンの実値（本番ドメイン・Vercel のチーム slug）は環境変数で渡す。
# ワイルドカード（"*"）は使わない。
Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins { |source, _env| Cors::AllowedOrigins.current.allow?(source) }

    # expose がないと、別オリジンのフロントは JS から Authorization ヘッダを
    # 読み取れない（＝ 2-1 で発行した JWT を受け取れない）。
    #
    # cookie は共有せず JWT を Authorization ヘッダで運ぶ方針のため、
    # credentials: true は設定しない。
    resource "*",
      headers: :any,
      expose: [ "Authorization" ],
      methods: [ :get, :post, :put, :patch, :delete, :options, :head ]
  end
end

# 不正な正規表現を設定したまま本番へ出ると、全リクエストが CORS エラーになって
# 原因を追いにくい。起動時に一度評価して落とす。
#
# initializer の本体からは Cors::AllowedOrigins を参照できない。この時点では
# Zeitwerk の autoloader が未設定で uninitialized constant になるため、
# autoload が効く after_initialize で参照する。
Rails.application.config.after_initialize do
  Cors::AllowedOrigins.current
end
