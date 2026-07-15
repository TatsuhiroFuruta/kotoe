require "rails_helper"

RSpec.describe Like, type: :model do
  it "有効な factory を持つ" do
    expect(build(:like)).to be_valid
  end

  it "user と attempt に紐づく" do
    like = create(:like)
    expect(like.user).to be_a(User)
    expect(like.attempt).to be_a(Attempt)
  end

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
end
