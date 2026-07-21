require "rails_helper"

RSpec.describe "POST /api/auth/sign_up", type: :request do
  let(:params) do
    { user: { name: "テスト太郎", email: "new@example.com", password: "password123" } }
  end

  it "ユーザーを作成し 201 とユーザー JSON を返す" do
    expect { post "/api/auth/sign_up", params: params, as: :json }
      .to change(User, :count).by(1)

    expect(response).to have_http_status(:created)
    expect(response.parsed_body).to eq(
      "id" => User.last.id,
      "name" => "テスト太郎",
      "email" => "new@example.com"
    )
  end

  it "Authorization ヘッダで JWT を発行する" do
    post "/api/auth/sign_up", params: params, as: :json

    expect(response.headers["Authorization"]).to match(/\ABearer .+\z/)
  end

  it "email が重複していると 422 とエラーを返す" do
    create(:user, email: "new@example.com")

    expect { post "/api/auth/sign_up", params: params, as: :json }
      .not_to change(User, :count)

    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]["email"]).to include("taken")
  end

  it "name が無いと 422 とエラーを返す" do
    params[:user][:name] = ""

    post "/api/auth/sign_up", params: params, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]["name"]).to include("blank")
  end

  it "email がドメイン部にドットを含まないと 422 とエラーを返す" do
    params[:user][:email] = "aaa@aaa"

    post "/api/auth/sign_up", params: params, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]["email"]).to include("invalid")
  end
end
