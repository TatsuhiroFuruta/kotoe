require "rails_helper"

RSpec.describe "GET /api/posts", type: :request do
  # 実行された SELECT の本数を数える。N+1 を作り込んでいないことの検査に使う。
  def count_select_queries
    count = 0
    counter = lambda do |_name, _start, _finish, _id, payload|
      count += 1 if payload[:sql].start_with?("SELECT") && !%w[SCHEMA CACHE].include?(payload[:name])
    end

    ActiveSupport::Notifications.subscribed(counter, "sql.active_record") { yield }
    count
  end

  it "認証なしで一覧を取得できる" do
    author = create(:user, name: "投稿者")
    post_record = create(:post, user: author, title: "夕暮れの交差点", image_public_id: "kotoe/test/posts/a")
    create_list(:like, 2, attempt: create(:attempt, :published, post: post_record))

    get "/api/posts"

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["posts"].first).to eq(
      "id" => post_record.id,
      "title" => "夕暮れの交差点",
      "image_public_id" => "kotoe/test/posts/a",
      "user" => { "id" => author.id, "name" => "投稿者" },
      "attempts_count" => 1,
      "likes_count" => 2,
      "created_at" => post_record.created_at.utc.iso8601
    )
  end

  # 投稿者の表現に email が混ざらないことを、キーの過不足なしで固定する。
  # include ではなく contain_exactly にすることで、将来 users にカラムを足したり
  # うっかり as_json に書き換えたときに必ず赤くなる。
  it "投稿者に email を含めない" do
    create(:post)

    get "/api/posts"

    expect(response.parsed_body["posts"].first["user"].keys).to contain_exactly("id", "name")
  end

  it "削除済みのお題は出ない" do
    create(:post).discard!

    get "/api/posts"

    expect(response.parsed_body["posts"]).to be_empty
    expect(response.parsed_body["meta"]["total_count"]).to eq(0)
  end

  it "1 ページ 12 件で、13 件目は 2 ページ目に出る" do
    create_list(:post, 13)

    get "/api/posts"
    expect(response.parsed_body["posts"].size).to eq(12)
    expect(response.parsed_body["meta"]).to eq(
      "current_page" => 1, "total_pages" => 2, "total_count" => 13
    )

    get "/api/posts", params: { page: 2 }
    expect(response.parsed_body["posts"].size).to eq(1)
    expect(response.parsed_body["meta"]["current_page"]).to eq(2)
  end

  it "q でタイトルを絞り込む" do
    hit = create(:post, title: "夕暮れの交差点")
    create(:post, title: "朝の海")

    get "/api/posts", params: { q: "夕暮れ" }

    expect(response.parsed_body["posts"].map { |post| post["id"] }).to eq([ hit.id ])
  end

  it "sort=popular でいいね合計の降順になる" do
    quiet = create(:post, created_at: 1.day.ago)
    loud = create(:post, created_at: 2.days.ago)
    create_list(:like, 2, attempt: create(:attempt, :published, post: loud))

    get "/api/posts", params: { sort: "popular" }

    expect(response.parsed_body["posts"].map { |post| post["id"] }).to eq([ loud.id, quiet.id ])
  end

  it "未知の sort は新着順にフォールバックする" do
    older = create(:post, created_at: 2.days.ago)
    newer = create(:post, created_at: 1.day.ago)

    get "/api/posts", params: { sort: "nonsense" }

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["posts"].map { |post| post["id"] }).to eq([ newer.id, older.id ])
  end

  it "お題が増えてもクエリ数が増えない（N+1 を作り込まない）" do
    create(:post)
    with_one = count_select_queries { get "/api/posts" }

    create_list(:post, 2)
    with_three = count_select_queries { get "/api/posts" }

    expect(with_three).to eq(with_one)
  end
end
