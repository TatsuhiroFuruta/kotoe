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

  # 認証不要のエンドポイントなので、誰でも投げられる値で 500 にできてはいけない。
  # kaminari の OFFSET は 12 * (page - 1) で、桁が大きいと int8 を溢れる。
  it "page が巨大でも配列でも 500 にならない" do
    create(:post)

    get "/api/posts", params: { page: "10000000000000000000" }
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["posts"]).to be_empty

    get "/api/posts", params: { page: [ "1" ] }
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["meta"]["current_page"]).to eq(1)
  end

  it "お題が増えてもクエリ数が増えない（N+1 を作り込まない）" do
    create(:post)
    with_one = count_select_queries { get "/api/posts" }

    create_list(:post, 2)
    with_three = count_select_queries { get "/api/posts" }

    expect(with_three).to eq(with_one)
  end
end

RSpec.describe "POST /api/posts", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }
  let(:image) { multipart_image(:jpeg, filename: "sunset.jpg", type: "image/jpeg") }

  it "画像とタイトルを送るとお題を作成する" do
    expect {
      post "/api/posts",
        params: { post: { title: "夕暮れの交差点", image: image } },
        headers: auth_headers(token)
    }.to change(Post, :count).by(1)

    expect(response).to have_http_status(:created)

    created = Post.last
    expect(created.user).to eq(user)
    expect(created.title).to eq("夕暮れの交差点")
    # spec/support/cloudinary.rb の既定スタブが保存先フォルダから public_id を作る。
    expect(created.image_public_id).to eq("kotoe/test/posts/stubbed")

    expect(response.parsed_body["post"]).to include(
      "id" => created.id,
      "title" => "夕暮れの交差点",
      "attempts_count" => 0,
      "likes_count" => 0
    )
  end

  it "投稿者は current_user になる（user_id を送っても無視する）" do
    other = create(:user)

    post "/api/posts",
      params: { post: { title: "夕暮れ", image: image, user_id: other.id } },
      headers: auth_headers(token)

    expect(response).to have_http_status(:created)
    expect(Post.last.user).to eq(user)
  end

  it "タイトルが空と画像が過大なとき、両方のエラーを一度に返す" do
    too_large = multipart_image(:jpeg, filename: "big.jpg", type: "image/jpeg", bytesize: 5.megabytes + 1)

    expect {
      post "/api/posts",
        params: { post: { title: "", image: too_large } },
        headers: auth_headers(token)
    }.not_to change(Post, :count)

    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).to eq(
      "title" => [ "blank" ],
      "image" => [ "image_too_large" ]
    )
  end

  it "画像が無いと image_missing を返す" do
    post "/api/posts",
      params: { post: { title: "夕暮れ" } },
      headers: auth_headers(token)

    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).to eq("image" => [ "image_missing" ])
  end

  # params[:post] の型はクライアントが決められる。ハッシュ以外を送られても
  # 500 ではなく通常の検証エラーとして扱う。
  it "post がハッシュでなくても 500 にせず 422 を返す" do
    post "/api/posts", params: { post: "foo" }, headers: auth_headers(token)

    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).to eq(
      "title" => [ "blank" ], "image" => [ "image_missing" ]
    )
  end

  # 配列も dig に応答するため、respond_to?(:dig) では素通りしてしまう。
  # 素通りすると ["foo"][:title] が TypeError になり 500 になる。
  it "post が配列でも 500 にせず 422 を返す" do
    post "/api/posts", params: { post: [ "foo" ] }, headers: auth_headers(token)

    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).to eq(
      "title" => [ "blank" ], "image" => [ "image_missing" ]
    )
  end

  it "検証で落ちたときは Cloudinary へ上げない" do
    post "/api/posts",
      params: { post: { title: "夕暮れ" } },
      headers: auth_headers(token)

    expect(Cloudinary::Uploader).not_to have_received(:upload)
  end

  it "Cloudinary が失敗したら 502 と image_upload_failed を返す" do
    allow(Cloudinary::Uploader).to receive(:upload).and_raise(StandardError, "boom")

    expect {
      post "/api/posts",
        params: { post: { title: "夕暮れ", image: image } },
        headers: auth_headers(token)
    }.not_to change(Post, :count)

    expect(response).to have_http_status(:bad_gateway)
    expect(response.parsed_body["error"]).to eq("image_upload_failed")
  end

  it "未認証だと 401 を返す" do
    post "/api/posts", params: { post: { title: "夕暮れ", image: image } }

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("unauthorized")
  end
end

RSpec.describe "GET /api/posts/:id", type: :request do
  it "認証なしでお題と挑戦一覧を取得できる" do
    challenger = create(:user, name: "挑戦者")
    post_record = create(:post, title: "夕暮れの交差点")
    attempt = create(:attempt, :published,
      post: post_record, user: challenger,
      description: "夕日に染まる横断歩道", similarity_score: nil)
    create_list(:like, 3, attempt: attempt)

    get "/api/posts/#{post_record.id}"

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["post"]["id"]).to eq(post_record.id)
    expect(response.parsed_body["attempts"].first).to eq(
      "id" => attempt.id,
      "description" => "夕日に染まる横断歩道",
      "generated_image_public_id" => "kotoe/test/generated/sample",
      "status" => "published",
      "failure_reason" => nil,
      "similarity_score" => nil,
      "user" => { "id" => challenger.id, "name" => "挑戦者" },
      "likes_count" => 3,
      "created_at" => attempt.created_at.utc.iso8601
    )
    expect(response.parsed_body["meta"]).to eq(
      "current_page" => 1, "total_pages" => 1, "total_count" => 1
    )
  end

  it "他人の下書きは出ない" do
    post_record = create(:post)
    create(:attempt, post: post_record)

    get "/api/posts/#{post_record.id}"

    expect(response.parsed_body["attempts"]).to be_empty
  end

  it "削除済みの挑戦は出ない" do
    post_record = create(:post)
    create(:attempt, :published, post: post_record).discard!

    get "/api/posts/#{post_record.id}"

    expect(response.parsed_body["attempts"]).to be_empty
  end

  it "挑戦一覧も 1 ページ 12 件でページングする" do
    post_record = create(:post)
    create_list(:attempt, 13, :published, post: post_record)

    get "/api/posts/#{post_record.id}", params: { page: 2 }

    expect(response.parsed_body["attempts"].size).to eq(1)
    expect(response.parsed_body["meta"]["total_count"]).to eq(13)
  end

  it "削除済みのお題は 404 を返す" do
    post_record = create(:post)
    post_record.discard!

    get "/api/posts/#{post_record.id}"

    expect(response).to have_http_status(:not_found)
    expect(response.parsed_body["error"]).to eq("not_found")
  end

  it "存在しない ID は 404 を返す" do
    get "/api/posts/999999"

    expect(response).to have_http_status(:not_found)
    expect(response.parsed_body["error"]).to eq("not_found")
  end
end

RSpec.describe "DELETE /api/posts/:id", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }

  it "自分のお題を論理削除する" do
    post_record = create(:post, user: user)

    expect {
      delete "/api/posts/#{post_record.id}", headers: auth_headers(token)
    }.not_to change(Post.unscoped, :count)

    expect(response).to have_http_status(:no_content)
    expect(post_record.reload.discarded?).to be true
  end

  it "削除しても紐づく挑戦は残る" do
    post_record = create(:post, user: user)
    attempt = create(:attempt, :published, post: post_record)

    delete "/api/posts/#{post_record.id}", headers: auth_headers(token)

    expect(response).to have_http_status(:no_content)
    expect(attempt.reload).to be_kept
  end

  it "削除したお題は一覧に出ない" do
    post_record = create(:post, user: user)
    delete "/api/posts/#{post_record.id}", headers: auth_headers(token)

    get "/api/posts"

    expect(response.parsed_body["posts"]).to be_empty
  end

  it "他人のお題は 404 を返す（削除もされない）" do
    others = create(:post)

    delete "/api/posts/#{others.id}", headers: auth_headers(token)

    expect(response).to have_http_status(:not_found)
    expect(response.parsed_body["error"]).to eq("not_found")
    expect(others.reload).to be_kept
  end

  it "既に削除済みのお題は 404 を返す" do
    post_record = create(:post, user: user)
    post_record.discard!

    delete "/api/posts/#{post_record.id}", headers: auth_headers(token)

    expect(response).to have_http_status(:not_found)
  end

  it "未認証だと 401 を返す" do
    post_record = create(:post, user: user)

    delete "/api/posts/#{post_record.id}"

    expect(response).to have_http_status(:unauthorized)
    expect(post_record.reload).to be_kept
  end
end
