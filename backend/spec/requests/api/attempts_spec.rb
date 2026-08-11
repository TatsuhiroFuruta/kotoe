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
        "liked" => false,
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

    # Array も dig に応答するため、respond_to?(:dig) では素通りしてしまう。
    # 素通りすると ["foo"][:description] で TypeError になり 500 になる。
    it "attempt が配列でも 500 にならない" do
      post "/api/posts/#{post_record.id}/attempts",
        params: { attempt: [ "foo" ] },
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

  describe "POST /api/attempts/:id/generate" do
    let(:attempt) { create(:attempt, user: user, post: post_record) }

    it "生成を起動すると 202 と generating を返し、ジョブが積まれる" do
      expect {
        post "/api/attempts/#{attempt.id}/generate", headers: auth_headers(token), as: :json
      }.to have_enqueued_job(GenerateImageJob).with(attempt.id)

      expect(response).to have_http_status(:accepted)
      expect(response.parsed_body["attempt"]["status"]).to eq("generating")
      expect(attempt.reload.generated_at).to be_present
    end

    it "他人の挑戦は 404" do
      others = create(:attempt)

      post "/api/attempts/#{others.id}/generate", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "draft でなければ 422 と attempt_not_draft" do
      published = create(:attempt, :published, user: user)

      post "/api/attempts/#{published.id}/generate", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("error" => "attempt_not_draft")
    end

    it "未認証は 401" do
      post "/api/attempts/#{attempt.id}/generate", as: :json

      expect(response).to have_http_status(:unauthorized)
    end

    # 「1日」は JST の暦日。API が返す時刻は他のフィールドと同じく UTC の ISO8601 に
    # 揃えるので、JST 翌日 0 時は …T15:00:00Z になる。
    it "上限に達すると 422 とコード・上限・回復時刻を返す" do
      travel_to(Time.zone.local(2026, 8, 2, 12, 0, 0)) do
        create_list(:attempt, 3, user: user, status: "published", generated_at: Time.current)

        post "/api/attempts/#{attempt.id}/generate", headers: auth_headers(token), as: :json

        expect(response).to have_http_status(:unprocessable_content)
        expect(response.parsed_body).to eq(
          "error" => "generation_limit_reached",
          "limit" => 3,
          "resets_at" => "2026-08-02T15:00:00Z"
        )
      end
      expect(attempt.reload.status).to eq("draft")
    end

    # 「誰の問題か」でステータスを分ける。422 はユーザーが訂正できるもの、
    # 503 はこちら側の都合。フロントは前者を訂正可能なエラー、後者を
    # 時間を置いて再訪する案内として出し分ける。
    it "キルスイッチが off なら 503" do
      allow(Attempts::Generation).to receive(:enabled?).and_return(false)

      post "/api/attempts/#{attempt.id}/generate", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:service_unavailable)
      expect(response.parsed_body).to eq("error" => "generation_disabled")
      expect(attempt.reload.status).to eq("draft")
    end

    it "サービス全体の上限に達すると 503 と回復時刻を返す" do
      allow(Attempts::Generation).to receive(:service_daily_limit).and_return(1)

      travel_to(Time.zone.local(2026, 8, 2, 12, 0, 0)) do
        create(:attempt, user: create(:user), status: "published", generated_at: Time.current)

        post "/api/attempts/#{attempt.id}/generate", headers: auth_headers(token), as: :json

        expect(response).to have_http_status(:service_unavailable)
        expect(response.parsed_body).to eq(
          "error" => "service_generation_limit_reached",
          "resets_at" => "2026-08-02T15:00:00Z"
        )
      end
    end
  end

  describe "GET /api/attempts/:id" do
    it "公開済みの挑戦は未認証でも取得でき、お題も一緒に返る" do
      attempt = create(:attempt, :published, user: user, post: post_record)
      create_list(:like, 2, attempt: attempt)

      get "/api/attempts/#{attempt.id}"

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]).to include(
        "id" => attempt.id,
        "status" => "published",
        "generated_image_public_id" => "kotoe/test/generated/sample",
        "likes_count" => 2,
        "liked" => false
      )
      # 比較ビューが「元画像 vs 再現画像」を並べるため、元画像がこの1本で揃う。
      expect(response.parsed_body["post"]).to include(
        "id" => post_record.id,
        "image_public_id" => post_record.image_public_id
      )
    end

    it "自分がいいねしている挑戦は liked が true になる" do
      attempt = create(:attempt, :published, post: post_record)
      create(:like, user: user, attempt: attempt)

      get "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(response.parsed_body["attempt"]["liked"]).to be(true)
    end

    it "自分の下書きは取得できる" do
      attempt = create(:attempt, user: user)

      get "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]["status"]).to eq("draft")
    end

    it "生成中の自分の挑戦をポーリングできる" do
      attempt = create(:attempt, :generating, user: user)

      get "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(response.parsed_body["attempt"]["status"]).to eq("generating")
    end

    # 失敗の理由はコードで返し、翻訳はフロントの辞書が持つ。理由を返さないと、
    # ポリシー違反のユーザーが同じ文章で再挑戦して生成枠をもう1つ失う。
    it "失敗した挑戦は理由コードを返す" do
      attempt = create(:attempt, :failed, user: user, failure_reason: "content_policy")

      get "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["attempt"]).to include(
        "status" => "failed",
        "failure_reason" => "content_policy"
      )
    end

    it "失敗していない挑戦の failure_reason は null" do
      attempt = create(:attempt, :published, user: user)

      get "/api/attempts/#{attempt.id}"

      expect(response.parsed_body["attempt"]).to include("failure_reason" => nil)
    end

    # 403 にせず存在ごと隠す。未認証も 401 ではなく 404 にする。published が
    # 認証不要である以上、401 は「認証すれば見える何かがある」と漏らすため。
    it "他人の下書きは 404" do
      others = create(:attempt)

      get "/api/attempts/#{others.id}", headers: auth_headers(token)

      expect(response).to have_http_status(:not_found)
    end

    it "未認証で他人の下書きを取ると 404" do
      others = create(:attempt)

      get "/api/attempts/#{others.id}"

      expect(response).to have_http_status(:not_found)
    end

    it "削除済みは本人でも 404" do
      attempt = create(:attempt, :published, user: user)
      attempt.discard!

      get "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(response).to have_http_status(:not_found)
    end

    it "お題が削除されていたら 404" do
      attempt = create(:attempt, :published, user: user, post: post_record)
      post_record.discard!

      get "/api/attempts/#{attempt.id}"

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "DELETE /api/attempts/:id" do
    it "自分の挑戦を論理削除できる" do
      attempt = create(:attempt, :published, user: user)

      delete "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(response).to have_http_status(:no_content)
      expect(attempt.reload).to be_discarded
      expect(Attempt.where(id: attempt.id)).to exist
    end

    # 削除しても回数は戻さない（無限リトライ防止とコスト対策）。
    it "削除しても generated_at は消えない" do
      attempt = create(:attempt, :published, user: user, generated_at: Time.current)

      delete "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(attempt.reload.generated_at).to be_present
    end

    it "生成中でも削除できる" do
      attempt = create(:attempt, :generating, user: user)

      delete "/api/attempts/#{attempt.id}", headers: auth_headers(token)

      expect(response).to have_http_status(:no_content)
      expect(attempt.reload).to be_discarded
    end

    it "他人の挑戦は 404" do
      others = create(:attempt)

      delete "/api/attempts/#{others.id}", headers: auth_headers(token)

      expect(response).to have_http_status(:not_found)
    end

    it "未認証は 401" do
      attempt = create(:attempt, user: user)

      delete "/api/attempts/#{attempt.id}"

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
