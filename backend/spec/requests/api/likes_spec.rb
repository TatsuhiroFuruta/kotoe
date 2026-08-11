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

    # Post#discard は挑戦にカスケードしないので、挑戦だけを見ると kept かつ published の
    # ままになる。お題が消えた挑戦は読み取り API から辿れないのに、いいねだけ書き込めて
    # ランキング（6-1 / 6-2）に効いてしまうため、ここでも塞ぐ。
    it "お題が削除済みなら 404" do
      attempt.post.discard!

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
    #
    # any_instance_of が広いのは承知のうえ。request spec からは current_user.likes だけを
    # 名指しできない。このリクエストで find_or_create_by! を呼ぶのが 1 か所しかないことに
    # 依存しているので、コントローラに別の呼び出しを足すときはここを見直すこと。
    it "DB 制約の競合（RecordNotUnique）でも 200 を返す" do
      allow_any_instance_of(ActiveRecord::Associations::CollectionProxy)
        .to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordNotUnique)

      post "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:ok)
    end

    it "バリデーションの競合（RecordInvalid）でも 200 を返す" do
      duplicate = Like.new
      duplicate.errors.add(:user_id, :taken)
      allow_any_instance_of(ActiveRecord::Associations::CollectionProxy)
        .to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordInvalid.new(duplicate))

      post "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:ok)
    end

    # 「重複していた」以外の検証失敗まで成功にすると、将来 Like にバリデーションが
    # 増えたとき 200 と liked: false を返し、フロントが失敗に気づけなくなる。
    # 文言ではなくエラーコードを返すこと（i18n はフロント）もここで固定する。
    it "重複以外の検証失敗はエラーコードで返す" do
      other = Like.new
      other.errors.add(:base, :invalid)
      allow_any_instance_of(ActiveRecord::Associations::CollectionProxy)
        .to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordInvalid.new(other))

      post "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("errors" => { "base" => [ "invalid" ] })
    end

    # of_kind? は「重複が含まれていれば true」なので、重複と別の原因が同時に立つと
    # 別の原因ごと握り潰してしまう。重複「だけ」が原因のときに限る。
    it "重複と別の検証失敗が同時なら成功にしない" do
      both = Like.new
      both.errors.add(:user_id, :taken)
      both.errors.add(:base, :invalid)
      allow_any_instance_of(ActiveRecord::Associations::CollectionProxy)
        .to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordInvalid.new(both))

      post "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]).to include("base" => [ "invalid" ])
    end
  end

  describe "DELETE /api/attempts/:attempt_id/like" do
    it "いいねを解除すると 200 と更新後の挑戦を返す" do
      create(:like, user: user, attempt: attempt)

      expect {
        delete "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json
      }.to change(Like, :count).by(-1)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]).to include(
        "id" => attempt.id,
        "likes_count" => 0,
        "liked" => false
      )
    end

    it "いいねしていなくても 200 を返し、何も消えない" do
      expect {
        delete "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json
      }.not_to change(Like, :count)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]).to include("likes_count" => 0, "liked" => false)
    end

    it "他人のいいねは消えない" do
      create(:like, user: user, attempt: attempt)
      create(:like, attempt: attempt)

      delete "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json

      expect(response.parsed_body["attempt"]).to include("likes_count" => 1, "liked" => false)
      expect(Like.where(attempt: attempt).count).to eq(1)
    end

    # POST は所有者を 422 で弾くが、DELETE は弾かない。セルフいいねを禁じている以上
    # 「いいねしていない状態」で確定しており、冪等な DELETE の定義どおり現状を返せばよい。
    # POST と DELETE でチェックが非対称なのは意図した設計なので、対称化されないよう固定する。
    it "自分の挑戦でも 422 にせず 200 を返す" do
      own = create(:attempt, :published, user: user)

      delete "/api/attempts/#{own.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]).to include("likes_count" => 0, "liked" => false)
    end

    it "下書きには 404" do
      draft = create(:attempt)

      delete "/api/attempts/#{draft.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "生成中には 404" do
      generating = create(:attempt, :generating)

      delete "/api/attempts/#{generating.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "失敗した挑戦には 404" do
      failed = create(:attempt, :failed)

      delete "/api/attempts/#{failed.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "削除済みの挑戦には 404" do
      attempt.discard!

      delete "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "お題が削除済みなら 404" do
      attempt.post.discard!

      delete "/api/attempts/#{attempt.id}/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "存在しない ID は 404" do
      delete "/api/attempts/0/like", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "未認証は 401" do
      delete "/api/attempts/#{attempt.id}/like", as: :json

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
