require "rails_helper"

RSpec.describe "GET /api/me/posts", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }

  it "未認証だと 401 を返す" do
    get "/api/me/posts"

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("unauthorized")
  end

  # 新着順であることを見るため、作成順は期待する順序と逆にする。
  it "自分のお題を新着順で返す" do
    older = create(:post, user: user, created_at: 2.days.ago)
    newer = create(:post, user: user, created_at: 1.day.ago)

    get "/api/me/posts", headers: auth_headers(token)

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["posts"].map { |post| post["id"] }).to eq([ newer.id, older.id ])
  end

  it "他人のお題を含めない" do
    create(:post)

    get "/api/me/posts", headers: auth_headers(token)

    expect(response.parsed_body["posts"]).to be_empty
  end

  it "削除済みの自分のお題を含めない" do
    create(:post, user: user).discard!

    get "/api/me/posts", headers: auth_headers(token)

    expect(response.parsed_body["posts"]).to be_empty
    expect(response.parsed_body["meta"]["total_count"]).to eq(0)
  end

  it "1 件も無ければ空配列と total_count 0 を返す" do
    get "/api/me/posts", headers: auth_headers(token)

    expect(response.parsed_body["posts"]).to eq([])
    expect(response.parsed_body["meta"]["total_count"]).to eq(0)
  end

  it "お題一覧と同じ形（attempts_count / likes_count / favorited）で返す" do
    post_record = create(:post, user: user)
    create_list(:like, 2, attempt: create(:attempt, :published, post: post_record))
    create(:favorite, user: user, post: post_record)

    get "/api/me/posts", headers: auth_headers(token)

    item = response.parsed_body["posts"].first
    expect(item["attempts_count"]).to eq(1)
    expect(item["likes_count"]).to eq(2)
    # 自分のお題も 5-2 でお気に入りできるので、ここは本人基準で埋まる。
    expect(item["favorited"]).to be(true)
  end

  it "1 ページ 12 件で、13 件目は 2 ページ目に出る" do
    create_list(:post, 13, user: user)

    get "/api/me/posts", headers: auth_headers(token)
    expect(response.parsed_body["posts"].size).to eq(12)
    expect(response.parsed_body["meta"]).to eq(
      "current_page" => 1, "total_pages" => 2, "total_count" => 13
    )

    get "/api/me/posts", params: { page: 2 }, headers: auth_headers(token)
    expect(response.parsed_body["posts"].size).to eq(1)
    expect(response.parsed_body["meta"]["current_page"]).to eq(2)
  end

  # headers を測定の外で組み立てるのが要点。let(:token) はサインインの
  # リクエストを 1 回打つので、ブロックの中で初めて触るとその分が数に混ざる。
  it "お題が増えてもクエリ数が増えない（N+1 を作り込まない）" do
    headers = auth_headers(token)
    create(:post, user: user)
    with_one = count_select_queries { get "/api/me/posts", headers: headers }

    create_list(:post, 2, user: user)
    with_three = count_select_queries { get "/api/me/posts", headers: headers }

    expect(with_three).to eq(with_one)
  end
end
