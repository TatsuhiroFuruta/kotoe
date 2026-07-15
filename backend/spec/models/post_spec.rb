require "rails_helper"

RSpec.describe Post, type: :model do
  it "有効な factory を持つ" do
    expect(build(:post)).to be_valid
  end

  it "title が無いと無効" do
    expect(build(:post, title: nil)).to be_invalid
  end

  it "image_public_id が無いと無効" do
    expect(build(:post, image_public_id: nil)).to be_invalid
  end

  it "user と attempts に紐づく" do
    post = create(:post)
    attempt = create(:attempt, post: post)
    expect(post.user).to be_a(User)
    expect(post.attempts).to include(attempt)
  end

  it "discard すると kept から外れ discarded に入る" do
    post = create(:post)
    post.discard
    expect(post.discarded?).to be true
    expect(Post.kept).not_to include(post)
    expect(Post.discarded).to include(post)
  end
end
