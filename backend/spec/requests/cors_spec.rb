require "rails_helper"

RSpec.describe "CORS", type: :request do
  let(:allowed_origin) { "https://kotoe.example.com" }
  let(:preview_origin) { "https://kotoe-git-feature-x-kotoe-team.vercel.app" }

  # 判定を PORO に切り出したので、ミドルウェアの起動時設定に触れずに
  # example ごとの設定を再現できる。
  before do
    allow(Cors::AllowedOrigins).to receive(:current).and_return(
      Cors::AllowedOrigins.new(
        origins: [ allowed_origin ],
        pattern: "https://kotoe-[a-z0-9-]+-kotoe-team\\.vercel\\.app"
      )
    )
  end

  describe "許可オリジン" do
    it "Access-Control-Allow-Origin を返す" do
      get "/api/health", headers: { "Origin" => allowed_origin }

      expect(response).to have_http_status(:ok)
      expect(response.headers["Access-Control-Allow-Origin"]).to eq(allowed_origin)
    end

    it "正規表現にマッチするプレビューURLも許可する" do
      get "/api/health", headers: { "Origin" => preview_origin }

      expect(response.headers["Access-Control-Allow-Origin"]).to eq(preview_origin)
    end
  end

  describe "不許可オリジン" do
    it "Access-Control-Allow-Origin を返さない" do
      get "/api/health", headers: { "Origin" => "https://evil.example.com" }

      expect(response.headers["Access-Control-Allow-Origin"]).to be_nil
    end

    it "チーム slug が違う Vercel プロジェクトを拒否する" do
      get "/api/health", headers: { "Origin" => "https://kotoe-evil.vercel.app" }

      expect(response.headers["Access-Control-Allow-Origin"]).to be_nil
    end
  end

  describe "preflight (OPTIONS)" do
    it "許可オリジンからの preflight に許可メソッドとヘッダを返す" do
      process :options, "/api/auth/sign_in", headers: {
        "Origin" => allowed_origin,
        "Access-Control-Request-Method" => "POST",
        "Access-Control-Request-Headers" => "Content-Type"
      }

      # rack-cors の preflight は 204 ではなく 200 を返す（実機で確認済み）。
      expect(response).to have_http_status(:ok)
      expect(response.headers["Access-Control-Allow-Origin"]).to eq(allowed_origin)
      expect(response.headers["Access-Control-Allow-Methods"]).to include("POST")
    end

    it "不許可オリジンからの preflight を許可しない" do
      process :options, "/api/auth/sign_in", headers: {
        "Origin" => "https://evil.example.com",
        "Access-Control-Request-Method" => "POST"
      }

      # 不許可でもステータスは 200 が返る。ブラウザは Access-Control-Allow-Origin が
      # 無いことで拒否するため、検証すべきはヘッダの不在。
      expect(response.headers["Access-Control-Allow-Origin"]).to be_nil
    end
  end

  # この issue の完了条件そのもの。
  # expose を設定しないと、別オリジンのフロントは JS から
  # Authorization ヘッダ（JWT）を読み取れない。
  describe "JWT の受け渡し" do
    let!(:user) { create(:user, email: "user@example.com", password: "password123") }

    it "許可オリジンからのログインで JWT を読み取れる" do
      post "/api/auth/sign_in",
        params: { user: { email: "user@example.com", password: "password123" } },
        headers: { "Origin" => allowed_origin },
        as: :json

      expect(response).to have_http_status(:ok)
      expect(response.headers["Access-Control-Allow-Origin"]).to eq(allowed_origin)
      expect(response.headers["Access-Control-Expose-Headers"]).to include("Authorization")
      expect(response.headers["Authorization"]).to match(/\ABearer .+\z/)
    end
  end
end
