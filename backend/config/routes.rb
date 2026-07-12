Rails.application.routes.draw do
  namespace :api do
    # 疎通確認用（DB 接続も確認する）
    get "health" => "health#show"
  end

  # Rails 標準のヘルスチェック。アプリが例外なく起動できたかだけを見る（DB は見ない）。
  # ロードバランサ / 死活監視（Render のヘルスチェック）向け。
  get "up" => "rails/health#show", as: :rails_health_check
end
