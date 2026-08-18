require "rails_helper"

RSpec.describe "お気に入り API", type: :request do
  let(:user) { create(:user) }
  let(:token) { sign_in_and_get_token(user) }
  let(:post_record) { create(:post) }

  describe "POST /api/posts/:post_id/favorite" do
    it "お気に入りに登録すると 200 と更新後のお題を返す" do
      expect {
        post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json
      }.to change(Favorite, :count).by(1)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["post"]).to include(
        "id" => post_record.id,
        "favorited" => true
      )
    end

    # いいねと違い、お気に入りは自分だけのブックマークで公開も集計もされない。
    # 順位に効かないためセルフ登録を禁じる理由が無く、5-1 とここだけ非対称になる。
    # 対称化されないよう固定する。
    it "自分のお題もお気に入りできる" do
      own = create(:post, user: user)

      expect {
        post "/api/posts/#{own.id}/favorite", headers: auth_headers(token), as: :json
      }.to change(Favorite, :count).by(1)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["post"]).to include("favorited" => true)
    end

    it "二重に登録しても増えず、200 を返す" do
      create(:favorite, user: user, post: post_record)

      expect {
        post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json
      }.not_to change(Favorite, :count)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["post"]).to include("favorited" => true)
    end

    it "お気に入り数は応答に含めない" do
      create(:favorite, post: post_record)

      post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response.parsed_body["post"]).not_to have_key("favorites_count")
    end

    it "削除済みのお題には 404" do
      post_record.discard!

      post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body).to eq("error" => "not_found")
    end

    it "存在しない ID は 404" do
      post "/api/posts/0/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "未認証は 401" do
      post "/api/posts/#{post_record.id}/favorite", as: :json

      expect(response).to have_http_status(:unauthorized)
    end

    # 並行リクエストの再現は request spec では作れないため、ここだけ例外をスタブして
    # rescue 節が生きていることを確かめる。DB 制約とアプリ側の uniqueness バリデーションの
    # どちらが先に当たるかは競合相手がコミット済みかどうかで変わるので、両方を見る。
    #
    # any_instance_of が広いのは承知のうえ。request spec からは current_user.favorites だけを
    # 名指しできない。このリクエストで find_or_create_by! を呼ぶのが 1 か所しかないことに
    # 依存しているので、コントローラに別の呼び出しを足すときはここを見直すこと。
    it "DB 制約の競合（RecordNotUnique）でも 200 を返す" do
      allow_any_instance_of(ActiveRecord::Associations::CollectionProxy)
        .to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordNotUnique)

      post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:ok)
    end

    it "バリデーションの競合（RecordInvalid）でも 200 を返す" do
      duplicate = Favorite.new
      duplicate.errors.add(:user_id, :taken)
      allow_any_instance_of(ActiveRecord::Associations::CollectionProxy)
        .to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordInvalid.new(duplicate))

      post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:ok)
    end

    # 「重複していた」以外の検証失敗まで成功にすると、将来 Favorite にバリデーションが
    # 増えたとき 200 と favorited: false を返し、フロントが失敗に気づけなくなる。
    # 文言ではなくエラーコードを返すこと（i18n はフロント）もここで固定する。
    it "重複以外の検証失敗はエラーコードで返す" do
      other = Favorite.new
      other.errors.add(:base, :invalid)
      allow_any_instance_of(ActiveRecord::Associations::CollectionProxy)
        .to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordInvalid.new(other))

      post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("errors" => { "base" => [ "invalid" ] })
    end

    # of_kind? は「重複が含まれていれば true」なので、重複と別の原因が同時に立つと
    # 別の原因ごと握り潰してしまう。重複「だけ」が原因のときに限る。
    it "重複と別の検証失敗が同時なら成功にしない" do
      both = Favorite.new
      both.errors.add(:user_id, :taken)
      both.errors.add(:base, :invalid)
      allow_any_instance_of(ActiveRecord::Associations::CollectionProxy)
        .to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordInvalid.new(both))

      post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]).to include("base" => [ "invalid" ])
    end
  end

  describe "DELETE /api/posts/:post_id/favorite" do
    it "お気に入りを解除すると 200 と更新後のお題を返す" do
      create(:favorite, user: user, post: post_record)

      expect {
        delete "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json
      }.to change(Favorite, :count).by(-1)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["post"]).to include(
        "id" => post_record.id,
        "favorited" => false
      )
    end

    it "お気に入りしていなくても 200 を返し、何も消えない" do
      expect {
        delete "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json
      }.not_to change(Favorite, :count)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["post"]).to include("favorited" => false)
    end

    it "他人のお気に入りは消えない" do
      create(:favorite, user: user, post: post_record)
      create(:favorite, post: post_record)

      delete "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response.parsed_body["post"]).to include("favorited" => false)
      expect(Favorite.where(post: post_record).count).to eq(1)
    end

    # 解除は物理削除（CLAUDE.md の論理削除ルールの例外）。行を残すと
    # (user_id, post_id) の複合ユニークに引っかかり、同じお題をお気に入りし直せなくなる。
    it "解除したお題をもう一度お気に入りにできる" do
      create(:favorite, user: user, post: post_record)

      delete "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json
      post "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["post"]).to include("favorited" => true)
    end

    # 削除済みのお題は POST と同じく 404。6-3 の /api/me/favorites は Post.kept で
    # 絞る想定なので、その行はどの画面にも出てこず、片付ける導線に意味がない。
    it "削除済みのお題には 404" do
      create(:favorite, user: user, post: post_record)
      post_record.discard!

      delete "/api/posts/#{post_record.id}/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body).to eq("error" => "not_found")
    end

    it "存在しない ID は 404" do
      delete "/api/posts/0/favorite", headers: auth_headers(token), as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "未認証は 401" do
      delete "/api/posts/#{post_record.id}/favorite", as: :json

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
