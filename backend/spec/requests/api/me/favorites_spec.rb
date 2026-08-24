require "rails_helper"

RSpec.describe "GET /api/me/favorites", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }

  it "未認証だと 401 を返す" do
    get "/api/me/favorites"

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("unauthorized")
  end

  # 「お気に入りした順」であることを見るため、お題の作成順は期待する順序と逆にする。
  # 揃えると、並び替えを消して新着順のままでも通ってしまう。
  it "お気に入りした新しい順に返る" do
    older_post = create(:post, created_at: 1.day.ago)
    newer_post = create(:post, created_at: 2.days.ago)
    create(:favorite, user: user, post: older_post, created_at: 2.days.ago)
    create(:favorite, user: user, post: newer_post, created_at: 1.day.ago)

    get "/api/me/favorites", headers: auth_headers(token)

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["posts"].map { |post| post["id"] }).to eq([ newer_post.id, older_post.id ])
  end

  it "お気に入りしていないお題を含めない" do
    create(:post)

    get "/api/me/favorites", headers: auth_headers(token)

    expect(response.parsed_body["posts"]).to be_empty
  end

  it "他人のお気に入りを含めない" do
    create(:favorite, post: create(:post))

    get "/api/me/favorites", headers: auth_headers(token)

    expect(response.parsed_body["posts"]).to be_empty
  end

  # 5-2 が削除済みお題への解除を 404 にしているので、出すと必ず 404 を返す
  # 解除ボタンが画面に並ぶ（設計書参照）。挑戦タブと扱いが逆になるのは、
  # 片付ける手段が残っているかどうかが逆だから。
  it "削除済みのお題を含めない" do
    post_record = create(:post)
    create(:favorite, user: user, post: post_record)
    post_record.discard!

    get "/api/me/favorites", headers: auth_headers(token)

    expect(response.parsed_body["posts"]).to be_empty
    expect(response.parsed_body["meta"]["total_count"]).to eq(0)
  end

  it "お気に入りを解除すると消える" do
    post_record = create(:post)
    create(:favorite, user: user, post: post_record)

    delete "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token)
    expect(response).to have_http_status(:ok)

    get "/api/me/favorites", headers: auth_headers(token)

    expect(response.parsed_body["posts"]).to be_empty
  end

  it "1 件も無ければ空配列と total_count 0 を返す" do
    get "/api/me/favorites", headers: auth_headers(token)

    expect(response.parsed_body["posts"]).to eq([])
    expect(response.parsed_body["meta"]["total_count"]).to eq(0)
  end

  it "お題一覧と同じ形で返し、favorited は常に true" do
    post_record = create(:post)
    create(:favorite, user: user, post: post_record)
    create_list(:like, 2, attempt: create(:attempt, :published, post: post_record))

    get "/api/me/favorites", headers: auth_headers(token)

    item = response.parsed_body["posts"].first
    expect(item["attempts_count"]).to eq(1)
    expect(item["likes_count"]).to eq(2)
    expect(item["favorited"]).to be(true)
  end

  it "1 ページ 12 件で、13 件目は 2 ページ目に出る" do
    create_list(:post, 13).each { |post_record| create(:favorite, user: user, post: post_record) }

    get "/api/me/favorites", headers: auth_headers(token)
    expect(response.parsed_body["posts"].size).to eq(12)
    expect(response.parsed_body["meta"]).to eq(
      "current_page" => 1, "total_pages" => 2, "total_count" => 13
    )

    get "/api/me/favorites", params: { page: 2 }, headers: auth_headers(token)
    expect(response.parsed_body["posts"].size).to eq(1)
    expect(response.parsed_body["meta"]["current_page"]).to eq(2)
  end

  # headers を測定の外で組み立てるのが要点（me/posts と同じ理由）。
  it "お気に入りが増えてもクエリ数が増えない（N+1 を作り込まない）" do
    headers = auth_headers(token)
    create(:favorite, user: user, post: create(:post))
    with_one = count_select_queries { get "/api/me/favorites", headers: headers }

    create_list(:post, 2).each { |post_record| create(:favorite, user: user, post: post_record) }
    with_three = count_select_queries { get "/api/me/favorites", headers: headers }

    expect(with_three).to eq(with_one)
  end
end
