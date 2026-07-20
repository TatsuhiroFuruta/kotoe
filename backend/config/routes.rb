Rails.application.routes.draw do
  # 認証。パスは docs/screen_and_api_design.md に合わせて /api/auth/* にする。
  # path_names の registration がリソース部分（既定は "users"）を "sign_up" に置き換える。
  devise_for :users,
    path: "api/auth",
    path_names: { sign_in: "sign_in", sign_out: "sign_out", registration: "sign_up" },
    controllers: {
      sessions: "api/auth/sessions",
      registrations: "api/auth/registrations"
    }

  namespace :api do
    # 疎通確認用（DB 接続も確認する）
    get "health" => "health#show"
  end

  # Rails 標準のヘルスチェック。アプリが例外なく起動できたかだけを見る（DB は見ない）。
  # ロードバランサ / 死活監視（Render のヘルスチェック）向け。
  get "up" => "rails/health#show", as: :rails_health_check
end
