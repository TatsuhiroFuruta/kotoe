require "rails_helper"

# devise_for のデフォルトは退会（DELETE）・パスワード変更（PATCH/PUT）・
# HTML フォーム用の new/edit/cancel まで生やしてしまう。中でも DELETE /api/auth/sign_up は
# 有効な JWT さえあれば確認なしにユーザーを物理削除してしまう経路で、CLAUDE.md の
# 「論理削除は必ず discard を使う。物理削除しない」に反する。
#
# routes.rb は devise_for :users, skip: :all + 明示的な3本（sign_up/sign_in/sign_out）
# のみを許可リストとして公開している。将来誰かが devise_for :users を素の状態に戻すと
# この経路が静かに復活するため、退行検知として固定しておく。
RSpec.describe "意図しない devise ルートを塞ぐ", type: :request do
  it "DELETE /api/auth/sign_up は存在しない（退会＝物理削除の経路をふさぐ）" do
    delete "/api/auth/sign_up"

    expect(response).to have_http_status(:not_found)
  end

  it "PATCH /api/auth/sign_up は存在しない（パスワード変更の経路をふさぐ）" do
    patch "/api/auth/sign_up"

    expect(response).to have_http_status(:not_found)
  end

  it "GET /api/auth/sign_in は存在しない（HTML フォーム用 new の経路をふさぐ）" do
    get "/api/auth/sign_in"

    expect(response).to have_http_status(:not_found)
  end
end
