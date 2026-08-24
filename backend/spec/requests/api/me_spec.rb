require "rails_helper"

RSpec.describe "GET /api/me", type: :request do
  let!(:user) { create(:user, name: "テスト太郎", email: "me@example.com") }

  it "JWT を付けるとログイン中のユーザーを返す" do
    token = sign_in_and_get_token(user)

    get "/api/me", headers: auth_headers(token)

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to eq(
      "id" => user.id,
      "name" => "テスト太郎",
      "email" => "me@example.com",
      "stats" => { "posts_count" => 0, "attempts_count" => 0, "likes_received_count" => 0 }
    )
  end

  it "Authorization ヘッダが無いと 401 を返す" do
    get "/api/me"

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("unauthorized")
  end

  it "デタラメなトークンだと 401 を返す" do
    get "/api/me", headers: auth_headers("Bearer not-a-real-token")

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("unauthorized")
  end

  # この issue の完了条件そのもの。
  it "sign_out 後は同じトークンで 401 になる" do
    token = sign_in_and_get_token(user)
    get "/api/me", headers: auth_headers(token)
    expect(response).to have_http_status(:ok)

    delete "/api/auth/sign_out", headers: auth_headers(token)
    expect(response).to have_http_status(:ok)

    get "/api/me", headers: auth_headers(token)
    expect(response).to have_http_status(:unauthorized)
  end

  # マイページのプロフィールヘッダー（7-6）が使う。投稿数と挑戦数は
  # 各タブの meta.total_count と一致する定義（設計書参照）。
  it "stats に投稿数・公開済み挑戦数・獲得いいね合計を返す" do
    create_list(:post, 2, user: user)
    create(:attempt, user: user)
    create_list(:like, 3, attempt: create(:attempt, :published, user: user))
    token = sign_in_and_get_token(user)

    get "/api/me", headers: auth_headers(token)

    expect(response.parsed_body["stats"]).to eq(
      "posts_count" => 2, "attempts_count" => 1, "likes_received_count" => 3
    )
  end

  # 設計書が完了条件に挙げた不変条件（ヘッダーの数字とタブの中身がズレない）を、
  # 実際に突き合わせて縛る。約束の実体は 2 か所に分かれている：統計は User の集計
  # （posts.kept.count）、一覧は Post.for_listing で、後者は公開一覧の Post.listing と
  # 共有している。将来 for_listing に絞り込みが 1 つ足されると、片方だけ動いても
  # それぞれの spec は green のままで、この約束だけが黙って壊れる。
  it "stats.posts_count が me/posts の meta.total_count と一致する" do
    create_list(:post, 13, user: user)
    create(:post, user: user).discard!
    create(:post)
    token = sign_in_and_get_token(user)

    get "/api/me", headers: auth_headers(token)
    posts_count = response.parsed_body["stats"]["posts_count"]

    get "/api/me/posts", headers: auth_headers(token)

    expect(posts_count).to eq(13)
    expect(response.parsed_body["meta"]["total_count"]).to eq(posts_count)
  end

  it "stats.attempts_count が me/attempts の meta.total_count と一致する" do
    create_list(:attempt, 13, :published, user: user)
    # 削除済みお題ぶら下がりは、一覧にも統計にも入る（この issue の決定の固定）。
    discarded_post = create(:post)
    create(:attempt, :published, post: discarded_post, user: user)
    discarded_post.discard!
    # 下書き・失敗・削除済みの挑戦は、どちらにも入らない。
    create(:attempt, user: user)
    create(:attempt, :failed, user: user)
    create(:attempt, :published, user: user).discard!
    token = sign_in_and_get_token(user)

    get "/api/me", headers: auth_headers(token)
    attempts_count = response.parsed_body["stats"]["attempts_count"]

    get "/api/me/attempts", headers: auth_headers(token)

    expect(attempts_count).to eq(14)
    expect(response.parsed_body["meta"]["total_count"]).to eq(attempts_count)
  end

  # 拡張範囲を /api/me に閉じたことの固定。private_profile は sign_up / sign_in と
  # 共有しており、そちらで集計 3 本を走らせる理由が無い。
  it "sign_in の応答には stats を含めない" do
    post "/api/auth/sign_in",
      params: { user: { email: user.email, password: "password123" } },
      as: :json

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).not_to have_key("stats")
  end
end
