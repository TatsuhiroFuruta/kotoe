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

    expect(build(:user, email: "taken@example.com")).to be_invalid
  end

  # devise 既定の email_regexp は aaa@aaa を通してしまうため、
  # ドメイン部にドットを要求する設定に差し替えている（config/initializers/devise.rb）。
  it "ドメイン部にドットが無い email は無効" do
    expect(build(:user, email: "aaa@aaa")).to be_invalid
    expect(build(:user, email: "aaa@.com")).to be_invalid
  end

  it "ドメイン部に空ラベル（連続ドット・先頭ドット）を含む email は無効" do
    expect(build(:user, email: "aaa@example..com")).to be_invalid
    expect(build(:user, email: "aaa@.example.com")).to be_invalid
  end

  it "通常の email は有効" do
    expect(build(:user, email: "aaa@example.com")).to be_valid
    expect(build(:user, email: "a.b+tag@sub.example.co.jp")).to be_valid
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
    expect(build(:user, password: "12345")).to be_invalid
  end

  describe "#kept_posts_count" do
    it "自分の未削除のお題だけを数える" do
      user = create(:user)
      create_list(:post, 2, user: user)
      create(:post, user: user).discard!
      create(:post)

      expect(user.kept_posts_count).to eq(2)
    end
  end

  describe "#published_attempts_count" do
    it "自分の未削除かつ公開済みの挑戦だけを数える" do
      user = create(:user)
      create_list(:attempt, 2, :published, user: user)
      create(:attempt, user: user)
      create(:attempt, :generating, user: user)
      create(:attempt, :failed, user: user)
      create(:attempt, :published, user: user).discard!
      create(:attempt, :published)

      expect(user.published_attempts_count).to eq(2)
    end
  end

  describe "#likes_received_count" do
    it "自分の公開済み挑戦が集めたいいねを数える" do
      user = create(:user)
      create_list(:like, 3, attempt: create(:attempt, :published, user: user))

      expect(user.likes_received_count).to eq(3)
    end

    it "下書き・削除済みの挑戦、他人の挑戦へのいいねは数えない" do
      user = create(:user)
      create(:like, attempt: create(:attempt, user: user))
      discarded = create(:attempt, :published, user: user)
      create(:like, attempt: discarded)
      discarded.discard!
      create(:like, attempt: create(:attempt, :published))

      expect(user.likes_received_count).to eq(0)
    end

    # 得た票は消えない。me/attempts が削除済みお題ぶら下がりの挑戦を出す以上、
    # 「一覧に出ている挑戦のいいねを足すと合計になる」関係も保つ（設計書参照）。
    it "削除済みのお題にぶら下がる挑戦へのいいねは数える" do
      user = create(:user)
      post = create(:post)
      create(:like, attempt: create(:attempt, :published, post: post, user: user))
      post.discard!

      expect(user.likes_received_count).to eq(1)
    end
  end
end
