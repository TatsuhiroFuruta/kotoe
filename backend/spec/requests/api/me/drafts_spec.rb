require "rails_helper"

RSpec.describe "GET /api/me/drafts", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }

  it "未認証だと 401 を返す" do
    get "/api/me/drafts"

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("unauthorized")
  end

  # 下書きも Attempt なので応答キーは attempts のまま。URL だけを分ける（設計書参照）。
  # 新着順であることを見るため、作成順は期待する順序と逆にする。
  it "自分の下書きを attempts キーに新着順で返す" do
    older = create(:attempt, user: user, created_at: 2.days.ago)
    newer = create(:attempt, user: user, created_at: 1.day.ago)

    get "/api/me/drafts", headers: auth_headers(token)

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["attempts"].map { |attempt| attempt["id"] }).to eq([ newer.id, older.id ])
  end

  it "公開済み・生成中・失敗・削除済みを含めない" do
    create(:attempt, :published, user: user)
    create(:attempt, :generating, user: user)
    create(:attempt, :failed, user: user)
    create(:attempt, user: user).discard!

    get "/api/me/drafts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"]).to be_empty
  end

  it "他人の下書きを含めない" do
    create(:attempt)

    get "/api/me/drafts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"]).to be_empty
  end

  it "1 件も無ければ空配列と total_count 0 を返す" do
    get "/api/me/drafts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"]).to eq([])
    expect(response.parsed_body["meta"]["total_count"]).to eq(0)
  end

  # ブリーフの下書きタブは「お題サムネイル＋描写文」を出す。
  it "下書きカードに描写文とお題サマリが入る" do
    post_record = create(:post, title: "夕暮れの商店街")
    create(:attempt, post: post_record, user: user, description: "赤い提灯が並ぶ路地")

    get "/api/me/drafts", headers: auth_headers(token)

    item = response.parsed_body["attempts"].first
    expect(item["status"]).to eq("draft")
    expect(item["description"]).to eq("赤い提灯が並ぶ路地")
    expect(item["post"]).to eq(
      "id" => post_record.id,
      "title" => "夕暮れの商店街",
      "image_public_id" => post_record.image_public_id,
      "discarded" => false
    )
  end

  # 削除済みお題の下書きこそ、片付ける手段（DELETE /api/attempts/:id）に
  # 辿り着ける必要がある（4-4 案A の前提）。ただしタイトルと画像は伏せる
  # （取り下げられたお題の public_id を配り続けないため）。
  it "削除済みのお題にぶら下がる下書きも返るが、タイトルと画像は伏せる" do
    post_record = create(:post)
    create(:attempt, post: post_record, user: user)
    post_record.discard!

    get "/api/me/drafts", headers: auth_headers(token)

    expect(response.parsed_body["attempts"].size).to eq(1)
    expect(response.parsed_body["attempts"].first["post"]).to eq(
      "id" => post_record.id,
      "title" => nil,
      "image_public_id" => nil,
      "discarded" => true
    )
  end

  it "1 ページ 12 件で、13 件目は 2 ページ目に出る" do
    create_list(:attempt, 13, user: user)

    get "/api/me/drafts", headers: auth_headers(token)
    expect(response.parsed_body["attempts"].size).to eq(12)
    expect(response.parsed_body["meta"]).to eq(
      "current_page" => 1, "total_pages" => 2, "total_count" => 13
    )

    get "/api/me/drafts", params: { page: 2 }, headers: auth_headers(token)
    expect(response.parsed_body["attempts"].size).to eq(1)
    expect(response.parsed_body["meta"]["current_page"]).to eq(2)
  end

  # headers を測定の外で組み立てるのが要点（me/attempts と同じ理由）。
  it "下書きが増えてもクエリ数が増えない（N+1 を作り込まない）" do
    headers = auth_headers(token)
    create(:attempt, user: user)
    with_one = count_select_queries { get "/api/me/drafts", headers: headers }

    create_list(:attempt, 2, user: user)
    with_three = count_select_queries { get "/api/me/drafts", headers: headers }

    expect(with_three).to eq(with_one)
  end
end
