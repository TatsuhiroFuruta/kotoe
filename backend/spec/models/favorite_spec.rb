require "rails_helper"

RSpec.describe Favorite, type: :model do
  it "有効な factory を持つ" do
    expect(build(:favorite)).to be_valid
  end

  it "user と post に紐づく" do
    favorite = create(:favorite)
    expect(favorite.user).to be_a(User)
    expect(favorite.post).to be_a(Post)
  end

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
end
