require "rails_helper"

RSpec.describe Favorite, type: :model do
  it "有効な factory を持つ" do
    expect(build(:favorite)).to be_valid
  end

  it { is_expected.to belong_to(:user) }
  it { is_expected.to belong_to(:post) }

  it "同じ user と post の組み合わせは二重に作れない" do
    favorite = create(:favorite)
    dup = build(:favorite, user: favorite.user, post: favorite.post)
    expect(dup).to be_invalid
  end

  it "別 user なら同じ post をお気に入りにできる" do
    favorite = create(:favorite)
    other = build(:favorite, post: favorite.post)
    expect(other).to be_valid
  end

  it "DB の複合ユニーク制約でも二重お気に入りを弾く" do
    favorite = create(:favorite)
    dup = build(:favorite, user: favorite.user, post: favorite.post)
    expect { dup.save(validate: false) }.to raise_error(ActiveRecord::RecordNotUnique)
  end

  describe ".favorited_post_ids" do
    it "そのユーザーがお気に入り済みの post_id だけを Set で返す" do
      user = create(:user)
      favorited = create(:post)
      not_favorited = create(:post)
      create(:favorite, user: user, post: favorited)

      result = Favorite.favorited_post_ids(user, [ favorited.id, not_favorited.id ])

      expect(result).to eq(Set[favorited.id])
    end

    it "他人のお気に入りは含めない" do
      user = create(:user)
      post_record = create(:post)
      create(:favorite, post: post_record)

      result = Favorite.favorited_post_ids(user, [ post_record.id ])

      expect(result).to be_empty
    end

    # 未ログインの一覧で毎回 SELECT を撃たないことまで固定する。
    it "user が nil なら DB を触らず空集合を返す" do
      post_record = create(:post)

      expect(Favorite).not_to receive(:where)
      expect(Favorite.favorited_post_ids(nil, [ post_record.id ])).to be_empty
    end

    it "post_ids が空なら DB を触らず空集合を返す" do
      user = create(:user)

      expect(Favorite).not_to receive(:where)
      expect(Favorite.favorited_post_ids(user, [])).to be_empty
    end
  end
end
