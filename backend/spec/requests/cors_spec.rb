require "rails_helper"

# CORS の許可オリジンは環境変数で渡すが、ミドルウェアは起動時に一度だけ設定を読む。
# そのため spec では ENV を差し替えず、テスト環境で実際に読み込まれた設定を検証する。
RSpec.describe "CORS" do
  let(:allowed_origin) { ENV.fetch("CORS_ALLOWED_ORIGINS", "").split(",").first }

  it "許可オリジンからのリクエストに Access-Control-Allow-Origin を返す" do
    skip "CORS_ALLOWED_ORIGINS が未設定" if allowed_origin.blank?

    get "/api/health", headers: { "Origin" => allowed_origin }

    expect(response.headers["Access-Control-Allow-Origin"]).to eq(allowed_origin)
  end

  it "許可していないオリジンには Access-Control-Allow-Origin を返さない" do
    get "/api/health", headers: { "Origin" => "http://evil.example.com" }

    expect(response.headers["Access-Control-Allow-Origin"]).to be_nil
  end
end
