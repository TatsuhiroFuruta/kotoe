require "rails_helper"

RSpec.describe Attempt, type: :model do
  it "有効な factory を持つ" do
    expect(build(:attempt)).to be_valid
  end

  it "description が無いと無効" do
    expect(build(:attempt, description: nil)).to be_invalid
  end

  it "status は既定で draft" do
    expect(build(:attempt).status).to eq("draft")
  end

  it "generated_image_public_id と similarity_score は null 可" do
    attempt = build(:attempt, generated_image_public_id: nil, similarity_score: nil)
    expect(attempt).to be_valid
  end

  it "status enum のスコープと述語が使える" do
    attempt = create(:attempt, status: "published")
    expect(attempt.published?).to be true
    expect(Attempt.published).to include(attempt)
  end

  it "未知の status を代入すると ArgumentError" do
    expect { build(:attempt, status: "unknown") }.to raise_error(ArgumentError)
  end

  it "post と user に紐づく" do
    attempt = create(:attempt)
    expect(attempt.post).to be_a(Post)
    expect(attempt.user).to be_a(User)
  end

  it "discard すると kept から外れ discarded に入る" do
    attempt = create(:attempt)
    attempt.discard
    expect(attempt.discarded?).to be true
    expect(Attempt.kept).not_to include(attempt)
    expect(Attempt.discarded).to include(attempt)
  end
end
