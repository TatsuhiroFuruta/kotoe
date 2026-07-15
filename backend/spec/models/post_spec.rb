require "rails_helper"

RSpec.describe Post, type: :model do
  it "有効な factory を持つ" do
    expect(build(:post)).to be_valid
  end

  it { is_expected.to belong_to(:user) }
  it { is_expected.to have_many(:attempts).dependent(:restrict_with_exception) }
  it { is_expected.to have_many(:favorites).dependent(:destroy) }

  it { is_expected.to validate_presence_of(:title) }
  it { is_expected.to validate_presence_of(:image_public_id) }

  it "discard すると kept から外れ discarded に入る" do
    post = create(:post)
    post.discard
    expect(post.discarded?).to be true
    expect(Post.kept).not_to include(post)
    expect(Post.discarded).to include(post)
  end
end
