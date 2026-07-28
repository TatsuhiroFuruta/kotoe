require "rails_helper"

# issue 3-1 の本番疎通確認用。本番で Cloudinary のキーが通ることを確かめたら
# コントローラ・ルートごと削除する（8-2a の /smoke と同じ扱い）。
RSpec.describe "POST /api/smoke/cloudinary" do
  let(:user) { create(:user) }

  it "未認証なら 401 を返す" do
    post "/api/smoke/cloudinary"

    expect(response).to have_http_status(:unauthorized)
  end

  it "ログイン済みなら public_id を返す" do
    token = sign_in_and_get_token(user)

    post "/api/smoke/cloudinary", headers: auth_headers(token)

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["public_id"]).to eq("kotoe/test/posts/stubbed")
  end

  it "アップロードに失敗したら 502 を返す" do
    allow(Cloudinary::Uploader).to receive(:upload).and_raise(Timeout::Error)
    token = sign_in_and_get_token(user)

    post "/api/smoke/cloudinary", headers: auth_headers(token)

    expect(response).to have_http_status(:bad_gateway)
  end
end
