require "rails_helper"

RSpec.describe "GET /api/posts", type: :request do
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
      "favorited" => false,
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

  # 並び替えとページングを組み合わせた経路が、ここまで一度も通っていなかった。
  #
  # sort=popular は Post.with_counts が SELECT 句で作る別名 likes_count で ORDER BY する。
  # 総件数のクエリは SELECT 句が COUNT(*) に置き換わり、その別名が存在しないため、
  # ORDER BY を持ち越すと column "likes_count" does not exist で 500 になる。
  #
  # 実際には二重に守られている。kaminari は total_count で except(:order) しており
  # （gem 側にも「#count は #order が参照する生成列を含む #select を上書きする」と
  # このケースを名指ししたコメントがある）、ActiveRecord の count も group が無ければ
  # order を落とす。生 SQL で数える形に書き換えない限り壊れない。
  #
  # 挑戦一覧（GET /api/posts/:id?sort=likes）にも同じ検査がある。
  it "sort=popular をページングと併用しても総件数が正しく出る" do
    create_list(:post, 13)

    get "/api/posts", params: { sort: "popular", page: 2 }

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["posts"].size).to eq(1)
    expect(response.parsed_body["meta"]).to eq(
      "current_page" => 2, "total_pages" => 2, "total_count" => 13
    )
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

  it "ログインしていれば自分がお気に入りしたお題だけ favorited が true になる" do
    user = create(:user)
    token = sign_in_and_get_token(user)
    favorited = create(:post)
    not_favorited = create(:post)
    create(:favorite, user: user, post: favorited)

    get "/api/posts", headers: auth_headers(token)

    flags = response.parsed_body["posts"].to_h { |p| [ p["id"], p["favorited"] ] }
    expect(flags).to eq(favorited.id => true, not_favorited.id => false)
  end

  it "他人がお気に入りしていても自分の favorited は false" do
    user = create(:user)
    token = sign_in_and_get_token(user)
    post_record = create(:post)
    create(:favorite, post: post_record)

    get "/api/posts", headers: auth_headers(token)

    expect(response.parsed_body["posts"].first["favorited"]).to be(false)
  end

  it "お題が増えてもクエリ数が増えない（N+1 を作り込まない）" do
    create(:post)
    with_one = count_select_queries { get "/api/posts" }

    create_list(:post, 2)
    with_three = count_select_queries { get "/api/posts" }

    expect(with_three).to eq(with_one)
  end

  # ログイン状態で測るのが要点。未認証だと Favorite.favorited_post_ids が early return
  # して DB を触らないため、favorited の判定を 1 件ずつの exists? に書き換えても
  # 上の未認証の N+1 検査では検知できない。
  it "ログイン状態でもお題が増えてクエリ数が増えない（favorited の判定で N+1 を作り込まない）" do
    user = create(:user)
    token = sign_in_and_get_token(user)
    create(:post)
    with_one = count_select_queries { get "/api/posts", headers: auth_headers(token) }

    create_list(:post, 2)
    with_three = count_select_queries { get "/api/posts", headers: auth_headers(token) }

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
      "likes_count" => 0,
      "favorited" => false
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
      "liked" => false,
      "created_at" => attempt.created_at.utc.iso8601
    )
    expect(response.parsed_body["meta"]).to eq(
      "current_page" => 1, "total_pages" => 1, "total_count" => 1
    )
  end

  it "ログインしていれば自分がいいねした挑戦だけ liked が true になる" do
    user = create(:user)
    token = sign_in_and_get_token(user)
    post_record = create(:post)
    liked = create(:attempt, :published, post: post_record)
    not_liked = create(:attempt, :published, post: post_record)
    create(:like, user: user, attempt: liked)

    get "/api/posts/#{post_record.id}", headers: auth_headers(token)

    liked_flags = response.parsed_body["attempts"].to_h { |a| [ a["id"], a["liked"] ] }
    expect(liked_flags).to eq(liked.id => true, not_liked.id => false)
  end

  it "お題の favorited を返す" do
    user = create(:user)
    token = sign_in_and_get_token(user)
    post_record = create(:post)
    create(:favorite, user: user, post: post_record)

    get "/api/posts/#{post_record.id}", headers: auth_headers(token)

    expect(response.parsed_body["post"]["favorited"]).to be(true)
  end

  it "未認証なら favorited は false" do
    post_record = create(:post)
    create(:favorite, post: post_record)

    get "/api/posts/#{post_record.id}"

    expect(response.parsed_body["post"]["favorited"]).to be(false)
  end

  # ログイン状態で測るのが要点。未認証だと Like.liked_attempt_ids が early return して
  # DB を触らないため、liked の判定を 1 件ずつの exists? に書き換えても検知できない。
  it "挑戦が増えてもクエリ数が増えない（liked の判定で N+1 を作り込まない）" do
    user = create(:user)
    token = sign_in_and_get_token(user)
    post_record = create(:post)
    create(:attempt, :published, post: post_record)
    with_one = count_select_queries { get "/api/posts/#{post_record.id}", headers: auth_headers(token) }

    create_list(:attempt, 2, :published, post: post_record)
    with_three = count_select_queries { get "/api/posts/#{post_record.id}", headers: auth_headers(token) }

    expect(with_three).to eq(with_one)
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

  it "sort=likes で挑戦がいいねの多い順になる" do
    post_record = create(:post)
    popular = create(:attempt, :published, post: post_record, created_at: 2.days.ago)
    newer = create(:attempt, :published, post: post_record, created_at: 1.day.ago)
    create_list(:like, 2, attempt: popular)

    get "/api/posts/#{post_record.id}", params: { sort: "likes" }

    expect(response.parsed_body["attempts"].map { |a| a["id"] }).to eq([ popular.id, newer.id ])
  end

  it "未知の sort は新着順にフォールバックする" do
    post_record = create(:post)
    popular = create(:attempt, :published, post: post_record, created_at: 2.days.ago)
    newer = create(:attempt, :published, post: post_record, created_at: 1.day.ago)
    create_list(:like, 2, attempt: popular)

    get "/api/posts/#{post_record.id}", params: { sort: "nonsense" }

    expect(response.parsed_body["attempts"].map { |a| a["id"] }).to eq([ newer.id, popular.id ])
  end

  # いいねを作成順と逆向きに振る。同じ向きだと新着順と並びが一致してしまい、
  # 表彰台がいいねを見ていなくても通る。
  it "best_attempts がいいね上位3件を返す" do
    post_record = create(:post)
    attempts = create_list(:attempt, 4, :published, post: post_record)
    attempts.each_with_index { |attempt, index| create_list(:like, 4 - index, attempt: attempt) }

    get "/api/posts/#{post_record.id}"

    expect(response.parsed_body["best_attempts"].map { |a| a["id"] })
      .to eq(attempts.first(3).map(&:id))
  end

  # 表彰台を一覧の並び替え結果から切り出したことの固定（設計書の案B・案Cを採らなかった理由）。
  it "best_attempts は sort の指定によらず同じ内容を返す" do
    post_record = create(:post)
    popular = create(:attempt, :published, post: post_record, created_at: 2.days.ago)
    newer = create(:attempt, :published, post: post_record, created_at: 1.day.ago)
    create_list(:like, 2, attempt: popular)

    get "/api/posts/#{post_record.id}", params: { sort: "likes" }
    with_likes = response.parsed_body["best_attempts"].map { |a| a["id"] }

    get "/api/posts/#{post_record.id}"
    with_default = response.parsed_body["best_attempts"].map { |a| a["id"] }

    expect(with_likes).to eq([ popular.id, newer.id ])
    expect(with_default).to eq(with_likes)
  end

  # 配列を丸ごと突き合わせる。first だけを見ると、2 ページ目で 1 件に切り詰められても
  # 並びが変わっても通ってしまい、案C（page=1 のときだけ返す）を排除できない。
  it "best_attempts は page=2 でも 1 ページ目と同じ内容で入る" do
    post_record = create(:post)
    create_list(:attempt, 13, :published, post: post_record)
    best = create(:attempt, :published, post: post_record)
    create_list(:like, 5, attempt: best)

    get "/api/posts/#{post_record.id}"
    on_page_1 = response.parsed_body["best_attempts"]

    get "/api/posts/#{post_record.id}", params: { page: 2 }

    expect(on_page_1.size).to eq(3)
    expect(on_page_1.first["id"]).to eq(best.id)
    expect(response.parsed_body["best_attempts"]).to eq(on_page_1)
    expect(response.parsed_body["attempts"].size).to eq(2)
  end

  it "best_attempts の要素は attempts と同じ形で、liked も埋まる" do
    user = create(:user)
    token = sign_in_and_get_token(user)
    post_record = create(:post)
    attempt = create(:attempt, :published, post: post_record)
    create(:like, user: user, attempt: attempt)

    get "/api/posts/#{post_record.id}", headers: auth_headers(token)

    best = response.parsed_body["best_attempts"].first
    expect(best).to eq(response.parsed_body["attempts"].first)
    expect(best["liked"]).to be(true)
    expect(best["likes_count"]).to eq(1)
  end

  # liked の判定で表彰台の id を束ねていることの固定。best は最古なので、新着順の
  # 1 ページ目（12 件）からは 13 件の新着に押し出されて消える。一方いいねは
  # 最多なので表彰台には残る＝「表彰台にしかいない挑戦」になる。
  # id を束ねずに一覧ぶんだけで引くと、ここのハートだけ白いまま返る。
  it "表彰台にしかいない挑戦でも liked が埋まる" do
    user = create(:user)
    token = sign_in_and_get_token(user)
    post_record = create(:post)
    best = create(:attempt, :published, post: post_record, created_at: 3.days.ago)
    create_list(:attempt, 13, :published, post: post_record)
    create(:like, user: user, attempt: best)

    get "/api/posts/#{post_record.id}", headers: auth_headers(token)

    expect(response.parsed_body["attempts"].map { |a| a["id"] }).not_to include(best.id)
    expect(response.parsed_body["best_attempts"].find { |a| a["id"] == best.id }["liked"]).to be(true)
  end

  # 並び替えとページングを組み合わせた経路の検査。sort=likes は SELECT 句の別名
  # likes_count で ORDER BY するが、総件数のクエリではその別名が存在しない。
  # 二重に守られている仕組みは GET /api/posts の同型の検査に書いた。
  it "sort=likes をページングと併用しても総件数が正しく出る" do
    post_record = create(:post)
    create_list(:attempt, 13, :published, post: post_record)

    get "/api/posts/#{post_record.id}", params: { sort: "likes", page: 2 }

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["attempts"].size).to eq(1)
    expect(response.parsed_body["meta"]).to eq(
      "current_page" => 2, "total_pages" => 2, "total_count" => 13
    )
  end

  it "best_attempts に下書き・削除済みは入らない" do
    post_record = create(:post)
    create(:attempt, post: post_record)
    create(:attempt, :published, post: post_record).discard!

    get "/api/posts/#{post_record.id}"

    expect(response.parsed_body["best_attempts"]).to eq([])
  end

  # 空配列とフィールドごと無いことを区別する。フロントは「まだ誰も挑戦していない」と
  # 「挑戦はあるがいいねが0」を出し分ける。
  it "挑戦が無ければ best_attempts は空配列" do
    post_record = create(:post)

    get "/api/posts/#{post_record.id}"

    expect(response.parsed_body["best_attempts"]).to eq([])
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
