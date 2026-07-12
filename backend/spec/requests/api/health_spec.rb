require "rails_helper"

RSpec.describe "Api::Health" do
  describe "GET /api/health" do
    it "DB に接続できるとき ok を返す" do
      get "/api/health"

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq("status" => "ok", "database" => "ok")
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
