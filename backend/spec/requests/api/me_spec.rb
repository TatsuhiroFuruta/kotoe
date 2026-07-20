require "rails_helper"

RSpec.describe "GET /api/me", type: :request do
  let!(:user) { create(:user, name: "テスト太郎", email: "me@example.com") }

  it "JWT を付けるとログイン中のユーザーを返す" do
    token = sign_in_and_get_token(user)

    get "/api/me", headers: auth_headers(token)

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to eq(
      "id" => user.id,
      "name" => "テスト太郎",
      "email" => "me@example.com"
    )
  end

  it "Authorization ヘッダが無いと 401 を返す" do
    get "/api/me"

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("unauthorized")
  end

  it "デタラメなトークンだと 401 を返す" do
    get "/api/me", headers: auth_headers("Bearer not-a-real-token")

    expect(response).to have_http_status(:unauthorized)
  end

  # この issue の完了条件そのもの。
  it "sign_out 後は同じトークンで 401 になる" do
    token = sign_in_and_get_token(user)
    get "/api/me", headers: auth_headers(token)
    expect(response).to have_http_status(:ok)

    delete "/api/auth/sign_out", headers: auth_headers(token)
    expect(response).to have_http_status(:ok)

    get "/api/me", headers: auth_headers(token)
    expect(response).to have_http_status(:unauthorized)
  end
end
