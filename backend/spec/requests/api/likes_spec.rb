require "rails_helper"

RSpec.describe "再現いいね API", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }
  # いいねできるのは他人の公開済みの挑戦。
  let(:attempt) { create(:attempt, :published) }

  describe "POST /api/attempts/:attempt_id/like" do
    it "いいねすると 200 と更新後の挑戦を返す" do
      expect {
        post "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json
      }.to change(Like, :count).by(1)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]).to include(
        "id" => attempt.id,
        "likes_count" => 1,
        "liked" => true
      )
    end

    it "二重にいいねしても増えず、200 を返す" do
      create(:like, user: user, attempt: attempt)

      expect {
        post "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json
      }.not_to change(Like, :count)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]).to include("likes_count" => 1, "liked" => true)
    end

    it "自分の挑戦には 422 と cannot_like_own_attempt を返す" do
      own = create(:attempt, :published, user: user)

      expect {
        post "/api/attempts/#{own.id}/like", headers: auth_headers(token), as: :json
      }.not_to change(Like, :count)

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("error" => "cannot_like_own_attempt")
    end

    it "下書きには 404" do
      draft = create(:attempt)

      post "/api/attempts/#{draft.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body).to eq("error" => "not_found")
    end

    it "生成中には 404" do
      generating = create(:attempt, :generating)

      post "/api/attempts/#{generating.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "失敗した挑戦には 404" do
      failed = create(:attempt, :failed)

      post "/api/attempts/#{failed.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "削除済みの挑戦には 404" do
      attempt.discard!

      post "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "存在しない ID は 404" do
      post "/api/attempts/0/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "未認証は 401" do
      post "/api/attempts/#{attempt.id}/like", as: :json

      expect(response).to have_http_status(:unauthorized)
    end

    # 並行リクエストの再現は request spec では作れないため、ここだけ例外をスタブして
    # rescue 節が生きていることを確かめる。DB 制約とアプリ側の uniqueness バリデーションの
    # どちらが先に当たるかは競合相手がコミット済みかどうかで変わるので、両方を見る。
    it "DB 制約の競合（RecordNotUnique）でも 200 を返す" do
      allow_any_instance_of(ActiveRecord::Associations::CollectionProxy)
        .to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordNotUnique)

      post "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:ok)
    end

    it "バリデーションの競合（RecordInvalid）でも 200 を返す" do
      allow_any_instance_of(ActiveRecord::Associations::CollectionProxy)
        .to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordInvalid.new(Like.new))

      post "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:ok)
    end
  end
end
