Rails.application.routes.draw do
  # 公開するのはこの3本だけ。devise_for の既定は退会（DELETE）・パスワード変更（PATCH）・
  # HTML フォーム用の new/edit/cancel まで生やしてしまう。退会は将来 discard で
  # 実装する（物理削除しない）ため、ここでは経路ごと塞ぐ。
  devise_for :users, skip: :all

  devise_scope :user do
    post   "api/auth/sign_up"  => "api/auth/registrations#create"
    post   "api/auth/sign_in"  => "api/auth/sessions#create"
    delete "api/auth/sign_out" => "api/auth/sessions#destroy"
  end

  namespace :api do
    # 疎通確認用（DB 接続も確認する）
    get "health" => "health#show"

    # ログイン中のユーザー自身の情報。
    # マイページの一覧API（/api/me/posts 等）は issue 6-3 で追加する。
    get "me" => "me#show"
  end

  # Rails 標準のヘルスチェック。アプリが例外なく起動できたかだけを見る（DB は見ない）。
  # ロードバランサ / 死活監視（Render のヘルスチェック）向け。
  get "up" => "rails/health#show", as: :rails_health_check
end
