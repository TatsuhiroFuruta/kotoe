require "rails_helper"

RSpec.describe User, type: :model do
  it "有効な factory を持つ" do
    expect(build(:user)).to be_valid
  end

  it { is_expected.to have_many(:posts).dependent(:restrict_with_exception) }
  it { is_expected.to have_many(:attempts).dependent(:restrict_with_exception) }
  it { is_expected.to have_many(:likes).dependent(:destroy) }
  it { is_expected.to have_many(:favorites).dependent(:destroy) }
  it { is_expected.to have_many(:reports).with_foreign_key(:reporter_id).dependent(:restrict_with_exception) }

  it { is_expected.to validate_presence_of(:name) }

  it { is_expected.to validate_presence_of(:email) }

  it "email はユニーク" do
    create(:user, email: "taken@example.com")

    expect(build(:user, email: "taken@example.com")).not_to be_valid
  end

  it "パスワードを暗号化して保存し、照合できる" do
    user = create(:user, password: "password123")

    expect(user.encrypted_password).to be_present
    expect(user.encrypted_password).not_to eq("password123")
    expect(user.valid_password?("password123")).to be(true)
    expect(user.valid_password?("wrong-password")).to be(false)
  end

  it "パスワードが短すぎると無効" do
    # devise の validatable が既定で6文字以上を要求する。
    expect(build(:user, password: "12345")).not_to be_valid
  end
end
