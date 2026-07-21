require "rails_helper"

RSpec.describe "ログイン・ログアウト", type: :request do
  let!(:user) { create(:user, email: "user@example.com", password: "password123") }

  describe "POST /api/auth/sign_in" do
    it "正しい認証情報なら 200・ユーザー JSON・JWT を返す" do
      post "/api/auth/sign_in",
        params: { user: { email: "user@example.com", password: "password123" } },
        as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq(
        "id" => user.id,
        "name" => user.name,
        "email" => "user@example.com"
      )
      expect(response.headers["Authorization"]).to match(/\ABearer .+\z/)
    end

    it "パスワードが違うと 401 と invalid_credentials を返す" do
      post "/api/auth/sign_in",
        params: { user: { email: "user@example.com", password: "wrong-password" } },
        as: :json

      expect(response).to have_http_status(:unauthorized)
      expect(response.parsed_body["error"]).to eq("invalid_credentials")
      expect(response.headers["Authorization"]).to be_nil
    end

    it "存在しない email だと 401 を返す" do
      post "/api/auth/sign_in",
        params: { user: { email: "nobody@example.com", password: "password123" } },
        as: :json

      expect(response).to have_http_status(:unauthorized)
      expect(response.parsed_body["error"]).to eq("invalid_credentials")
    end
  end

  describe "DELETE /api/auth/sign_out" do
    it "JWT を失効リストに記録して 200 を返す" do
      post "/api/auth/sign_in",
        params: { user: { email: "user@example.com", password: "password123" } },
        as: :json
      token = response.headers["Authorization"]

      expect {
        delete "/api/auth/sign_out", headers: { "Authorization" => token }
      }.to change(JwtDenylist, :count).by(1)

      expect(response).to have_http_status(:ok)
    end

    it "トークンが無いと 401 と unauthorized を返す" do
      delete "/api/auth/sign_out"

      expect(response).to have_http_status(:unauthorized)
      expect(response.parsed_body["error"]).to eq("unauthorized")
    end
  end
end
