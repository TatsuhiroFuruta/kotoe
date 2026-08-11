require "rails_helper"

RSpec.describe Like, type: :model do
  it "有効な factory を持つ" do
    expect(build(:like)).to be_valid
  end

  it { is_expected.to belong_to(:user) }
  it { is_expected.to belong_to(:attempt) }

  it "同じ user と attempt の組み合わせは二重に作れない" do
    like = create(:like)
    dup = build(:like, user: like.user, attempt: like.attempt)
    expect(dup).to be_invalid
  end

  it "別 user なら同じ attempt にいいねできる" do
    like = create(:like)
    other = build(:like, attempt: like.attempt)
    expect(other).to be_valid
  end

  it "DB の複合ユニーク制約でも二重いいねを弾く" do
    like = create(:like)
    dup = build(:like, user: like.user, attempt: like.attempt)
    expect { dup.save(validate: false) }.to raise_error(ActiveRecord::RecordNotUnique)
  end

  describe ".liked_attempt_ids" do
    let(:user) { create(:user) }

    it "そのユーザーがいいね済みの挑戦 id だけを返す" do
      liked = create(:attempt, :published)
      not_liked = create(:attempt, :published)
      create(:like, user: user, attempt: liked)

      result = described_class.liked_attempt_ids(user, [ liked.id, not_liked.id ])

      expect(result).to eq(Set[liked.id])
    end

    it "他人のいいねは含めない" do
      attempt = create(:attempt, :published)
      create(:like, attempt: attempt)

      expect(described_class.liked_attempt_ids(user, [ attempt.id ])).to be_empty
    end

    it "未ログイン（user が nil）なら空集合" do
      attempt = create(:attempt, :published)
      create(:like, user: user, attempt: attempt)

      expect(described_class.liked_attempt_ids(nil, [ attempt.id ])).to be_empty
    end

    it "id が空なら空集合" do
      expect(described_class.liked_attempt_ids(user, [])).to be_empty
    end
  end
end
