require "rails_helper"

RSpec.describe "挑戦 API", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }
  let(:post_record) { create(:post) }

  describe "POST /api/posts/:post_id/attempts" do
    it "下書きを作れる" do
      post "/api/posts/#{post_record.id}/attempts",
        params: { attempt: { description: "夕暮れの交差点。信号は赤。" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:created)
      expect(response.parsed_body["attempt"]).to include(
        "description" => "夕暮れの交差点。信号は赤。",
        "status" => "draft",
        "generated_image_public_id" => nil,
        "similarity_score" => nil,
        "likes_count" => 0,
        "user" => { "id" => user.id, "name" => user.name }
      )
      expect(Attempt.last.post_id).to eq(post_record.id)
    end

    it "未認証は 401" do
      post "/api/posts/#{post_record.id}/attempts",
        params: { attempt: { description: "あ" } }, as: :json

      expect(response).to have_http_status(:unauthorized)
    end

    it "削除済みのお題には作れない" do
      post_record.discard!

      post "/api/posts/#{post_record.id}/attempts",
        params: { attempt: { description: "あ" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body).to eq("error" => "not_found")
    end

    it "存在しないお題は 404" do
      post "/api/posts/0/attempts",
        params: { attempt: { description: "あ" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "描写が空なら 422 と blank" do
      post "/api/posts/#{post_record.id}/attempts",
        params: { attempt: { description: "" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("errors" => { "description" => [ "blank" ] })
    end

    it "描写が 1,000 文字を超えると 422 と too_long" do
      post "/api/posts/#{post_record.id}/attempts",
        params: { attempt: { description: "あ" * 1001 } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("errors" => { "description" => [ "too_long" ] })
    end

    # params[:attempt] の型はクライアントが決められる。スカラーを送られても
    # 500 にせず通常の 422 として扱う。
    it "attempt がスカラーでも 500 にならない" do
      post "/api/posts/#{post_record.id}/attempts",
        params: { attempt: "foo" },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    # 重複を禁じない（コストの守り手は回数制限であって重複禁止ではない）。
    # 禁じるならバリデーションが要るので、その判断をここで固定しておく。
    it "同じお題に何度でも挑戦できる" do
      create(:attempt, user: user, post: post_record)

      post "/api/posts/#{post_record.id}/attempts",
        params: { attempt: { description: "2 回目" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:created)
      expect(user.attempts.where(post: post_record).count).to eq(2)
    end

    # Kotoe は順位を競うラダーではなく、自分で動作を確かめられるほうが実用的。
    it "自分のお題にも挑戦できる" do
      own_post = create(:post, user: user)

      post "/api/posts/#{own_post.id}/attempts",
        params: { attempt: { description: "自分のお題" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:created)
    end
  end

  describe "PATCH /api/attempts/:id" do
    let(:attempt) { create(:attempt, user: user, post: post_record, description: "before") }

    it "自分の下書きを更新できる" do
      patch "/api/attempts/#{attempt.id}",
        params: { attempt: { description: "after" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]["description"]).to eq("after")
      expect(attempt.reload.description).to eq("after")
    end

    it "他人の下書きは 404" do
      others = create(:attempt)

      patch "/api/attempts/#{others.id}",
        params: { attempt: { description: "after" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "削除済みは 404" do
      attempt.discard!

      patch "/api/attempts/#{attempt.id}",
        params: { attempt: { description: "after" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    # 生成後に描写だけ書き換えられると、公開されている画像と説明が食い違う。
    it "draft でなければ 422 と attempt_not_draft" do
      published = create(:attempt, :published, user: user)

      patch "/api/attempts/#{published.id}",
        params: { attempt: { description: "after" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("error" => "attempt_not_draft")
      expect(published.reload.description).not_to eq("after")
    end

    it "空にすると 422 と blank" do
      patch "/api/attempts/#{attempt.id}",
        params: { attempt: { description: "" } },
        headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("errors" => { "description" => [ "blank" ] })
      expect(attempt.reload.description).to eq("before")
    end

    it "未認証は 401" do
      patch "/api/attempts/#{attempt.id}",
        params: { attempt: { description: "after" } }, as: :json

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
