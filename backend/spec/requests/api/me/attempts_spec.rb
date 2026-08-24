require "rails_helper"

RSpec.describe "GET /api/me/attempts", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }

  it "未認証だと 401 を返す" do
    get "/api/me/attempts"

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("unauthorized")
  end

  # 新着順であることを見るため、作成順は期待する順序と逆にする。
  it "自分の公開済みの挑戦を新着順で返す" do
    older = create(:attempt, :published, user: user, created_at: 2.days.ago)
    newer = create(:attempt, :published, user: user, created_at: 1.day.ago)

    get "/api/me/attempts", headers: auth_headers(token)

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["attempts"].map { |attempt| attempt["id"] }).to eq([ newer.id, older.id ])
  end

  it "下書き・生成中・失敗・削除済みを含めない" do
    create(:attempt, user: user)
    create(:attempt, :generating, user: user)
    create(:attempt, :failed, user: user)
    create(:attempt, :published, user: user).discard!

    get "/api/me/attempts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"]).to be_empty
  end

  it "他人の挑戦を含めない" do
    create(:attempt, :published)

    get "/api/me/attempts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"]).to be_empty
  end

  it "1 件も無ければ空配列と total_count 0 を返す" do
    get "/api/me/attempts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"]).to eq([])
    expect(response.parsed_body["meta"]["total_count"]).to eq(0)
  end

  it "挑戦カードに、どのお題への挑戦かのサマリが入る" do
    post_record = create(:post, title: "夕暮れの商店街")
    create(:attempt, :published, post: post_record, user: user)

    get "/api/me/attempts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"].first["post"]).to eq(
      "id" => post_record.id,
      "title" => "夕暮れの商店街",
      "image_public_id" => post_record.image_public_id,
      "discarded" => false
    )
  end

  # Post#discard は挑戦にカスケードしない。片付ける手段（DELETE /api/attempts/:id）に
  # 画面から辿り着けるよう、出したうえで discarded で描き分けさせる（4-4 案A の前提）。
  #
  # ただしタイトルと画像は伏せる。通報で取り下げられたお題の public_id を、
  # 挑戦した全員のマイページから配り続けることになるため。
  it "削除済みのお題にぶら下がる挑戦も返るが、タイトルと画像は伏せる" do
    post_record = create(:post)
    create(:attempt, :published, post: post_record, user: user)
    post_record.discard!

    get "/api/me/attempts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"].size).to eq(1)
    expect(response.parsed_body["attempts"].first["post"]).to eq(
      "id" => post_record.id,
      "title" => nil,
      "image_public_id" => nil,
      "discarded" => true
    )
  end

  it "likes_count と liked を返す" do
    create_list(:like, 2, attempt: create(:attempt, :published, user: user))

    get "/api/me/attempts", headers: auth_headers(token)

    item = response.parsed_body["attempts"].first
    expect(item["likes_count"]).to eq(2)
    # 自分の挑戦にはいいねできない（5-1）ので false になる。
    expect(item["liked"]).to be(false)
  end

  it "1 ページ 12 件で、13 件目は 2 ページ目に出る" do
    create_list(:attempt, 13, :published, user: user)

    get "/api/me/attempts", headers: auth_headers(token)
    expect(response.parsed_body["attempts"].size).to eq(12)
    expect(response.parsed_body["meta"]).to eq(
      "current_page" => 1, "total_pages" => 2, "total_count" => 13
    )

    get "/api/me/attempts", params: { page: 2 }, headers: auth_headers(token)
    expect(response.parsed_body["attempts"].size).to eq(1)
    expect(response.parsed_body["meta"]["current_page"]).to eq(2)
  end

  # headers を測定の外で組み立てるのが要点。let(:token) はサインインの
  # リクエストを 1 回打つので、ブロックの中で初めて触るとその分が数に混ざる。
  it "挑戦が増えてもクエリ数が増えない（post サマリと liked で N+1 を作り込まない）" do
    headers = auth_headers(token)
    create(:attempt, :published, user: user)
    with_one = count_select_queries { get "/api/me/attempts", headers: headers }

    create_list(:attempt, 2, :published, user: user)
    with_three = count_select_queries { get "/api/me/attempts", headers: headers }

    expect(with_three).to eq(with_one)
  end
end
