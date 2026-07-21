# request spec で「ログイン済みの状態」を作るヘルパ。
# rails_helper が spec/support 配下を自動で読み込む。
module AuthHelpers
  # サインインして Authorization ヘッダの中身（"Bearer xxx"）をそのまま返す。
  # password の既定値は spec/factories/users.rb の値に合わせている。
  def sign_in_and_get_token(user, password: "password123")
    post "/api/auth/sign_in",
      params: { user: { email: user.email, password: password } },
      as: :json

    response.headers["Authorization"]
  end

  # 認証つきリクエストに渡すヘッダ。
  def auth_headers(token)
    { "Authorization" => token }
  end
end

RSpec.configure do |config|
  config.include AuthHelpers, type: :request
end
