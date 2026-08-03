require "rails_helper"

RSpec.describe "Api::Health" do
  describe "GET /api/health" do
    it "DB に接続できるとき ok を返す" do
      allow(Diagnostics::Memory).to receive(:call).and_return(Diagnostics::Memory::UNAVAILABLE)

      get "/api/health"

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to include("status" => "ok", "database" => "ok")
    end

    # Render の無料プランは Metrics が見られないため、ここから読む（issue 4-2）。
    it "メモリ使用量を一緒に返す" do
      allow(Diagnostics::Memory).to receive(:call)
        .and_return({ used_mb: 300, limit_mb: 512, anon_mb: 200, file_mb: 100, processes: [] })

      get "/api/health"

      expect(response.parsed_body["memory"]).to include("used_mb" => 300, "limit_mb" => 512)
    end

    # 測れない環境でもキーは必ず出す。キーごと省くと「この機能が無い古いビルドが
    # 動いている」ときと応答が同じになり、外から見分けがつかない（issue 4-2 で実際に
    # 取り違えた）。
    it "メモリを測れない環境でも source: unavailable を返す" do
      allow(Diagnostics::Memory).to receive(:call).and_return(Diagnostics::Memory::UNAVAILABLE)

      get "/api/health"

      expect(response.parsed_body["memory"]).to eq("source" => "unavailable")
    end

    it "DB に接続できないとき 503 を返す" do
      allow(ActiveRecord::Base.connection).to receive(:execute)
        .and_raise(ActiveRecord::ConnectionNotEstablished)

      get "/api/health"

      expect(response).to have_http_status(:service_unavailable)
      expect(response.parsed_body).to eq("status" => "error", "database" => "error")
    end
  end
end
