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
      "email" => "me@example.com",
      "stats" => { "posts_count" => 0, "attempts_count" => 0, "likes_received_count" => 0 }
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
    expect(response.parsed_body["error"]).to eq("unauthorized")
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

  # マイページのプロフィールヘッダー（7-6）が使う。投稿数と挑戦数は
  # 各タブの meta.total_count と一致する定義（設計書参照）。
  it "stats に投稿数・公開済み挑戦数・獲得いいね合計を返す" do
    create_list(:post, 2, user: user)
    create(:attempt, user: user)
    create_list(:like, 3, attempt: create(:attempt, :published, user: user))
    token = sign_in_and_get_token(user)

    get "/api/me", headers: auth_headers(token)

    expect(response.parsed_body["stats"]).to eq(
      "posts_count" => 2, "attempts_count" => 1, "likes_received_count" => 3
    )
  end

  # 拡張範囲を /api/me に閉じたことの固定。private_profile は sign_up / sign_in と
  # 共有しており、そちらで集計 3 本を走らせる理由が無い。
  it "sign_in の応答には stats を含めない" do
    post "/api/auth/sign_in",
      params: { user: { email: user.email, password: "password123" } },
      as: :json

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).not_to have_key("stats")
  end
end
